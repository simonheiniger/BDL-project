import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import type { Address } from "viem";
import { useContracts } from "../contracts";
import { loadPet, useChainQuery, useMyPets, useTx } from "../hooks";
import { TxStatus } from "../components/common";
import {
  MEMORY_SYMBOLS,
  RACE,
  FLAPPY,
  flappyStart,
  flappyStep,
  type FlappyPipe,
  SIMON,
  PUZZLE,
  puzzleMove,
  HASH,
  GENESIS,
  blockHash,
  hashBlockText,
} from "../../api/_games";

// Minispiele: gespielt wird off-chain (keine Transaktion). Der Spiele-Server (api/game.ts) prueft jede Runde und
// stellt einen signierten XP-Gutschein aus. Gutscheine werden gesammelt und mit EINER Transaktion eingeloest
// (PetGames.claim). Tageslimit on-chain: 200 Spiel-XP pro Pet.

type Kind = "memory" | "quiz" | "race" | "flappy" | "simon" | "puzzle" | "hash";
type Voucher = { player: Address; petId: string; kind: number; xp: number; nonce: string; expiry: string; chainId: number };
type Stored = { v: Voucher; sig: `0x${string}` };

const API = "/api/game";
const LABEL: Record<Kind, string> = {
  memory: "🧠 Memory",
  quiz: "❓ Blockchain-Quiz",
  race: "🏃 Hürdenlauf",
  flappy: "🪽 Flappy-Pet",
  simon: "🎵 Simon Says",
  puzzle: "🧩 Schiebe-Puzzle",
  hash: "⛏️ Hash-Rätsel",
};

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
      {round && p.kind === "flappy" && <Flappy pipes={round.data.pipes as FlappyPipe[]} petImage={p.petImage} onDone={finish} />}
      {round && p.kind === "simon" && <Simon sequence={round.data.sequence as number[]} onDone={finish} />}
      {round && p.kind === "puzzle" && <Puzzle board={round.data.board as number[]} petImage={p.petImage} onDone={finish} />}
      {round && p.kind === "hash" && <HashGame txs={round.data.txs as string[]} onDone={finish} />}
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

// ---------------------------------------------------------------- Flappy-Pet (gleiche Ganzzahl-Physik wie der Server)

function Flappy({ pipes, petImage, onDone }: { pipes: FlappyPipe[]; petImage: string; onDone: (flaps: number[]) => void }) {
  const sprite = useMemo(() => spriteOnly(petImage), [petImage]);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState({ t: 0, y: 500, vy: 0 });
  const flaps = useRef<number[]>([]);
  const want = useRef(false);
  const startAt = useRef(0);
  const done = useRef(false);

  const flap = () => {
    if (running) want.current = true;
  };

  useEffect(() => {
    if (!running) return;
    const s = flappyStart();
    let next = 0; // naechster zu simulierender Tick
    let raf = 0;
    const loop = () => {
      const t = Math.min(FLAPPY.maxTicks, Math.floor((performance.now() - startAt.current) / FLAPPY.tickMs));
      for (; next < t && !done.current; next++) {
        const f = want.current;
        want.current = false;
        if (f) flaps.current.push(next);
        if (flappyStep(s, f, next, pipes) || next + 1 >= FLAPPY.maxTicks) {
          done.current = true;
          setRunning(false);
          onDone(flaps.current);
          return;
        }
      }
      setView({ t: next, y: s.y, vy: s.vy });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        want.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const H = 320; // px Spielfeldhoehe
  const k = H / FLAPPY.height;
  const PX = 6; // px pro Tick
  const PET_X = 70;
  const passed = pipes.filter((p) => p.t + FLAPPY.pipeHalf < view.t).length;
  return (
    <>
      <p className="muted small">Leertaste / Pfeil hoch / Tippen = Flügelschlag. 3 XP pro Röhre (max. 40).</p>
      <div className="flappy" style={{ height: H }} onPointerDown={flap}>
        {pipes
          .filter((p) => Math.abs(p.t - view.t) < 120)
          .map((p) => {
            const x = PET_X + (p.t - view.t) * PX - FLAPPY.pipeHalf * PX;
            const w = (2 * FLAPPY.pipeHalf + 1) * PX;
            return (
              <div key={p.t}>
                <div className="pipe" style={{ left: x, width: w, top: 0, height: (p.g - FLAPPY.gapHalf) * k }} />
                <div className="pipe" style={{ left: x, width: w, top: (p.g + FLAPPY.gapHalf) * k, bottom: 0 }} />
              </div>
            );
          })}
        <img
          className="flyer pixel"
          src={sprite}
          alt=""
          style={{ left: PET_X - 22, top: view.y * k - 22, transform: `rotate(${Math.max(-25, Math.min(45, view.vy))}deg)` }}
        />
        <div className="race-hud">
          🪽 {passed} · {((view.t * FLAPPY.tickMs) / 1000).toFixed(1)} s / {(FLAPPY.maxTicks * FLAPPY.tickMs) / 1000} s
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

// ---------------------------------------------------------------- Simon Says

const SIMON_COLORS = ["#e23d4f", "#5cc45a", "#3f8fd0", "#ffc93c"];

function Simon({ sequence, onDone }: { sequence: number[]; onDone: (attempts: number[][]) => void }) {
  const [round, setRound] = useState(1); // aktuelle Laenge
  const [lit, setLit] = useState<number | null>(null);
  const [showing, setShowing] = useState(false);
  const [input, setInput] = useState<number[]>([]);
  const attempts = useRef<number[][]>([]);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    setShowing(true);
    setInput([]);
    const timers: ReturnType<typeof setTimeout>[] = [];
    sequence.slice(0, round).forEach((c, i) => {
      timers.push(setTimeout(() => setLit(c), 400 + i * SIMON.stepMs));
      timers.push(setTimeout(() => setLit(null), 400 + i * SIMON.stepMs + SIMON.stepMs * 0.7));
    });
    timers.push(setTimeout(() => setShowing(false), 400 + round * SIMON.stepMs));
    return () => timers.forEach(clearTimeout);
  }, [round, started, sequence]);

  function press(c: number) {
    if (showing) return;
    setLit(c);
    setTimeout(() => setLit(null), 180);
    const next = [...input, c];
    setInput(next);
    const wrong = next[next.length - 1] !== sequence[next.length - 1];
    if (wrong || next.length === round) {
      attempts.current.push(next);
      if (wrong || round === SIMON.maxLen) onDone(attempts.current);
      else setTimeout(() => setRound(round + 1), 500);
    }
  }

  if (!started)
    return (
      <>
        <p className="muted small">Merk dir die Farbfolge und tippe sie nach. Jede Runde kommt eine Farbe dazu. 4 XP pro Runde (max. 40).</p>
        <button className="btn" onClick={() => setStarted(true)}>
          Los!
        </button>
      </>
    );
  return (
    <>
      <p className="muted small">
        Runde {round} / {SIMON.maxLen} · {showing ? "Zuschauen …" : `Du bist dran (${input.length}/${round})`}
      </p>
      <div className="simon">
        {SIMON_COLORS.map((col, i) => (
          <button
            key={i}
            className={`simon-pad ${lit === i ? "lit" : ""}`}
            style={{ background: col }}
            disabled={showing}
            onClick={() => press(i)}
            aria-label={`Farbe ${i + 1}`}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Schiebe-Puzzle mit dem eigenen Pet

function Puzzle({ board: start, petImage, onDone }: { board: number[]; petImage: string; onDone: (moves: number[]) => void }) {
  const [board, setBoard] = useState(start);
  const moves = useRef<number[]>([]);
  const [count, setCount] = useState(0);
  const [hints, setHints] = useState(false);
  const n = PUZZLE.n;
  const blank = n * n - 1;

  function click(pos: number) {
    const b = [...board];
    if (!puzzleMove(b, pos)) return;
    moves.current.push(pos);
    setCount(moves.current.length);
    setBoard(b);
    if (b.every((v, i) => v === i)) setTimeout(() => onDone(moves.current), 400);
  }

  return (
    <>
      <p className="muted small">
        Schiebe die Teile zurück zum Bild deines Pets. Weniger Züge = mehr XP (max. 40). Züge: {count}{" "}
        <label className="small">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} /> Nummern
        </label>
      </p>
      <div className="puzzle">
        {board.map((v, pos) => (
          <button
            key={pos}
            className={`ptile ${v === blank ? "blank" : ""}`}
            onClick={() => click(pos)}
            style={
              v === blank
                ? undefined
                : {
                    backgroundImage: `url("${petImage}")`,
                    backgroundSize: `${n * 100}% ${n * 100}%`,
                    backgroundPosition: `${((v % n) / (n - 1)) * 100}% ${(Math.floor(v / n) / (n - 1)) * 100}%`,
                  }
            }
          >
            {hints && v !== blank && <span>{v + 1}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Hash-Raetsel (Mini-Proof-of-Work)

function HashGame({ txs, onDone }: { txs: string[]; onDone: (nonces: number[]) => void }) {
  const [nonces, setNonces] = useState<number[]>(() => txs.map(() => 0));
  const [tries, setTries] = useState(0);
  // Hashes verketten: jeder Block enthaelt den Hash des Vorgaengers
  const blocks = useMemo(() => {
    let prev = GENESIS;
    let chainOk = true; // gueltig nur, wenn auch alle Vorgaenger gueltig sind
    return txs.map((tx, i) => {
      const hash = blockHash(hashBlockText(i, prev, tx, nonces[i]));
      chainOk = chainOk && hash.startsWith(HASH.prefix);
      const b = { prev, hash, ok: chainOk };
      prev = hash;
      return b;
    });
  }, [txs, nonces]);
  const firstOpen = blocks.findIndex((b) => !b.ok);
  const allOk = firstOpen === -1;

  const set = (i: number, n: number) => {
    setTries((t) => t + 1);
    setNonces((ns) => ns.map((x, k) => (k === i ? Math.max(0, Math.min(HASH.maxNonce, n)) : x)));
  };

  return (
    <>
      <p className="muted small">
        Du bist Miner: Finde für jeden Block eine <strong>Nonce</strong>, sodass sein Hash mit <code>0x0</code> beginnt (im Schnitt 16
        Versuche). Jeder Block enthält den Hash des vorherigen – änderst du einen frühen Block, werden alle späteren ungültig. Versuche:{" "}
        {tries}
      </p>
      <div className="chain">
        {blocks.map((b, i) => (
          <div key={i} className={`block ${b.ok ? "ok" : ""} ${i > (allOk ? 99 : firstOpen) ? "locked" : ""}`}>
            <div className="small">
              <strong>Block #{i + 1}</strong> {b.ok ? "✅" : "⛏️"}
            </div>
            <div className="mono small">prev: {b.prev.slice(0, 12)}…</div>
            <div className="small">{txs[i]}</div>
            <div className="row small">
              Nonce
              <button className="btn small" onClick={() => set(i, nonces[i] - 1)}>
                −
              </button>
              <input
                type="number"
                min={0}
                value={nonces[i]}
                onChange={(e) => set(i, Number(e.target.value) || 0)}
                style={{ width: "5rem" }}
              />
              <button className="btn small" onClick={() => set(i, nonces[i] + 1)}>
                +1
              </button>
            </div>
            <div className="mono small hash">
              <span className={b.ok ? "good" : "bad"}>{b.hash.slice(0, 3)}</span>
              {b.hash.slice(3, 20)}…
            </div>
          </div>
        ))}
      </div>
      <button className="btn" disabled={!allOk} onClick={() => onDone(nonces)}>
        ⛓️ Kette einreichen
      </button>
    </>
  );
}
