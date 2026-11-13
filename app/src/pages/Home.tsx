import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { useContracts } from "../contracts";
import { useChainQuery, useMyPets, useTx, loadPet } from "../hooks";
import { NftCard, TxStatus } from "../components/common";

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
  const tx = useTx();

  if (!isConnected) {
    return (
      <div className="card hero">
        <h1>Phygitales Web3-Tamagotchi</h1>
        <p>
          Jedes Pet ist ein NFT mit eigener Wallet (ERC-6551). Inventar, Trophäen und Preisgeld gehören dem Pet –
          und wechseln beim Verkauf automatisch mit.
        </p>
        <p className="muted">Wallet verbinden (MetaMask), um deine Pets zu sehen.</p>
      </div>
    );
  }

  return (
    <>
      <div className="row between">
        <h2>Meine Pets</h2>
        {c && price !== undefined && (
          <button
            className="btn"
            disabled={!!tx.pending}
            onClick={() => tx.send("Pet wird geschlüpft", { ...c.PetNFT, functionName: "mint", value: price })}
          >
            🥚 Neues Pet ({formatEther(price)} ETH)
          </button>
        )}
      </div>
      <TxStatus {...tx} />
      {views?.length === 0 && <p className="muted">Noch keine Pets. Schlüpfe dein erstes!</p>}
      <div className="cards">
        {views?.map((v) => <NftCard key={v.id.toString()} view={v} />)}
      </div>
    </>
  );
}
