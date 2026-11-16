import { useState } from "react";
import { useAccount } from "wagmi";
import { bdl } from "../wagmi";
import { formatEther } from "viem";
import { useContracts } from "../contracts";
import { useChainQuery, useMyPets, useTx, loadPet } from "../hooks";
import { NftCard, TxStatus } from "../components/common";

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
        <Onboarding />
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
