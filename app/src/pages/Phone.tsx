import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isAddress, type Address } from "viem";
import { useChainId } from "wagmi";
import deployments from "../contracts/deployments.json";
import { clearPhonePair, isPairId, phoneHello, phoneNext, phoneRespond, setPhonePair, usePair, type ScanRequest } from "../relay";
import { listScans, signScanWithKey } from "../scan";

/**
 * Handy-Seite des gekoppelten Modus: haelt den gescannten Chip-Schluessel und signiert Anfragen vom PC.
 * Der Schluessel verlaesst das Handy nie – gesendet wird nur die EIP-712-Signatur.
 */
const LOG_EVENT = "bdl-signlog";
const signLog: string[] = [];
const log = (m: string) => {
  signLog.unshift(`${new Date().toLocaleTimeString()} ${m}`);
  signLog.length = Math.min(signLog.length, 8);
  window.dispatchEvent(new Event(LOG_EVENT));
};

const num = (s: unknown) => {
  if (typeof s !== "string" || !/^\d{1,78}$/.test(s)) throw new Error("ungültige Zahl");
  return BigInt(s);
};

function parse(payload: string): { req: ScanRequest } {
  const r = JSON.parse(payload) as ScanRequest;
  if (!Number.isSafeInteger(r.chainId) || !isAddress(r.houses) || !isAddress(r.player)) throw new Error("ungültige Anfrage");
  return { req: r };
}

/** Laeuft unsichtbar in der ganzen App, solange dieses Geraet als Handy gekoppelt ist */
export function PhoneSigner() {
  const pair = usePair("phone");
  const chainId = useChainId();
  useEffect(() => {
    if (!pair) return;
    let alive = true;
    const hello = () => phoneHello(pair, listScans(chainId).map((s) => Number(s.houseId))).catch(() => {});
    const work = async () => {
      try {
        const { req: item } = await phoneNext(pair);
        if (!item || !alive) return;
        const { req } = parse(item.payload);
        const known = (deployments as Record<string, Record<string, string>>)[String(req.chainId)]?.PetHouse;
        if (!known || known.toLowerCase() !== req.houses.toLowerCase()) throw new Error("unbekannter Contract");
        const houseId = num(req.houseId);
        const scan = listScans(req.chainId).find((s) => s.houseId === houseId);
        if (!scan) throw new Error(`Haus #${houseId} nicht gescannt`);
        const expiry = num(req.expiry);
        const signature = await signScanWithKey(scan.key, {
          chainId: req.chainId,
          houses: req.houses as Address,
          houseId,
          petId: num(req.petId),
          player: req.player,
          nonce: num(req.nonce),
          expiry,
        });
        await phoneRespond(pair, item.id, signature, expiry);
        log(`✅ Haus #${houseId}, Pet #${req.petId} signiert`);
      } catch (e) {
        log(`⚠️ ${(e as Error).message}`);
      }
    };
    hello();
    const t1 = setInterval(hello, 4000);
    const t2 = setInterval(work, 1500);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [pair, chainId]);
  return null;
}

export default function PhonePage() {
  const pair = usePair("phone");
  const chainId = useChainId();
  const [, tick] = useState(0);
  useEffect(() => {
    const m = /p=([0-9a-f]{32})/.exec(location.hash);
    if (m && isPairId(m[1])) {
      setPhonePair(m[1]);
      history.replaceState(null, "", location.pathname);
    }
    const f = () => tick((n) => n + 1);
    window.addEventListener(LOG_EVENT, f);
    const t = setInterval(f, 5000);
    // Bildschirm anlassen: schlafende Tabs liefern keine Signaturen
    let lock: { release(): Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      window.removeEventListener(LOG_EVENT, f);
      clearInterval(t);
      lock?.release().catch(() => {});
    };
  }, []);

  const scans = listScans(chainId);
  return (
    <>
      <h2>Handy als NFC-Scanner</h2>
      {!pair ? (
        <p className="card warn">
          Nicht gekoppelt. Am PC in der App „Handy koppeln“ wählen und den QR-Code mit der Handy-Kamera scannen.
        </p>
      ) : (
        <section className="card">
          <p className="small">✅ Mit dem PC gekoppelt. Diese Seite offen lassen.</p>
          <p className="small">
            Jetzt den NFC-Chip des Hauses scannen. Pflegen und Bezahlen machst du am PC; das Handy signiert nur.
          </p>
          <h3>Gescannte Häuser</h3>
          {scans.length === 0 ? (
            <p className="muted small">Noch keiner (Scan gilt 15 min).</p>
          ) : (
            scans.map((s) => (
              <p key={s.houseId.toString()} className="small">
                📡 <Link to={`/house/${s.houseId}`}>Haus #{s.houseId.toString()}</Link>
              </p>
            ))
          )}
          {signLog.length > 0 && (
            <>
              <h3>Aktivität</h3>
              {signLog.map((l, i) => (
                <p key={i} className="muted small">
                  {l}
                </p>
              ))}
            </>
          )}
          <button className="btn small" onClick={clearPhonePair}>
            Kopplung lösen
          </button>
        </section>
      )}
    </>
  );
}
