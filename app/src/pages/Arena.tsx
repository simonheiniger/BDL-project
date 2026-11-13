import { useState } from "react";
import { useAccount } from "wagmi";
import { formatEther, type Address } from "viem";
import { useContracts, zoneString } from "../contracts";
import { winProbabilities } from "../gamemath";
import { useChainQuery, useMyPets, useTx } from "../hooks";
import { TxStatus, short } from "../components/common";

const CHECKIN_URL = import.meta.env.VITE_CHECKIN_URL ?? `http://${location.hostname}:8787`;
const STATUS = ["–", "Offen", "Geschlossen", "Entschieden", "Erstattet"];
// Fallback, falls Geolocation nicht verfuegbar (z.B. Handy ueber http statt https)
const ZHAW = { lat: 47.4973, lon: 8.7293 };

type Entry = { petId: bigint; player: Address; stats: readonly number[]; level: number };
type T = {
  id: bigint;
  zone: string;
  start: number;
  end: number;
  entryFee: bigint;
  host: Address;
  status: number;
  challenge: number;
  winnerPet: bigint;
  entries: Entry[];
};

function getPosition(): Promise<{ lat: number; lon: number; real: boolean }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ...ZHAW, real: false });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, real: true }),
      () => resolve({ ...ZHAW, real: false }),
      { timeout: 8000 },
    );
  });
}

export default function Arena() {
  const { address } = useAccount();
  const c = useContracts();
  const { data: myPets } = useMyPets();
  const tx = useTx();
  const [petFor, setPetFor] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);

  const { data } = useChainQuery(["arena"], async (pc, c) => {
    const n = Number(await pc.readContract({ ...c.Arena, functionName: "tournamentCount" }));
    const nCh = Number(await pc.readContract({ ...c.Arena, functionName: "challengeCount" }));
    const challenges = [];
    for (let i = 0; i < nCh; i++) {
      const [name, weights] = (await pc.readContract({ ...c.Arena, functionName: "getChallenge", args: [BigInt(i)] })) as [string, readonly number[]];
      challenges.push({ name, weights: weights.map(Number) });
    }
    const list: T[] = [];
    for (let i = n; i >= 1; i--) {
      const t = (await pc.readContract({ ...c.Arena, functionName: "tournaments", args: [BigInt(i)] })) as readonly unknown[];
      const entries = (await pc.readContract({ ...c.Arena, functionName: "getEntries", args: [BigInt(i)] })) as Entry[];
      list.push({
        id: BigInt(i),
        zone: zoneString(t[0] as string),
        start: Number(t[1]),
        end: Number(t[2]),
        entryFee: t[3] as bigint,
        host: t[6] as Address,
        status: Number(t[8]),
        challenge: Number(t[9]),
        winnerPet: t[10] as bigint,
        entries: entries.map((e) => ({ ...e, stats: e.stats.map(Number), level: Number(e.level) })),
      });
    }
    const block = await pc.getBlock();
    return { list, challenges, now: Number(block.timestamp) };
  });

  const { data: pending } = useChainQuery(
    ["arenaPending", address],
    (pc, c) => pc.readContract({ ...c.Arena, functionName: "pending", args: [address] }) as Promise<bigint>,
    !!address,
  );

  async function join(t: T) {
    const petId = petFor[t.id.toString()] ?? myPets?.[0]?.toString();
    if (!petId || !c || !address) return;
    setInfo("📍 Standort wird geprüft …");
    const pos = await getPosition();
    let res: Response;
    try {
      res = await fetch(`${CHECKIN_URL}/checkin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: address, petId: Number(petId), tournamentId: Number(t.id), lat: pos.lat, lon: pos.lon }),
      });
    } catch {
      setInfo(`Check-in-Service nicht erreichbar (${CHECKIN_URL})`);
      return;
    }
    const body = await res.json();
    if (!res.ok) {
      setInfo(`❌ Check-in abgelehnt: ${body.error}`);
      return;
    }
    setInfo(`✅ Check-in in Zone ${body.zone}${pos.real ? "" : " (Demo-Standort ZHAW)"} – Signatur erhalten, jetzt anmelden.`);
    await tx.send("Anmelden", {
      ...c.Arena,
      functionName: "join",
      args: [t.id, BigInt(petId), BigInt(body.expiry), body.signature],
      value: t.entryFee,
    });
  }

  return (
    <>
      <h2>Arena – regionale Turniere</h2>
      <p className="muted">
        Anmelden nur mit Check-in in der Zone (Geohash). Die Challenge wird erst beim Reveal ausgelost; höhere Stats
        und Level erhöhen die Gewinnchance, garantieren aber keinen Sieg.
      </p>
      <TxStatus {...tx} />
      {info && <div className="toast">{info}</div>}
      {c && pending !== undefined && pending > 0n && (
        <div className="card row between">
          <span>Guthaben (Erstattungen/Host-Anteil): {formatEther(pending)} ETH</span>
          <button className="btn small" onClick={() => tx.send("Auszahlen", { ...c.Arena, functionName: "withdraw" })}>
            Auszahlen
          </button>
        </div>
      )}
      {data?.list.length === 0 && <p className="muted">Noch keine Turniere.</p>}
      {data?.list.map((t) => {
        const open = t.status === 1 && data.now >= t.start && data.now <= t.end;
        const joined = t.entries.some((e) => e.player.toLowerCase() === address?.toLowerCase());
        return (
          <section key={t.id.toString()} className="card">
            <div className="row between">
              <h3>
                Turnier #{t.id.toString()} · Zone <code>{t.zone}</code>
              </h3>
              <span className={`badge s${t.status}`}>{STATUS[t.status]}</span>
            </div>
            <div className="muted small">
              {new Date(t.start * 1000).toLocaleString("de-CH")} – {new Date(t.end * 1000).toLocaleString("de-CH")} ·
              Startgeld {formatEther(t.entryFee)} ETH · Pool {formatEther(t.entryFee * BigInt(t.entries.length))} ETH
              (70% Sieger-Pet, 20% Host {short(t.host)}, 10% Treasury)
            </div>

            {t.status === 3 && (
              <p>
                🏆 Challenge <strong>{data.challenges[t.challenge]?.name}</strong> – Sieger: Pet #{t.winnerPet.toString()}
              </p>
            )}

            {t.entries.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Pet</th>
                    <th>Lv</th>
                    {data.challenges.map((ch) => (
                      <th key={ch.name} title={`Gewichte STR/AGI/INT/VIT: ${ch.weights.join("/")}`}>
                        {ch.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.entries.map((e, i) => (
                    <tr key={e.petId.toString()} className={t.status === 3 && e.petId === t.winnerPet ? "winner" : ""}>
                      <td>#{e.petId.toString()}</td>
                      <td>{e.level}</td>
                      {data.challenges.map((ch) => (
                        <td key={ch.name}>{(winProbabilities(t.entries, ch.weights)[i] * 100).toFixed(1)}%</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {open && address && !joined && (myPets?.length ?? 0) > 0 && (
              <div className="row">
                <select value={petFor[t.id.toString()] ?? ""} onChange={(e) => setPetFor({ ...petFor, [t.id.toString()]: e.target.value })}>
                  {myPets!.map((id) => (
                    <option key={id.toString()} value={id.toString()}>
                      Pet #{id.toString()}
                    </option>
                  ))}
                </select>
                <button className="btn" disabled={!!tx.pending} onClick={() => join(t)}>
                  📍 Einchecken & anmelden
                </button>
              </div>
            )}
            {joined && t.status === 1 && <p className="muted">Angemeldet ✔ – warte auf Auslosung.</p>}
          </section>
        );
      })}
    </>
  );
}
