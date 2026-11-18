import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { HOUSE_TIERS, useContracts } from "../contracts";
import { loadHouse, useChainQuery, useTx } from "../hooks";
import { TxStatus, short, tierInfo } from "../components/common";
import { chipUrl, newChip, writeLink } from "../nfc";

/**
 * Entwickler-Tool: Haeuser definieren (Stufe, Besitzer) und Chips vorbereiten. `mintHouse` duerfen nur der Owner von
 * PetHouse und von ihm ernannte Minter aufrufen – das erzwingt der Contract; alle anderen sehen nur die Uebersicht.
 * Chip-Schluessel entstehen hier im Browser und bleiben auf diesem PC (localStorage), bis der Chip beschrieben ist.
 */
const KEY = "bdl.admin.chips";

type Pending = { houseId: string; tier: number; to: Address; key: Hex; chain: number };

const load = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};
const save = (list: Pending[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* privater Modus: Liste nur im Speicher dieser Seite */
  }
};

function ChipJob({ p, onDone }: { p: Pending; onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const url = chipUrl(p.houseId, p.key);
  useEffect(() => {
    QRCode.toDataURL(writeLink(url), { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [url]);
  return (
    <div className="card">
      <p>
        <strong>
          {tierInfo(p.tier).emoji} {tierInfo(p.tier).name} #{p.houseId}
        </strong>{" "}
        <span className="muted small">→ {short(p.to)}</span>
      </p>
      <div className="row wrap">
        {qr && <img src={qr} alt="QR zum Beschreiben des Chips" width={160} height={160} style={{ background: "#fff", borderRadius: 8 }} />}
        <div className="grow">
          <p className="small">
            Handy (Chrome, NFC an): QR-Code scannen → „Chip beschreiben“ → Sticker auflegen. Alternativ die URL mit „NFC Tools“ als
            URL-Record schreiben.
          </p>
          <div className="row wrap">
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(url)}>
              URL kopieren
            </button>
            <button
              className="btn small"
              onClick={() => {
                if (confirm(`Chip für Haus #${p.houseId} ist beschrieben? Der Schlüssel wird von diesem PC gelöscht.`)) onDone();
              }}
            >
              ✔ Chip beschrieben
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const c = useContracts();
  const pc = usePublicClient();
  const { address } = useAccount();
  const chainId = useChainId();
  const tx = useTx();
  const [tier, setTier] = useState(0);
  const [count, setCount] = useState(1);
  const [to, setTo] = useState("");
  const [pending, setPending] = useState<Pending[]>(load);
  const [busy, setBusy] = useState(false);
  const [minterInput, setMinterInput] = useState("");

  const { data: owner } = useChainQuery(
    ["houseOwner"],
    async (pc, c) => (await pc.readContract({ ...c.PetHouse, functionName: "owner" })) as Address,
  );
  const { data: houses } = useChainQuery(["allHouses"], async (pc, c) => {
    const next = (await pc.readContract({ ...c.PetHouse, functionName: "nextHouseId" })) as bigint;
    const list = await Promise.all(Array.from({ length: Number(next) - 1 }, (_, i) => loadHouse(pc, c, BigInt(i + 1))));
    return list.filter((h) => !!h);
  });

  // Aktuelle Minter aus den MinterSet-Events rekonstruieren (letztes Event pro Adresse gilt)
  const { data: minters } = useChainQuery(["houseMinters"], async (pc, c) => {
    const logs = await pc.getContractEvents({ ...c.PetHouse, eventName: "MinterSet", fromBlock: 0n });
    const state = new Map<string, boolean>();
    for (const l of logs) {
      const a = l.args as { minter: Address; allowed: boolean };
      state.set(a.minter, a.allowed);
    }
    return [...state].filter(([, ok]) => ok).map(([m]) => m as Address);
  });

  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const isDev = isOwner || (!!address && !!minters?.some((m) => m.toLowerCase() === address.toLowerCase()));
  const recipient = (to || address || "") as string;
  const recipientOk = isAddress(recipient);
  const mine = pending.filter((p) => p.chain === chainId);

  async function mint() {
    if (!c || !pc || !recipientOk) return;
    setBusy(true);
    try {
      let list = load();
      for (let i = 0; i < count; i++) {
        const chip = newChip();
        const houseId = (await pc.readContract({ ...c.PetHouse, functionName: "nextHouseId" })) as bigint;
        // Schluessel zuerst sichern: bricht die Seite nach der Tx ab, geht er nicht verloren
        const entry: Pending = { houseId: houseId.toString(), tier, to: recipient as Address, key: chip.key, chain: chainId };
        list = [...list, entry];
        save(list);
        setPending(list);
        const rc = await tx.send(`Haus #${houseId} prägen`, {
          ...c.PetHouse,
          functionName: "mintHouse",
          args: [recipient, tier, chip.address],
        });
        if (!rc) {
          // Fehlgeschlagen: Eintrag nur entfernen, wenn das Haus on-chain wirklich nicht existiert
          // (Receipt-Timeouts koennen trotz erfolgreicher Tx als Fehler erscheinen -> Schluessel behalten)
          const next = (await pc.readContract({ ...c.PetHouse, functionName: "nextHouseId" })) as bigint;
          if (next <= houseId) {
            list = list.filter((p) => p !== entry);
            save(list);
            setPending(list);
          }
          break;
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function csv() {
    const rows = ["houseId,tier,owner,url", ...mine.map((p) => `${p.houseId},${tierInfo(p.tier).name},${p.to},${chipUrl(p.houseId, p.key)}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = `houses-${chainId}.csv`;
    a.click();
  }

  if (!c) return <p className="card warn">Auf dieser Chain ist nichts deployt.</p>;
  return (
    <>
      <h2>🛠️ Entwickler-Tool: Häuser</h2>
      <TxStatus {...tx} />
      {!address && <p className="card warn">Wallet verbinden (Entwickler-Account).</p>}
      {address && !isDev && (
        <p className="card warn">
          Nur der Entwickler ({owner ? short(owner) : "…"}) und von ihm freigeschaltete Minter können Häuser definieren. Dein Account{" "}
          {short(address)} ist keiner davon. Die Übersicht unten ist öffentlich.
        </p>
      )}

      {isDev && (
        <section className="card">
          <h3>Haus definieren</h3>
          <div className="row wrap">
            <label className="row small">
              Stufe
              <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
                {HOUSE_TIERS.map((t, i) => (
                  <option key={t.name} value={i}>
                    {t.emoji} {t.name} ({t.capacity} Plätze, −{t.decay}/Tag)
                  </option>
                ))}
              </select>
            </label>
            <label className="row small">
              Anzahl
              <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: "4rem" }} />
            </label>
          </div>
          <label className="row small">
            Besitzer
            <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={address} style={{ width: "22rem", maxWidth: "100%" }} />
          </label>
          <button className="btn" disabled={busy || !!tx.pending || !recipientOk} onClick={mint}>
            🏠 Häuser prägen
          </button>
          {!recipientOk && <p className="small warn-text">Ungültige Besitzer-Adresse.</p>}
        </section>
      )}

      {isOwner && (
        <section className="card">
          <h3>Minter</h3>
          <p className="muted small">Minter dürfen Häuser prägen, aber keine weiteren Minter ernennen.</p>
          {minters?.length === 0 && <p className="muted small">Noch keine.</p>}
          {minters?.map((m) => (
            <p key={m} className="row small">
              {m}
              <button
                className="btn small"
                disabled={!!tx.pending}
                onClick={() => tx.send(`Minter ${short(m)} entfernen`, { ...c.PetHouse, functionName: "setMinter", args: [m, false] })}
              >
                Entfernen
              </button>
            </p>
          ))}
          <label className="row small">
            Adresse
            <input value={minterInput} onChange={(e) => setMinterInput(e.target.value.trim())} placeholder="0x…" style={{ width: "22rem", maxWidth: "100%" }} />
          </label>
          <button
            className="btn"
            disabled={!!tx.pending || !isAddress(minterInput)}
            onClick={async () => {
              if (await tx.send(`Minter ${short(minterInput)} hinzufügen`, { ...c.PetHouse, functionName: "setMinter", args: [minterInput, true] }))
                setMinterInput("");
            }}
          >
            ➕ Minter hinzufügen
          </button>
        </section>
      )}

      {mine.length > 0 && (
        <section>
          <div className="row between wrap">
            <h3>Chips vorbereiten ({mine.length})</h3>
            <button className="btn small" onClick={csv}>
              CSV exportieren
            </button>
          </div>
          <p className="muted small">
            Diese Einträge enthalten die geheimen Chip-Schlüssel und liegen nur in diesem Browser. Nach dem Beschreiben des Chips
            „✔ Chip beschrieben“ drücken.
          </p>
          {mine.map((p) => (
            <ChipJob
              key={p.houseId}
              p={p}
              onDone={() => {
                const rest = load().filter((x) => !(x.houseId === p.houseId && x.chain === p.chain));
                save(rest);
                setPending(rest);
              }}
            />
          ))}
        </section>
      )}

      <section className="card">
        <h3>Alle Häuser</h3>
        {houses?.length === 0 && <p className="muted small">Noch keine.</p>}
        {houses?.map((h) => (
          <p key={h!.id.toString()} className="small">
            {tierInfo(h!.tier).emoji} {tierInfo(h!.tier).name} #{h!.id.toString()} · Besitzer {short(h!.owner)} · {h!.occupants}/
            {tierInfo(h!.tier).capacity} belegt · Chip {short(h!.tag)}
          </p>
        ))}
      </section>
    </>
  );
}
