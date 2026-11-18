import { useState } from "react";
import { useAccount } from "wagmi";
import { bdl } from "../wagmi";
import { formatEther } from "viem";
import { Link } from "react-router-dom";
import { useContracts } from "../contracts";
import { useChainQuery, useMyHouses, useMyPets, usePetHousing, useTx, loadPet, type PetView } from "../hooks";
import { PhonePanel } from "../components/PhonePanel";
import { NftCard, TxStatus, tierInfo } from "../components/common";

/** Erste Schritte fuer neue Spieler: MetaMask, Netzwerk hinzufuegen, Test-ETH */
function Onboarding() {
  const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
  const [msg, setMsg] = useState<string | null>(null);
  async function addNetwork() {
    try {
      await eth!.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${bdl.id.toString(16)}`,
            chainName: "BDL-Test",
            nativeCurrency: { name: "Test-Ether", symbol: "TEST-ETH", decimals: 18 },
            rpcUrls: bdl.rpcUrls.default.http,
          },
        ],
      });
      setMsg("✅ Netzwerk BDL-Test ist in MetaMask eingerichtet.");
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    }
  }
  return (
    <div className="onboarding">
      <h3>Erste Schritte</h3>
      <ol>
        <li>
          {eth ? "MetaMask gefunden ✔" : <>MetaMask installieren (<a href="https://metamask.io" target="_blank" rel="noreferrer">metamask.io</a>), am Handy im MetaMask-Browser öffnen</>}
        </li>
        <li>
          Kurs-Testnetz hinzufügen{" "}
          <button className="btn small" disabled={!eth} onClick={addNetwork}>
            BDL-Test zu MetaMask hinzufügen
          </button>
        </li>
        <li>Etwas TEST-ETH besorgen (Kurs-Forum oder von einem Mitspieler), dann „MetaMask verbinden“.</li>
      </ol>
      {msg && <p className="small">{msg}</p>}
      <p className="muted small">Nur Testnetz-Coins – niemals echtes Geld oder einen echten Wallet-Account verwenden.</p>
    </div>
  );
}

/** Pet-Karte mit Hinweis, ob es in einem Haus wohnt (nur dann pflegbar) */
function PetEntry({ view }: { view: PetView }) {
  const { data: housing } = usePetHousing(view.id);
  return (
    <div className="petentry">
      <NftCard view={view} />
      {housing &&
        (housing.houseId > 0n ? (
          <Link className="badge nfc" to={`/house/${housing.houseId}`}>
            🏠 Haus #{housing.houseId.toString()} · Zufriedenheit {housing.mood}
          </Link>
        ) : (
          <span className="badge" title="Ohne Haus kann ein Pet nicht gepflegt werden">
            ⛺ Kein Haus – nicht pflegbar
          </span>
        ))}
    </div>
  );
}

export default function Home() {
  const { isConnected } = useAccount();
  const c = useContracts();
  const { data: ids } = useMyPets();
  const { data: views } = useChainQuery(
    ["myPetViews", ids?.join(",")],
    async (pc, c) => (await Promise.all(ids!.map((id) => loadPet(pc, c, id)))).filter((v) => v !== null),
    !!ids,
  );
  const { data: price } = useChainQuery(["mintPrice"], (pc, c) =>
    pc.readContract({ ...c.PetNFT, functionName: "mintPrice" }) as Promise<bigint>,
  );
  const { data: houses } = useMyHouses();
  const tx = useTx();
  const [houseSel, setHouseSel] = useState("");
  const freeHouses = (houses ?? []).filter((h) => h.occupants < tierInfo(h.tier).capacity);
  const target = freeHouses.find((h) => h.id.toString() === houseSel) ?? freeHouses[0];

  if (!isConnected) {
    return (
      <div className="card hero">
        <h1>Phygitales Web3-Tamagotchi</h1>
        <p>
          Jedes Pet ist ein NFT mit eigener Wallet (ERC-6551). Inventar, Trophäen und Preisgeld gehören dem Pet –
          und wechseln beim Verkauf automatisch mit.
        </p>
        <p className="muted">Wallet verbinden (MetaMask), um deine Pets zu sehen.</p>
        <Onboarding />
      </div>
    );
  }

  return (
    <>
      <div className="row between wrap">
        <h2>Meine Pets</h2>
        {c && price !== undefined && (
          <div className="row wrap">
            {freeHouses.length > 1 && (
              <select value={target?.id.toString() ?? ""} onChange={(e) => setHouseSel(e.target.value)}>
                {freeHouses.map((h) => (
                  <option key={h.id.toString()} value={h.id.toString()}>
                    {tierInfo(h.tier).emoji} {tierInfo(h.tier).name} #{h.id.toString()} ({tierInfo(h.tier).capacity - h.occupants} frei)
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn"
              disabled={!!tx.pending || !target}
              title={target ? "" : "Kein freier Platz – dafür brauchst du ein (weiteres) Haus"}
              onClick={() => tx.send("Pet wird geschlüpft", { ...c.PetNFT, functionName: "mint", args: [target!.id], value: price })}
            >
              🥚 Neues Pet ({formatEther(price)} ETH)
            </button>
          </div>
        )}
      </div>
      <TxStatus {...tx} />
      {houses && freeHouses.length === 0 && (
        <p className="card warn">
          🏚️ {houses.length === 0 ? "Du besitzt noch kein Haus." : "Alle deine Häuser sind voll."} Pets brauchen einen Platz in
          einem physischen 3D-Haus mit NFC-Chip (Hütte bis Villa) – neue Pets gibt es nur mit freiem Platz.
        </p>
      )}
      {views?.length === 0 && houses?.length !== 0 && <p className="muted">Noch keine Pets. Schlüpfe dein erstes!</p>}
      <div className="cards">
        {views?.map((v) => <PetEntry key={v.id.toString()} view={v} />)}
      </div>

      <div className="row between wrap">
        <h2>Meine Häuser</h2>
        <Link className="btn small" to="/nfc">📡 NFC-Chip initialisieren</Link>
      </div>
      {houses?.length === 0 && <p className="muted">Keine. Ein Haus (mit NFC-Chip) bekommst du bei einem Host oder per 3D-Druck.</p>}
      <div className="cards">
        {houses?.map((h) => {
          const t = tierInfo(h.tier);
          return (
            <Link key={h.id.toString()} to={`/house/${h.id}`} className="card housecard">
              <span className="houseicon">{t.emoji}</span>
              <strong>
                {t.name} #{h.id.toString()}
              </strong>
              <span className="muted small">
                {h.occupants}/{t.capacity} Plätze · −{t.decay} Zufriedenheit/Tag
              </span>
            </Link>
          );
        })}
      </div>
    
      <PhonePanel />
    </>
  );
}
