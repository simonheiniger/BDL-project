import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { useAccount, useChainId } from "wagmi";
import { ACTIONS, useContracts } from "../contracts";
import { loadPet, useCare, useChainQuery, useHouse, useHousePets, useMyPets, usePetHousing, useTx } from "../hooks";
import { MoodBar, NftCard, TxStatus, short, tierInfo } from "../components/common";
import { keyAddress, parseKey, saveScan, useScan } from "../scan";
import { hasWallet } from "../nfc";
import { PhonePanel } from "../components/PhonePanel";
import { usePhoneStatus, usePair, getPhonePair, clearPhonePair } from "../relay";

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
  const [search] = useSearchParams();
  const rawTag = search.get("settag");
  const newTag = rawTag && isAddress(rawTag) ? rawTag : null;
  const scan = useScan(chainId, id);
  const phone = usePhoneStatus();
  const isPhone = !!usePair("phone");
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
    // Ohne Wallet (normaler Handy-Browser) Fragment behalten: der "In MetaMask öffnen"-Link braucht es
    if (hasWallet() || getPhonePair()) history.replaceState(null, "", location.pathname + location.search);
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
        {isPhone ? (
          <p className="small">
            📱 Dieses Gerät ist als NFC-Scanner gekoppelt: {scan ? "Chip gescannt ✅ – gepflegt wird am PC." : "Chip scannen, dann am PC pflegen."}{" "}
            <button className="btn small" onClick={clearPhonePair}>
              Kopplung lösen
            </button>
          </p>
        ) : scan ? (
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

      {!isPhone && <PhonePanel houseId={id} />}

      <h3>Bewohner</h3>
      {residents?.length === 0 && <p className="muted">Leer.</p>}
      <div className="residents">
        {residents?.map((pid) => (
          <Resident key={pid.toString()} petId={pid} houseId={id} canCare={!!scan || (phone.online && id !== undefined && phone.houses.includes(Number(id)))} isOwner={isOwner} />
        ))}
      </div>

      {isOwner && (
        <section className="card">
          <h3>NFC-Chip</h3>
          {newTag && newTag.toLowerCase() !== house.tag.toLowerCase() ? (
            <>
              <p className="small">
                Neuer Chip <code>{short(newTag)}</code> erkannt. Übernehmen? Der alte Chip wird damit wertlos.
              </p>
              <button
                className="btn"
                disabled={!!tx.pending}
                onClick={() => tx.send("Chip übernehmen", { ...c.PetHouse, functionName: "setTag", args: [id, newTag] })}
              >
                Chip übernehmen
              </button>
            </>
          ) : (
            <p className="small muted">
              Aktiver Chip: <code>{short(house.tag)}</code>
            </p>
          )}
          <Link className="btn small" to={`/nfc?house=${id}`}>
            Neuen Chip programmieren
          </Link>
        </section>
      )}

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
