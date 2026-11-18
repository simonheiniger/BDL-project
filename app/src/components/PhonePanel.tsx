import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useAccount, usePublicClient } from "wagmi";
import { formatEther, parseEther, type Address } from "viem";
import { useContracts } from "../contracts";
import { useChainQuery, useTx } from "../hooks";
import { TxStatus, short } from "./common";
import { clearPcPair, newPcPair, pairUrl, requestPairCode, usePair, usePhoneStatus } from "../relay";

const GRANT_DAYS = 30n;

/** Freigabe der Handy-App (Caretaker): darf nur pflegen, laeuft ab, widerrufbar */
function CaretakerAuth({ phone }: { phone: Address }) {
  const c = useContracts();
  const pc = usePublicClient();
  const { address } = useAccount();
  const tx = useTx();
  const [gas, setGas] = useState("0.02");
  const { data: until } = useChainQuery(
    ["caretaker", address, phone],
    async (pc, c) => Number((await pc.readContract({ ...c.PetNFT, functionName: "caretakerUntil", args: [address, phone] })) as bigint),
    !!address,
  );
  const { data: bal } = useChainQuery(["caretakerBal", phone], (pc) => pc.getBalance({ address: phone }));
  const active = (until ?? 0) * 1000 > Date.now();
  const code = phone.slice(2, 6).toUpperCase();
  let gasWei: bigint | null = null;
  try {
    gasWei = parseEther(gas || "0");
  } catch {
    gasWei = null;
  }

  async function authorize() {
    if (!c || !pc || gasWei === null) return;
    // Laufzeit relativ zur Chain-Zeit (der Contract prueft gegen block.timestamp)
    const now = (await pc.getBlock()).timestamp;
    await tx.send(active ? "Freigabe erneuern" : "Handy freigeben", {
      ...c.PetNFT,
      functionName: "authorizeCaretaker",
      args: [phone, now + GRANT_DAYS * 86400n],
      value: gasWei,
    });
  }

  return (
    <div>
      <p className="small">
        📱 Handy-App meldet sich mit Code <strong>{code}</strong> (<code>{short(phone)}</code>). Stimmt der Code mit der Anzeige
        auf dem Handy überein?
      </p>
      {active ? (
        <p className="small">
          ✅ Freigegeben bis {new Date((until ?? 0) * 1000).toLocaleDateString()} · Gas auf dem Handy{" "}
          {bal !== undefined ? Number(formatEther(bal)).toFixed(4) : "…"} ETH
        </p>
      ) : (
        <p className="small muted">Noch nicht freigegeben. Danach darf das Handy 30 Tage lang nur Tiere pflegen.</p>
      )}
      <div className="row wrap">
        <label className="row small">
          Gas-Guthaben (ETH)
          <input value={gas} onChange={(e) => setGas(e.target.value)} style={{ width: "5rem" }} inputMode="decimal" />
        </label>
        <button className="btn" disabled={!c || !!tx.pending || gasWei === null} onClick={authorize}>
          {active ? "Erneuern (+ Gas)" : "Handy freigeben"}
        </button>
        {active && (
          <button
            className="btn small"
            disabled={!c || !!tx.pending}
            onClick={() => tx.send("Freigabe widerrufen", { ...c!.PetNFT, functionName: "revokeCaretaker", args: [phone] })}
          >
            Freigabe widerrufen
          </button>
        )}
      </div>
      <TxStatus {...tx} />
    </div>
  );
}

/** PC-Seite: Handy per QR koppeln, App-Freigabe, Anzeige ob das Handy online ist und welche Haeuser gescannt sind */
export function PhonePanel({ houseId }: { houseId?: bigint }) {
  const pair = usePair("pc");
  const st = usePhoneStatus();
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; until: number } | null>(null);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [, tick] = useState(0);

  async function makeCode() {
    if (!pair) return;
    setCodeErr(null);
    try {
      const r = await requestPairCode(pair);
      setCode({ code: r.code, until: Date.now() + r.ttl * 1000 });
    } catch (e) {
      setCodeErr((e as Error).message);
    }
  }
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setCode(null), [pair]);

  useEffect(() => {
    if (!pair) return setQr(null);
    QRCode.toDataURL(pairUrl(pair), { margin: 1, width: 240 }).then(setQr, () => setQr(null));
  }, [pair]);

  const has = houseId !== undefined && st.houses.includes(Number(houseId));
  return (
    <section className="card">
      <h3>📱 Handy koppeln</h3>
      {!pair ? (
        <>
          <p className="small">
            Das Handy scannt nur den NFC-Chip und pflegt/füttert die Tiere. Wallet, Handel, Fusion und Arena bleiben am PC.
          </p>
          <button className="btn" onClick={() => (newPcPair(), setOpen(true))}>
            Handy koppeln
          </button>
        </>
      ) : (
        <>
          {st.caretaker ? (
            <CaretakerAuth phone={st.caretaker} />
          ) : (
            <p className="small">
              {st.online ? "✅ Handy (Browser) verbunden" : "⏳ Warte auf das Handy"}
              {houseId !== undefined && st.online && (has ? ` · Haus #${houseId} gescannt – Pflege möglich` : ` · Haus #${houseId} noch nicht gescannt`)}
            </p>
          )}
          {(open || (!st.online && !st.caretaker)) && qr && (
            <>
              <img src={qr} alt="QR-Code zum Koppeln" width={240} height={240} style={{ background: "#fff", borderRadius: 8 }} />
              <p className="muted small">QR-Code mit der Handy-Kamera scannen. Klappt das nicht: Code in der App eingeben.</p>
            </>
          )}
          {!st.caretaker && (
            <div className="small">
              {code && code.until > Date.now() ? (
                <p>
                  Kopplungs-Code: <strong style={{ letterSpacing: "0.15em", fontSize: "1.3em" }}>{code.code}</strong>{" "}
                  <span className="muted">(noch {Math.ceil((code.until - Date.now()) / 1000)} s, einmalig)</span>
                </p>
              ) : (
                <button className="btn small" onClick={makeCode}>
                  Code statt QR erzeugen
                </button>
              )}
              {codeErr && <p className="warn-text">⚠️ {codeErr}</p>}
            </div>
          )}
          <div className="row">
            <button className="btn small" onClick={() => setOpen((o) => !o)}>
              QR {open ? "ausblenden" : "anzeigen"}
            </button>
            <button className="btn small" onClick={clearPcPair}>
              Kopplung lösen
            </button>
            {st.caretaker && (
              <button className="btn small" onClick={() => (newPcPair(), setOpen(true))} title="Neuer QR-Code für ein anderes Handy">
                Anderes Handy koppeln
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
