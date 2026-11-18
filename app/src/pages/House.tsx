import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useAccount, useChainId } from "wagmi";
import { ACTIONS, useContracts } from "../contracts";
import { loadPet, useCare, useChainQuery, useHouse, useHousePets, useMyPets, usePetHousing, useTx } from "../hooks";
import { MoodBar, NftCard, TxStatus, short, tierInfo } from "../components/common";
import { keyAddress, parseKey, saveScan, useScan } from "../scan";

/** Ein Bewohner mit Zufriedenheit und Pflege-Buttons (nur mit aktivem Scan) */
function Resident({ petId, houseId, canCare, isOwner }: { petId: bigint; houseId: bigint; canCare: boolean; isOwner: boolean }) {
  const c = useContracts();
  const tx = useTx();
  const care = useCare(tx);
  const { data: view } = useChainQuery(["residentView", petId.toString()], (pc, c) => loadPet(pc, c, petId));
  const { data: housing } = usePetHousing(petId);
  if (!view) return null;
  return (
    <div className="resident">
      <TxStatus {...tx} />
      <NftCard view={view} size="sm" />
      <div className="grow">
        <MoodBar mood={housing?.mood ?? 0} />
        {isOwner && (
          <div className="row wrap">
            {ACTIONS.map((a, i) => (
              <button
                key={a.label}
                className="btn small"
                disabled={!canCare || !!tx.pending}
                title={canCare ? a.label : "Erst den NFC-Chip scannen"}
                onClick={() => care(petId, houseId, i, a.label)}
              >
                {a.emoji}
              </button>
            ))}
            <button
              className="btn small"
              disabled={!!tx.pending || !c}
              onClick={() => c && tx.send("Ausziehen", { ...c.PetHouse, functionName: "moveOut", args: [petId] })}
            >
              Ausziehen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HousePage() {
  const { id: idParam } = useParams();
  const { hash } = useLocation();
  const id = idParam ? BigInt(idParam) : undefined;
  const chainId = useChainId();
  const { address } = useAccount();
  const c = useContracts();
  const { data: house, isLoading } = useHouse(id);
  const { data: residents } = useHousePets(id);
  const { data: myPetIds } = useMyPets();
  const { data: myHousing } = useChainQuery(
    ["myHousing", myPetIds?.join(",")],
    async (pc, c) =>
      Promise.all(
        myPetIds!.map(async (pid) => ({
          id: pid,
          houseId: (await pc.readContract({ ...c.PetHouse, functionName: "houseOf", args: [pid] })) as bigint,
        })),
      ),
    !!myPetIds,
  );
  const tx = useTx();
  const scan = useScan(chainId, id);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // NFC-Scan: URL-Fragment #k=<Chip-Schluessel> pruefen, merken, aus der Adressleiste entfernen
  useEffect(() => {
    const key = parseKey(hash);
    if (!key || !house || id === undefined) return;
    if (keyAddress(key).toLowerCase() === house.tag.toLowerCase()) {
      saveScan(chainId, id, key);
      setScanMsg("📡 Chip gescannt – Pflege 15 Minuten freigeschaltet.");
    } else {
      setScanMsg("⚠️ Dieser Chip passt nicht zum Haus (Chip wurde neu programmiert oder URL ist falsch).");
    }
    history.replaceState(null, "", location.pathname + location.search);
  }, [hash, house, id, chainId]);

  if (isLoading) return <p className="muted">Lade…</p>;
  if (!house || !c || id === undefined) return <p>Haus #{idParam} existiert nicht.</p>;

  const t = tierInfo(house.tier);
  const isOwner = address?.toLowerCase() === house.owner.toLowerCase();
  const free = t.capacity - house.occupants;
  const homeless = (myHousing ?? []).filter((p) => p.houseId === 0n);
  const minsLeft = scan ? Math.max(0, Math.ceil((scan.expiresAt - Date.now()) / 60000)) : 0;

  return (
    <>
      <TxStatus {...tx} />
      <section className="card house">
        <div className="househead">
          <span className="houseicon">{t.emoji}</span>
          <div className="grow">
            <h2>
              {t.name} #{id.toString()}
            </h2>
            <p className="muted small">
              Besitzer {short(house.owner)} {isOwner && "(du)"} · {house.occupants}/{t.capacity} Plätze belegt · Zufriedenheit
              sinkt um {t.decay} pro Tag
            </p>
          </div>
        </div>
        {scanMsg && <div className="badge nfc">{scanMsg}</div>}
        {scan ? (
          <p className="small">
            ✅ Gescannt – Pflege noch ca. {minsLeft} min freigeschaltet.
          </p>
        ) : (
          <p className="small">
            📡 <strong>Zum Pflegen den NFC-Chip dieses Hauses mit dem Handy scannen.</strong> Ohne Scan lehnt der Contract
            jede Pflege ab.
          </p>
        )}
      </section>

      <h3>Bewohner</h3>
      {residents?.length === 0 && <p className="muted">Leer.</p>}
      <div className="residents">
        {residents?.map((pid) => (
          <Resident key={pid.toString()} petId={pid} houseId={id} canCare={!!scan} isOwner={isOwner} />
        ))}
      </div>

      {isOwner && free > 0 && (
        <section className="card">
          <h3>Freie Plätze: {free}</h3>
          {homeless.length === 0 ? (
            <p className="muted small">
              Keine Pets ohne Haus. Auf der <Link to="/">Startseite</Link> ein neues Pet in dieses Haus schlüpfen lassen.
            </p>
          ) : (
            <div className="row wrap">
              {homeless.map((p) => (
                <button
                  key={p.id.toString()}
                  className="btn"
                  disabled={!!tx.pending}
                  onClick={() => tx.send("Einziehen", { ...c.PetHouse, functionName: "moveIn", args: [p.id, id] })}
                >
                  Pet #{p.id.toString()} einziehen lassen
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
