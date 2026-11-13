import { useAccount } from "wagmi";
import { formatEther, type Address } from "viem";
import { ITEM_EMOJI, ZERO, useContracts } from "../contracts";
import { loadInventory, loadPet, useChainQuery, useShopItems, useTx } from "../hooks";
import { NftCard, TxStatus, short } from "../components/common";

export default function Market() {
  const { address } = useAccount();
  const c = useContracts();
  const { data: items } = useShopItems();
  const tx = useTx();

  // Aktive Listings: alle Listed-Events, dann aktuellen Zustand pruefen (storniert/verkauft faellt raus)
  const { data: listings } = useChainQuery(
    ["listings", items?.length],
    async (pc, c) => {
      const logs = await pc.getContractEvents({ ...c.Marketplace, eventName: "Listed", fromBlock: 0n });
      const ids = [...new Set(logs.map((l) => (l as unknown as { args: { petId: bigint } }).args.petId))];
      const out = [];
      for (const id of ids) {
        const [seller, price, accountState] = (await pc.readContract({ ...c.Marketplace, functionName: "listings", args: [id] })) as [Address, bigint, bigint];
        if (seller === ZERO) continue;
        const view = await loadPet(pc, c, id);
        if (!view || view.owner.toLowerCase() !== seller.toLowerCase()) continue;
        const inv = await loadInventory(pc, c, view.account, items!);
        out.push({ view, seller, price, accountState, inv });
      }
      return out;
    },
    !!items,
  );

  const { data: pending } = useChainQuery(
    ["marketPending", address],
    (pc, c) => pc.readContract({ ...c.Marketplace, functionName: "pending", args: [address] }) as Promise<bigint>,
    !!address,
  );

  return (
    <>
      <h2>Marktplatz</h2>
      <p className="muted">
        Beim Kauf eines Pets wechselt seine ganze Wallet mit – Cosmetics, Trophäen und Preisgeld. 2.5% Gebühr.
      </p>
      <TxStatus {...tx} />
      {c && pending !== undefined && pending > 0n && (
        <div className="card row between">
          <span>Verkaufserlös bereit: {formatEther(pending)} ETH</span>
          <button className="btn small" onClick={() => tx.send("Auszahlen", { ...c.Marketplace, functionName: "withdraw" })}>
            Auszahlen
          </button>
        </div>
      )}
      {listings?.length === 0 && <p className="muted">Keine aktiven Angebote.</p>}
      <div className="cards">
        {listings?.map(({ view, seller, price, accountState, inv }) => {
          const stale = inv.state !== accountState;
          const mine = seller.toLowerCase() === address?.toLowerCase();
          return (
            <NftCard key={view.id.toString()} view={view} link={false}>
              <div className="small inv-line">
                {inv.cosmetics.map((x) => `${ITEM_EMOJI[x.item.name] ?? "✨"}×${x.amount}`).join(" ")}{" "}
                {inv.trophies.length > 0 && `🏆×${inv.trophies.length}`} {inv.eth > 0n && `💰${formatEther(inv.eth)}`}
              </div>
              <div className="row between">
                <strong>{formatEther(price)} ETH</strong>
                <span className="muted small">von {short(seller)}</span>
              </div>
              {stale && <p className="warn small">⚠️ Inventar wurde seit dem Listing verändert – Kauf nicht möglich.</p>}
              {!mine && address && (
                <button
                  className="btn"
                  disabled={!!tx.pending || stale}
                  onClick={() =>
                    tx.send("Kaufen", {
                      ...c!.Marketplace,
                      functionName: "buy",
                      // den State mitsenden, den wir gerade angezeigt haben -> garantiert genau dieses Inventar
                      args: [view.id, inv.state],
                      value: price,
                    })
                  }
                >
                  Kaufen
                </button>
              )}
            </NftCard>
          );
        })}
      </div>
    </>
  );
}
