import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import type { Address } from "viem";
import { useContracts } from "../contracts";
import { loadPet, useChainQuery, useMyPets, useTx } from "../hooks";
import { TxStatus } from "../components/common";
import { MEMORY_SYMBOLS, RACE } from "../../api/_games";

// Minispiele: gespielt wird off-chain (keine Transaktion). Der Spiele-Server (api/game.ts) prueft jede Runde und
// stellt einen signierten XP-Gutschein aus. Gutscheine werden gesammelt und mit EINER Transaktion eingeloest
// (PetGames.claim). Tageslimit on-chain: 200 Spiel-XP pro Pet.

type Kind = "memory" | "quiz" | "race";
type Voucher = { player: Address; petId: string; kind: number; xp: number; nonce: string; expiry: string; chainId: number };
type Stored = { v: Voucher; sig: `0x${string}` };

const API = "/api/game";
const LABEL: Record<Kind, string> = { memory: "🧠 Memory", quiz: "❓ Blockchain-Quiz", race: "🏃 Hürdenlauf" };

async function api(body: unknown) {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `Fehler ${r.status}`);
  return j;
}

// ---------------------------------------------------------------- Gutschein-Speicher (pro Spieler + Chain)

const storeKey = (chainId: number, player?: string) => `game-vouchers:${chainId}:${player?.toLowerCase()}`;
/**
 * Nur das Pet ohne Karten-Hintergrund und Rahmen (fuer das Rennen). Schneidet am festen Aufbau von PetRenderer.svg:
 * Hintergrund steht zwischen `scale(12.5)">` und dem Schatten-Rect, Rahmen/Funkeln nach dem letzten `</g></g></g>`.
 * Passt das Muster nicht (anderer Renderer), bleibt das Bild unveraendert.
 */
function spriteOnly(image: string): string {
  try {
    const b64 = image.startsWith("data:image/svg+xml;base64,");
    const raw = b64 ? atob(image.split(",")[1]) : decodeURIComponent(image.split(",")[1] ?? "");
    const open = '<g transform="scale(12.5)">';
    const shadow = '<rect x="9" y="29" width="14" height="1" fill="#000" opacity=".18"/>';
    const a = raw.indexOf(open);
    const b = raw.indexOf(shadow);
    const c = raw.lastIndexOf("</g></g></g>");
    if (a < 0 || b < a || c < b) return image;
    const svg = raw.slice(0, a + open.length) + raw.slice(b, c + 12) + "</svg>";
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  } catch {
    return image;
  }
}

function loadStore(key: string): Stored[] {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "[]") as Stored[];
    const now = Date.now() / 1000;
    return all.filter((s) => Number(s.v.expiry) > now);
  } catch {
    return [];
  }
}
function saveStore(key: string, list: Stored[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* Storage gesperrt -> Gutscheine nur bis Reload */
  }
}

export default function Spiele() {
  const { address } = useAccount();
  const chainId = useChainId();
  const c = useContracts();
  const tx = useTx();
  const { data: ids } = useMyPets();
  const { data: views } = useChainQuery(
    ["spielePets", ids?.join(",")],
    async (pc, c) => (await Promise.all(ids!.map((id) => loadPet(pc, c, id)))).filter((v) => v !== null),
    !!ids,
  );
  const [petId, setPetId] = useState<string>("");
  const [kind, setKind] = useState<Kind>("memory");
  const [store, setStore] = useState<Stored[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const key = storeKey(chainId, address);

  useEffect(() => setStore(loadStore(key)), [key]);
  useEffect(() => {
    if (!petId && views?.length) setPetId(views[0].id.toString());
  }, [views, petId]);

  const pet = views?.find((v) => v.id.toString() === petId);
  const owned = new Set(views?.map((v) => v.id.toString()));
  const claimable = store.filter((s) => owned.has(s.v.petId));
  const pendingXp = claimable.reduce((a, s) => a + s.v.xp, 0);

  const { data: today } = useChainQuery(
    ["gameDay", petId],
    async (pc, c) => {
      const [day, xp] = await Promise.all([
        pc.readContract({ ...c.PetGames, functionName: "dayOf", args: [BigInt(petId)] }) as Promise<bigint>,
        pc.readContract({ ...c.PetGames, functionName: "xpToday", args: [BigInt(petId)] }) as Promise<bigint>,
      ]);
      const block = await pc.getBlock();
      return Number(day) === Math.floor(Number(block.timestamp) / 86400) ? Number(xp) : 0;
    },
    !!petId && !!c?.PetGames.address,
  );

  function addVoucher(v: Voucher, sig: `0x${string}`) {
    const next = [...loadStore(key), { v, sig }];
    saveStore(key, next);
    setStore(next);
  }

  async function claim() {
    if (!c || claimable.length === 0) return;
    const vs = claimable.map(({ v }) => ({ ...v, petId: BigInt(v.petId), nonce: BigInt(v.nonce), expiry: BigInt(v.expiry) }));
    const ok = await tx.send(`${claimable.length} Gutscheine einlösen`, {
      ...c.PetGames,
      functionName: "claim",
      args: [vs, claimable.map((s) => s.sig)],
    });
    if (ok) {
      const done = new Set(claimable.map((s) => s.v.nonce));
      const rest = loadStore(key).filter((s) => !done.has(s.v.nonce));
      saveStore(key, rest);
      setStore(rest);
      setMsg(`✅ ${pendingXp} XP eingelöst (über dem Tageslimit wird gekappt).`);
    }
  }

  if (!address) return <p className="muted">Wallet verbinden, um zu spielen.</p>;
  if (!c?.PetGames.address) return <p className="card warn">Auf diesem Netzwerk sind noch keine Spiele deployt.</p>;
  if (views && views.length === 0) return <p className="muted">Du brauchst zuerst ein Pet.</p>;

  return (
    <>
      <h2>Minispiele</h2>
      <p className="muted">
        Spielen kostet nichts und braucht keine Transaktion. Jede gewonnene Runde gibt einen signierten XP-Gutschein (max.
        40 XP). Gesammelte Gutscheine löst du mit <strong>einer</strong> Transaktion ein. Limit: 200 Spiel-XP pro Pet und
        Tag – Pflege im Haus bleibt wichtig.
      </p>
      <TxStatus {...tx} />
      {msg && <div className="toast">{msg}</div>}

      <div className="card row between wrap">
        <label>
          Pet{" "}
          <select value={petId} onChange={(e) => setPetId(e.target.value)}>
            {views?.map((v) => (
              <option key={v.id.toString()} value={v.id.toString()}>
                {v.name} (Lv {Number(v.pet.level)})
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">Heute eingelöst: {today ?? 0} / 200 XP</span>
        <div className="row">
          <span>
            🎟️ {claimable.length} Gutscheine · <strong>{pendingXp} XP</strong>
          </span>
          <button className="btn" disabled={!claimable.length || !!tx.pending} onClick={claim}>
            XP einlösen
          </button>
        </div>
      </div>

      <div className="row wrap">
        {(Object.keys(LABEL) as Kind[]).map((k) => (
          <button key={k} className={`chip ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
            {LABEL[k]}
          </button>
        ))}
      </div>

      {pet && (
        <GameRound
          key={`${kind}-${petId}`}
          kind={kind}
          petId={petId}
          petImage={pet.image}
          player={address}
          chainId={chainId}
          onVoucher={(v, sig) => {
            addVoucher(v, sig);
            setMsg(`🎟️ Gutschein über ${v.xp} XP gesammelt.`);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- Eine Runde (Start -> Spiel -> Pruefung)

type RoundProps = {
  kind: Kind;
  petId: string;
  petImage: string;
  player: Address;
  chainId: number;
  onVoucher: (v: Voucher, sig: `0x${string}`) => void;
};

function GameRound(p: RoundProps) {
  const [round, setRound] = useState<{ token: string; data: Record<string, unknown> } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setErr(null);
    setResult(null);
    try {
      setRound(await api({ op: "start", kind: p.kind, petId: p.petId, player: p.player, chainId: p.chainId }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function finish(answer: unknown) {
    if (!round) return;
    try {
      const r = await api({ op: "finish", token: round.token, answer });
      if (r.voucher) {
        p.onVoucher(r.voucher, r.signature);
        setResult(`Geschafft! +${r.result.xp} XP als Gutschein.`);
      } else setResult("Leider nicht geschafft – kein Gutschein. Nochmal?");
    } catch (e) {
      setErr((e as Error).message);
    }
    setRound(null);
  }

  return (
    <section className="card game">
      <h3>{LABEL[p.kind]}</h3>
      {err && <p className="warn small">⚠️ {err}</p>}
      {result && <p>{result}</p>}
      {!round && (
        <button className="btn" onClick={start}>
          {result ? "Neue Runde" : "Runde starten"}
        </button>
      )}
      {round && p.kind === "memory" && <Memory layout={round.data.layout as number[]} onDone={finish} />}
      {round && p.kind === "quiz" && <Quiz questions={round.data.questions as { q: string; options: string[] }[]} onDone={finish} />}
      {round && p.kind === "race" && <Race obstacles={round.data.obstacles as number[]} petImage={p.petImage} onDone={finish} />}
    </section>
  );
}

// ---------------------------------------------------------------- Memory

function Memory({ layout, onDone }: { layout: number[]; onDone: (moves: [number, number][]) => void }) {
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState<[number, number][]>([]);

  function flip(i: number) {
    if (open.length === 2 || open.includes(i) || matched.has(i)) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length === 2) {
      const [a, b] = next;
      const m: [number, number][] = [...moves, [a, b]];
      setMoves(m);
      const hit = layout[a] === layout[b];
      setTimeout(() => {
        const nm = hit ? new Set([...matched, a, b]) : matched;
        setMatched(nm);
        setOpen([]);
        if (nm.size === 16) onDone(m);
      }, hit ? 250 : 700);
    }
  }

  return (
    <>
      <p className="muted small">Finde alle 8 Paare. Weniger Fehlversuche = mehr XP. Züge: {moves.length}</p>
      <div className="memory">
        {layout.map((sym, i) => {
          const shown = open.includes(i) || matched.has(i);
          return (
            <button key={i} className={`mcard ${shown ? "up" : ""} ${matched.has(i) ? "done" : ""}`} onClick={() => flip(i)}>
              {shown ? MEMORY_SYMBOLS[sym] : "?"}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Quiz

function Quiz({ questions, onDone }: { questions: { q: string; options: string[] }[]; onDone: (answers: number[]) => void }) {
  const [answers, setAnswers] = useState<number[]>([]);
  const i = answers.length;
  if (i >= questions.length) return <p className="muted">Wird geprüft …</p>;
  const q = questions[i];
  return (
    <>
      <p className="muted small">
        Frage {i + 1} / {questions.length} · 8 XP pro richtige Antwort
      </p>
      <p>
        <strong>{q.q}</strong>
      </p>
      <div className="quiz">
        {q.options.map((o, k) => (
          <button
            key={k}
            className="btn"
            onClick={() => {
              const next = [...answers, k];
              setAnswers(next);
              if (next.length === questions.length) onDone(next);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Huerdenlauf (gleiche Regeln wie Server-Simulation)

function Race({ obstacles, petImage, onDone }: { obstacles: number[]; petImage: string; onDone: (jumps: number[]) => void }) {
  const sprite = useMemo(() => spriteOnly(petImage), [petImage]);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const jumps = useRef<number[]>([]);
  const airUntil = useRef(-1);
  const startAt = useRef(0);
  const done = useRef(false);
  const obs = useRef(new Set(obstacles));

  const airborne = (t: number) => jumps.current.some((j) => t > j && t <= j + RACE.jumpTicks);

  function jump() {
    if (!running) return;
    const t = Math.floor((performance.now() - startAt.current) / RACE.tickMs);
    if (t > airUntil.current) {
      jumps.current.push(t);
      airUntil.current = t + RACE.jumpTicks;
    }
  }

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let checked = 0;
    const loop = () => {
      const t = Math.min(RACE.maxTicks, Math.floor((performance.now() - startAt.current) / RACE.tickMs));
      // jeden Tick einzeln pruefen (auch wenn ein Frame mehrere Ticks ueberspringt)
      for (; checked <= t && !done.current; checked++) {
        if (checked >= RACE.maxTicks || (obs.current.has(checked) && !airborne(checked))) {
          done.current = true;
          setRunning(false);
          onDone(jumps.current);
          return;
        }
      }
      setTick(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const lastJump = jumps.current[jumps.current.length - 1] ?? -99;
  const phase = tick > lastJump && tick <= lastJump + RACE.jumpTicks ? (tick - lastJump) / RACE.jumpTicks : 0;
  const lift = phase ? Math.sin(phase * Math.PI) * 60 : 0;
  const PX = 14; // Pixel pro Tick

  return (
    <>
      <p className="muted small">
        Leertaste / Pfeil hoch / Tippen = springen. Je weiter du kommst, desto mehr XP (max. 40 nach 30 s).
      </p>
      <div className="race" onPointerDown={running ? jump : undefined}>
        <img className="runner pixel" src={sprite} style={{ transform: `translateY(${-lift}px)` }} alt="" />
        {obstacles
          .filter((o) => o >= tick - 4 && o <= tick + 60)
          .map((o) => (
            <div key={o} className="hurdle" style={{ left: 60 + (o - tick) * PX }} />
          ))}
        <div className="race-hud">
          {(tick / (1000 / RACE.tickMs)).toFixed(1)} s / {(RACE.maxTicks * RACE.tickMs) / 1000} s
        </div>
      </div>
      {!running && !done.current && (
        <button
          className="btn"
          onClick={() => {
            startAt.current = performance.now();
            setRunning(true);
          }}
        >
          Los!
        </button>
      )}
    </>
  );
}
