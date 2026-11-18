import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chip, chipUrl, newChip, nfcSupported, parseWriteLink, readChip, writeChip, metamaskLink, hasWallet } from "../nfc";

/**
 * NFC-Chip initialisieren – ohne Wallet nutzbar (laeuft in Chrome auf Android).
 * 1. Chip-Schluessel erzeugen, 2. URL auf den Chip schreiben, 3. Adresse on-chain eintragen (Link in MetaMask).
 */
export default function NfcSetup() {
  const [params] = useSearchParams();
  const [houseId, setHouseId] = useState(params.get("house") ?? "");
  const [lock, setLock] = useState(false);
  const [chip, setChip] = useState<Chip | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "busy"; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const supported = nfcSupported();
  // Entwickler-Ablauf: Chip-URL kommt fertig aus dem Admin-Tool (QR-Code), das Haus ist on-chain schon gepraegt
  const [job, setJob] = useState<{ url: string; houseId: string } | null>(null);
  useEffect(() => {
    const w = parseWriteLink(location.hash);
    if (w) {
      setJob(w);
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  const idOk = /^[1-9]\d{0,9}$/.test(houseId);

  async function writeJob() {
    if (!job) return;
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setStatus({ kind: "busy", text: "Chip an die Rückseite des Handys halten …" });
    try {
      await writeChip(job.url, { lock, signal: ctl.signal });
      setStatus({ kind: "busy", text: "Geschrieben. Zur Kontrolle Chip noch einmal auflegen …" });
      const back = await readChip(ctl.signal);
      if (back !== job.url) throw new Error("Kontrolle fehlgeschlagen: Chip enthält nicht die erwartete URL.");
      setStatus({ kind: "ok", text: `✅ Chip für Haus #${job.houseId} geschrieben und geprüft. Jetzt am PC „erledigt“ markieren.` });
    } catch (e) {
      const err = e as Error;
      setStatus({ kind: "err", text: err.name === "AbortError" ? "Abgebrochen." : `⚠️ ${err.message}` });
    } finally {
      ctl.abort();
    }
  }

  async function program() {
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    // Neuer Schluessel pro Schreibvorgang: ein halb beschriebener Chip hat nie einen schon verwendeten Schluessel
    const next = newChip();
    const url = chipUrl(houseId, next.key);
    setChip(null);
    setStatus({ kind: "busy", text: "Chip an die Rückseite des Handys halten …" });
    try {
      await writeChip(url, { lock, signal: ctl.signal });
      // Gegenprobe: Chip nochmal lesen
      setStatus({ kind: "busy", text: "Geschrieben. Zur Kontrolle Chip noch einmal auflegen …" });
      const back = await readChip(ctl.signal);
      if (!back.includes(next.key.slice(2))) throw new Error("Kontrolle fehlgeschlagen: Chip enthält nicht den neuen Schlüssel.");
      setChip(next);
      setStatus({ kind: "ok", text: "✅ Chip programmiert und geprüft." });
    } catch (e) {
      const err = e as Error;
      setStatus({
        kind: "err",
        text: err.name === "AbortError" ? "Abgebrochen." : `⚠️ ${err.message}`,
      });
    } finally {
      ctl.abort();
    }
  }

  const setTagLink = chip ? `${location.origin}/house/${houseId}?settag=${chip.address}` : "";

  if (job) {
    return (
      <>
        <h2>Chip für Haus #{job.houseId} beschreiben</h2>
        <section className="card">
          {!supported && (
            <p className="warn card">⚠️ Dieser Browser kann keine NFC-Chips beschreiben. Chrome auf Android mit NFC verwenden.</p>
          )}
          <p className="small">Leeren Sticker (NTAG213/215/216) bereithalten, dann „Chip beschreiben“ und den Sticker an die Handy-Rückseite halten.</p>
          <label className="row small">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Chip danach sperren (nicht mehr überschreibbar)
          </label>
          <div className="row">
            <button className="btn" disabled={!supported || status?.kind === "busy"} onClick={writeJob}>
              📡 Chip beschreiben
            </button>
            {status?.kind === "busy" && (
              <button className="btn small" onClick={() => abort.current?.abort()}>
                Abbrechen
              </button>
            )}
          </div>
          {status && <p className={status.kind === "err" ? "badge" : "badge nfc"}>{status.text}</p>}
        </section>
      </>
    );
  }

  return (
    <>
      <h2>NFC-Chip initialisieren</h2>
      <section className="card">
        {!supported && (
          <p className="warn card">
            ⚠️ Dieser Browser kann keine NFC-Chips beschreiben. Nötig: <strong>Chrome auf Android</strong> mit aktiviertem NFC,
            Seite über HTTPS. (Nicht im MetaMask-Browser, nicht iOS.) Alternative: URL aus der <code>houses-*.csv</code> mit der
            App „NFC Tools“ als URL-Record auf den Chip schreiben.
          </p>
        )}
        <ol className="small">
          <li>Haus-Nummer eingeben (die ID des Haus-NFTs).</li>
          <li>„Chip programmieren“, Chip (NTAG213/215/216) an die Handy-Rückseite halten.</li>
          <li>Danach den Link zum Eintragen in MetaMask öffnen und die Transaktion bestätigen.</li>
        </ol>
        <label className="row wrap">
          Haus #
          <input
            inputMode="numeric"
            value={houseId}
            onChange={(e) => setHouseId(e.target.value.trim())}
            placeholder="z.B. 1"
            style={{ width: "6rem" }}
          />
        </label>
        <label className="row small">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Chip danach sperren (nicht mehr
          überschreibbar – dann kann er auch nicht rotiert werden)
        </label>
        <div className="row">
          <button className="btn" disabled={!supported || !idOk || status?.kind === "busy"} onClick={program}>
            📡 Chip programmieren
          </button>
          {status?.kind === "busy" && (
            <button className="btn small" onClick={() => abort.current?.abort()}>
              Abbrechen
            </button>
          )}
        </div>
        {status && <p className={status.kind === "err" ? "badge" : "badge nfc"}>{status.text}</p>}
      </section>

      {chip && (
        <section className="card">
          <h3>Schritt 3: Adresse on-chain eintragen</h3>
          <p className="small">
            Chip-Adresse: <code>{chip.address}</code>
          </p>
          <p className="small">
            Der Contract-Owner trägt sie ein (<code>mintHouse(…, tag)</code> bei neuen Häusern) oder du als Hausbesitzer mit
            „Chip übernehmen“ auf der Hausseite:
          </p>
          <div className="row wrap">
            {hasWallet() ? (
              <Link className="btn" to={`/house/${houseId}?settag=${chip.address}`}>
                Haus #{houseId} öffnen
              </Link>
            ) : (
              <a className="btn" href={metamaskLink(setTagLink)}>
                In MetaMask öffnen
              </a>
            )}
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(setTagLink)}>
              Link kopieren
            </button>
          </div>
          <p className="muted small">
            Der private Schlüssel steht nur auf dem Chip. Wird dieser Schritt vergessen, bleibt der Chip wirkungslos („passt
            nicht zum Haus“).
          </p>
        </section>
      )}
    </>
  );
}
