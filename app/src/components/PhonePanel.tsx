import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { clearPcPair, newPcPair, pairUrl, usePair, usePhoneStatus } from "../relay";

/** PC-Seite: Handy per QR koppeln. Zeigt, ob das Handy online ist und welche Haeuser es gescannt hat. */
export function PhonePanel({ houseId }: { houseId?: bigint }) {
  const pair = usePair("pc");
  const st = usePhoneStatus();
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pair) return setQr(null);
    QRCode.toDataURL(pairUrl(pair), { margin: 1, width: 240 }).then(setQr, () => setQr(null));
  }, [pair]);

  const has = houseId !== undefined && st.houses.includes(Number(houseId));
  return (
    <section className="card">
      <h3>📱 Handy als NFC-Scanner</h3>
      {!pair ? (
        <>
          <p className="small">
            Koppel dein Handy: es scannt nur den NFC-Chip, alles andere (Wallet, Transaktionen) bleibt am PC.
          </p>
          <button className="btn" onClick={() => (newPcPair(), setOpen(true))}>
            Handy koppeln
          </button>
        </>
      ) : (
        <>
          <p className="small">
            {st.online ? "✅ Handy verbunden" : "⏳ Handy nicht verbunden"}
            {houseId !== undefined && st.online && (has ? ` · Haus #${houseId} gescannt – Pflege möglich` : ` · Haus #${houseId} noch nicht gescannt: Chip mit dem Handy scannen`)}
          </p>
          {(open || !st.online) && qr && (
            <>
              <img src={qr} alt="QR-Code zum Koppeln" width={240} height={240} style={{ background: "#fff", borderRadius: 8 }} />
              <p className="muted small">QR-Code mit der Handy-Kamera scannen (Link öffnet die App im Kopplungs-Modus).</p>
            </>
          )}
          <div className="row">
            <button className="btn small" onClick={() => setOpen((o) => !o)}>
              QR {open ? "ausblenden" : "anzeigen"}
            </button>
            <button className="btn small" onClick={clearPcPair}>
              Kopplung lösen
            </button>
          </div>
        </>
      )}
    </section>
  );
}
