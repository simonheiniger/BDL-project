import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBalance, useChainId, usePublicClient } from "wagmi";
import { formatEther, type Address } from "viem";
import { ACTIONS, useContracts } from "../contracts";
import { config } from "../wagmi";
import { friendlyError, loadHouse, loadPet, useChainQuery, useHouse, useMyPets, usePetHousing } from "../hooks";
import { MoodBar, NftCard, short, tierInfo } from "../components/common";
import { caretakerAddress, fingerprint, loadGrants, resetCaretakerKey, sendAsCaretaker, sendCare, type Grant } from "../caretaker";
import { keyAddress, listScans, loadScan, saveScan, scanExpiry, signScanWithKey, useScan } from "../scan";
import { claimPairCode, clearPhonePair, isPairId, phoneRegister, setPhonePair, usePair } from "../relay";
import { onOpenUrl } from "../native";

/**
 * Handy-App (Companion): nur Pflegen/Fuettern. Anmeldung = Kopplungs-QR vom PC, der PC berechtigt den
 * Caretaker-Schluessel dieses Handys fuer 30 Tage. Alles andere (Verkaufen, Fusion, Arena, ...) bleibt am PC.
 */

const pairIdFrom = (text: string) => /(?:p=)?([0-9a-f]{32})/i.exec(text.trim())?.[1]?.toLowerCase() ?? null;

function CompanionPet({ petId, owner, houseScanTick }: { petId: bigint; owner: Address; houseScanTick: number }) {
  const c = useContracts();
  const pc = usePublicClient();
  const chainId = useChainId();
  const qc = useQueryClient();
  const { data: view } = useChainQuery(["cpet", petId.toString()], (pc, c) => loadPet(pc, c, petId));
  const { data: housing } = usePetHousing(petId);
  const { data: house } = useHouse(housing && housing.houseId > 0n ? housing.houseId : undefined);
  const scan = useScan(chainId, housing?.houseId);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Gescannte Haeuser dieses Besitzers mit freiem Platz: dorthin darf das Pet einziehen
  const { data: targets } = useChainQuery(
    ["moveTargets", petId.toString(), houseScanTick, owner],
    async (pc, c) => {
      const out: { id: bigint; tier: number }[] = [];
      for (const s of listScans(chainId)) {
        const h = await loadHouse(pc, c, s.houseId);
        if (h && h.owner.toLowerCase() === owner.toLowerCase() && h.occupants < tierInfo(h.tier).capacity) out.push({ id: h.id, tier: h.tier });
      }
      return out;
    },
  );
  if (!view || !c) return null;
  const housed = !!housing && housing.houseId > 0n;

  async function move(label: string, functionName: "moveIn" | "moveOut", args: bigint[]) {
    if (!c || !pc) return;
    setErr(null);
    setOk(null);
    setBusy(label);
    try {
      const chain = config.chains.find((x) => x.id === chainId)!;
      await sendAsCaretaker({ pc, chain, target: c.PetHouse, functionName, args });
      await qc.invalidateQueries();
      setOk(`${label} ✔`);
    } catch (e) {
      setErr(friendlyCaretakerError(e));
    } finally {
      setBusy(null);
    }
  }

  async function care(action: number, label: string) {
    if (!c || !pc || !housing || !scan) return;
    setErr(null);
    setOk(null);
    setBusy(label);
    try {
      const h = await loadHouse(pc, c, housing.houseId);
      if (!h) throw new Error("Haus nicht gefunden");
      const expiry = await scanExpiry(pc);
      const signature = await signScanWithKey(scan.key, {
        chainId,
        houses: c.PetHouse.address,
        houseId: housing.houseId,
        petId,
        player: owner, // Scan gehoert dem Besitzer, der Caretaker sendet nur die Transaktion
        nonce: h.nonce,
        expiry,
      });
      const chain = config.chains.find((x) => x.id === chainId)!;
      await sendCare({ pc, chain, pets: c.PetNFT, petId, action, expiry, signature });
      await qc.invalidateQueries();
      setOk(`${label} ✔`);
    } catch (e) {
      setErr(friendlyCaretakerError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="resident">
      <NftCard view={view} size="sm" link={false} />
      <div className="grow">
        <p className="small">
          {housed && house ? (
            <>
              {tierInfo(house.tier).emoji} {tierInfo(house.tier).name} #{housing!.houseId.toString()}
            </>
          ) : (
            <span className="warn-text">⛺ Kein Haus – Pflege nicht möglich</span>
          )}
        </p>
        {housed && <MoodBar mood={housing!.mood} />}
        {housed && !scan && <p className="small">📡 Chip des Hauses #{housing!.houseId.toString()} scannen (Handy an den Chip halten)</p>}
        {housed && (
          <div className="row wrap">
            {ACTIONS.map((a, i) => (
              <button key={a.label} className="btn small" disabled={!scan || !!busy} title={a.label} onClick={() => care(i, a.label)}>
                {a.emoji} {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="row wrap">
          {housed && (
            <button className="btn small" disabled={!!busy} onClick={() => move("Ausziehen", "moveOut", [petId])}>
              🚪 Ausziehen
            </button>
          )}
          {!housed &&
            targets?.map((t) => (
              <button
                key={t.id.toString()}
                className="btn small"
                disabled={!!busy}
                onClick={() => move(`Einziehen in Haus #${t.id}`, "moveIn", [petId, t.id])}
              >
                🏠 Einziehen in {tierInfo(t.tier).name} #{t.id.toString()}
              </button>
            ))}
        </div>
        {!housed && targets?.length === 0 && (
          <p className="small">📡 Zum Einziehen den NFC-Chip eines eigenen Hauses mit freiem Platz scannen.</p>
        )}
        {busy && <p className="small">⏳ {busy} …</p>}
        {ok && <p className="small">{ok}</p>}
        {err && <p className="small warn-text">⚠️ {err}</p>}
      </div>
    </div>
  );
}

/** Zusaetzlich zu den bekannten Fehlern: leeres Gas-Konto und abgelaufene/entzogene Berechtigung */
function friendlyCaretakerError(e: unknown): string {
  const raw = e instanceof Error ? `${e.message}` : String(e);
  if (/NotPetOwner/.test(raw)) return "Berechtigung abgelaufen oder widerrufen. Am PC neu freigeben.";
  if (/Cooldown/.test(raw)) return "Noch Cooldown – gleich nochmal versuchen (oder am PC Pflegeprodukt kaufen).";
  if (/DailyLimit/.test(raw)) return "Diese Aktion hast du heute schon gemacht.";
  if (/insufficient funds|exceeds the balance/i.test(raw)) return "Kein Gas im Handy-Konto. Am PC „Handy freigeben“ mit etwas ETH erneut ausführen.";
  return friendlyError(e);
}

function OwnerPets({ owner, until, scanTick }: { owner: Address; until: number; scanTick: number }) {
  const { data: ids } = useMyPets(owner);
  const days = Math.max(0, Math.ceil((until * 1000 - Date.now()) / 86_400_000));
  return (
    <section className="card">
      <h3>Tiere von {short(owner)}</h3>
      <p className="muted small">Freigabe noch {days} Tage</p>
      {ids?.length === 0 && <p className="muted">Keine Tiere.</p>}
      {ids?.map((id) => (
        <CompanionPet key={id.toString()} petId={id} owner={owner} houseScanTick={scanTick} />
      ))}
    </section>
  );
}

export default function Companion() {
  const [identity, setIdentity] = useState(0); // erhoeht sich beim Abmelden -> neuer Schluessel
  const me = caretakerAddress();
  void identity;
  const chainId = useChainId();
  const c = useContracts();
  const pair = usePair("phone");
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanTick, setScanTick] = useState(0);
  const pc = usePublicClient();
  const { data: bal } = useBalance({ address: me });
  const { data: grants, error: grantsError, refetch } = useChainQuery<Grant[]>(["grants", me], (pc, c) => loadGrants(pc, c, me));

  async function pairFromInput() {
    const text = manual.trim();
    try {
      if (/^\d{8}$/.test(text)) {
        const { pair: id } = await claimPairCode(text);
        await register(id);
      } else {
        const id = pairIdFrom(text);
        if (!id || !isPairId(id)) throw new Error("Weder Code (8 Ziffern) noch Kopplungs-Link erkannt");
        await register(id);
      }
      setManual("");
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    }
  }

  function logout() {
    if (!confirm("Dieses Handy abmelden? Es bekommt einen neuen Schlüssel; die alte Freigabe am PC bitte widerrufen.")) return;
    resetCaretakerKey();
    clearPhonePair();
    for (const k of Object.keys(localStorage)) if (k.startsWith("bdl.scan.")) localStorage.removeItem(k);
    setMsg(null);
    setIdentity((n) => n + 1);
  }

  async function register(id: string) {
    setPhonePair(id);
    try {
      await phoneRegister(id, me);
      setMsg(`✅ Gekoppelt. Am PC den Code ${fingerprint(me)} prüfen und „Handy freigeben“ bestätigen.`);
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}. Am PC „Kopplung lösen“ und neuen QR-Code erzeugen.`);
    }
  }

  // Links: NFC-Chip /house/<id>#k=<key> und Kopplungs-QR /phone#p=<id>
  useEffect(() => {
    return onOpenUrl(async (url) => {
      const p = /p=([0-9a-f]{32})/.exec(url.hash);
      if (url.pathname === "/phone" && p) return register(p[1]);
      const h = /^\/house\/(\d+)$/.exec(url.pathname);
      const k = /k=(?:0x)?([0-9a-fA-F]{64})/.exec(url.hash);
      if (!h || !k || !pc || !c) return;
      const houseId = BigInt(h[1]);
      const key = `0x${k[1]}` as const;
      const house = await loadHouse(pc, c, houseId);
      if (!house) {
        setMsg(`⚠️ Haus #${houseId} gibt es auf diesem Netz (Chain ${chainId}) nicht. Chip stammt von einem anderen Netz oder einer älteren Version.`);
      } else if (keyAddress(key).toLowerCase() === house.tag.toLowerCase()) {
        saveScan(chainId, houseId, key);
        setScanTick((n) => n + 1);
        setMsg(`📡 Haus #${houseId} gescannt – Pflege 15 Minuten freigeschaltet.`);
      } else {
        setMsg(
          `⚠️ Chip passt nicht zu Haus #${houseId}: Der Schlüssel auf dem Chip (${short(keyAddress(key))}) ist nicht der im Haus eingetragene (${short(house.tag)}). Der Chip muss mit der URL des Hausprägers beschrieben sein oder das Haus braucht „Chip übernehmen“.`,
        );
      }
    });
    // register/pc/c sind stabil genug: Listener nur bei Chain-/Contract-Wechsel neu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pc, c, chainId]);

  useEffect(() => {
    const t = setInterval(() => setScanTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const scans = listScans(chainId);
  // Gas-Warnung nur nach der Freigabe (vorher hat das Handy bewusst noch kein Guthaben)
  const lowGas = !!grants?.length && bal !== undefined && bal.value < 100_000_000_000_000n; // < 0.0001 ETH

  return (
    <div className="app">
      <header>
        <span className="logo">🥚 BDL Pets</span>
        <span className="wallet">📱 {short(me)}</span>
      </header>
      <main>
        {msg && <div className="badge nfc">{msg}</div>}

        {!c ? (
          <p className="card warn">Auf Chain {chainId} ist nichts deployt.</p>
        ) : grantsError && !grants ? (
          <section className="card warn">
            <p className="small">⚠️ Keine Verbindung zur Chain: {String((grantsError as Error).message).slice(0, 200)}</p>
            <button className="btn small" onClick={() => refetch()}>
              Nochmal versuchen
            </button>
          </section>
        ) : !grants ? (
          <p className="muted">Verbinde mit der Chain …</p>
        ) : grants.length === 0 ? (
          <section className="card">
            <h3>Anmelden</h3>
            <ol className="small">
              <li>Am PC die App öffnen, Haus → „Handy koppeln“.</li>
              <li>QR-Code mit der Kamera scannen (öffnet diese App) – oder Link hier einfügen.</li>
              <li>
                Am PC den Code <strong>{fingerprint(me)}</strong> prüfen und „Handy freigeben“ bestätigen.
              </li>
            </ol>
            <div className="row">
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="8-stelliger Code oder Kopplungs-Link" inputMode="text" />
              <button className="btn small" disabled={!manual.trim()} onClick={pairFromInput}>
                Koppeln
              </button>
            </div>
            {pair && <p className="muted small">Kopplung läuft. Code am PC: {fingerprint(me)}. Warte auf die Freigabe …</p>}
          </section>
        ) : (
          grants.map((g) => <OwnerPets key={g.owner} owner={g.owner} until={g.until} scanTick={scanTick} />)
        )}

        <section className="card">
          <h3>Gescannte Häuser</h3>
          {scans.length === 0 ? (
            <p className="muted small">Noch keiner. Handy an den NFC-Chip im Haus halten – der Scan gilt 15 Minuten.</p>
          ) : (
            scans.map((s) => (
              <p key={s.houseId.toString()} className="small">
                📡 Haus #{s.houseId.toString()} ({Math.max(0, Math.ceil(((loadScan(chainId, s.houseId)?.expiresAt ?? 0) - Date.now()) / 60000))} min)
              </p>
            ))
          )}
        </section>

        <section className="card">
          <h3>Dieses Handy</h3>
          <p className="muted small">
            Schlüssel <code>{me}</code> · Code {fingerprint(me)} · Gas {bal ? Number(formatEther(bal.value)).toFixed(4) : "…"} ETH
          </p>
          {lowGas && <p className="warn-text small">Gas fast leer: am PC „Handy freigeben“ mit etwas ETH erneut ausführen.</p>}
          <p className="muted small">Dieser Schlüssel darf nur pflegen. Verlust: am PC „Freigabe widerrufen“.</p>
          {grants && grants.length > 0 && (
            <div className="row">
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Code/Link für neues Gerät" />
              <button className="btn small" disabled={!manual.trim()} onClick={pairFromInput}>
                Neu koppeln
              </button>
            </div>
          )}
          <button className="btn small" onClick={logout}>
            Abmelden / neues Konto koppeln
          </button>
        </section>
      </main>
    </div>
  );
}
