import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAccount, useChainId } from "wagmi";
import { formatEther, parseEther, type Address } from "viem";
import { ACTIONS, ITEM_EMOJI, STAT_NAMES, ZERO, accountAbi, useContracts, zoneString } from "../contracts";
import { useChainQuery, useInventory, usePet, useShopItems, useTx } from "../hooks";
import { PetImage, StatBars, TxStatus, XpBar, equippedKey, getEquipped, short } from "../components/common";

export default function PetPage() {
  const { id: idParam } = useParams();
  const [search] = useSearchParams();
  const id = idParam ? BigInt(idParam) : undefined;
  const chainId = useChainId();
  const { address } = useAccount();
  const c = useContracts();
  const { data: view, isLoading } = usePet(id);
  const { data: inv } = useInventory(view?.account);
  const { data: items } = useShopItems();
  const tx = useTx();
  const [equipped, setEquipped] = useState<string | null>(null);
  const [awake, setAwake] = useState(search.has("nfc"));
  const [price, setPrice] = useState("0.05");

  useEffect(() => {
    if (id !== undefined) setEquipped(getEquipped(chainId, id));
  }, [id, chainId]);
  useEffect(() => {
    if (!awake) return;
    const t = setTimeout(() => setAwake(false), 2500);
    return () => clearTimeout(t);
  }, [awake]);

  const { data: listing } = useChainQuery(
    ["listing", id?.toString()],
    async (pc, c) => {
      const [seller, price] = (await pc.readContract({ ...c.Marketplace, functionName: "listings", args: [id] })) as [Address, bigint, bigint];
      return seller === ZERO ? null : { seller, price };
    },
    id !== undefined,
  );
  const { data: timing } = useChainQuery(["timing"], async (pc, c) => {
    const [cooldown, maxPerDay] = await Promise.all([
      pc.readContract({ ...c.PetNFT, functionName: "cooldown" }) as Promise<bigint>,
      pc.readContract({ ...c.PetNFT, functionName: "maxActionsPerDay" }) as Promise<bigint>,
    ]);
    return { cooldown: Number(cooldown), maxPerDay: Number(maxPerDay) };
  });

  if (isLoading) return <p className="muted">Lade…</p>;
  if (!view || !c) return <p>Pet #{idParam} existiert nicht (verbrannt oder nie gemintet).</p>;

  const { pet } = view;
  const isOwner = address?.toLowerCase() === view.owner.toLowerCase();

  function equip(name: string | null) {
    try {
      if (name) localStorage.setItem(equippedKey(chainId, id!), name);
      else localStorage.removeItem(equippedKey(chainId, id!));
    } catch {
      /* privater Modus */
    }
    setEquipped(name);
  }

  return (
    <>
      <TxStatus {...tx} />
      <section className="card pethero">
        <PetImage image={view.image} equipped={equipped} size={200} awake={awake} />
        <div className="grow">
          {search.has("nfc") && <div className="badge">📡 NFC-Haus gescannt – Pet aufgeweckt!</div>}
          <h2>Pet #{view.id.toString()}</h2>
          <div className="muted">
            Level {Number(pet.level)} · Generation {Number(pet.generation)} · {Number(pet.fusionCount)} Fusionen
          </div>
          <div className="muted small">
            Owner {short(view.owner)} {isOwner && "(du)"}
          </div>
          <XpBar pet={pet} />
          <StatBars stats={pet.stats} />
        </div>
      </section>

      {isOwner && (
        <section className="card">
          <h3>Pflegen</h3>
          <p className="muted small">
            +20 XP pro Aktion. Die meistgenutzte Aktion bestimmt den Fokus-Stat beim nächsten Level-Up (+3 statt +1).
            {timing && ` Cooldown ${timing.cooldown}s, max. ${timing.maxPerDay} Aktionen/Tag (heute: ${Number(pet.actionsToday)}).`}
          </p>
          <div className="row wrap">
            {ACTIONS.map((a, i) => (
              <button
                key={a.label}
                className="btn"
                disabled={!!tx.pending}
                onClick={() => {
                  setAwake(true);
                  tx.send(a.label, { ...c.PetNFT, functionName: "interact", args: [id, i] });
                }}
              >
                {a.emoji} {a.label} <span className="muted">({a.stat}, Fokus {Number(pet.focus[i])})</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h3>Pet-Wallet (ERC-6551)</h3>
        <p className="muted small">
          Adresse <code>{view.account}</code> · state {inv?.state.toString() ?? "…"}
        </p>
        <div className="row between">
          <span>💰 {inv ? formatEther(inv.eth) : "…"} ETH (Preisgelder)</span>
          {isOwner && inv && inv.eth > 0n && (
            <button
              className="btn small"
              onClick={() =>
                tx.send("ETH auszahlen", {
                  address: view.account,
                  abi: accountAbi,
                  functionName: "execute",
                  args: [address, inv.eth, "0x", 0],
                })
              }
            >
              Auszahlen
            </button>
          )}
        </div>

        <h4>Cosmetics</h4>
        {inv?.cosmetics.length === 0 && <p className="muted">Keine.</p>}
        <div className="row wrap">
          {inv?.cosmetics.map(({ item, amount }) => (
            <button
              key={item.id}
              className={`chip ${equipped === item.name ? "active" : ""}`}
              disabled={!isOwner}
              onClick={() => equip(equipped === item.name ? null : item.name)}
              title="Rein kosmetisch – kein Einfluss auf Stats"
            >
              {ITEM_EMOJI[item.name] ?? "✨"} {item.name} ×{amount.toString()}
            </button>
          ))}
        </div>

        <h4>Trophäen (Soulbound)</h4>
        {inv?.trophies.length === 0 && <p className="muted">Noch keine Siege.</p>}
        <ul className="trophies">
          {inv?.trophies.map((t) => (
            <li key={t.id.toString()}>
              🏆 Turnier #{t.tournamentId.toString()} · Zone {zoneString(t.zone)} · {t.entrants} Teilnehmer ·{" "}
              {new Date(Number(t.timestamp) * 1000).toLocaleDateString("de-CH")}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>Shop</h3>
        <p className="muted small">Items werden direkt in die Wallet dieses Pets gekauft. Nur Kosmetik – kein Pay-to-Win.</p>
        <div className="row wrap">
          {items?.map((it) => (
            <button
              key={it.id}
              className="btn"
              disabled={!!tx.pending || it.minted >= it.maxSupply}
              onClick={() =>
                tx.send(`${it.name} kaufen`, {
                  ...c.Cosmetics,
                  functionName: "buy",
                  args: [BigInt(it.id), 1n, view.account],
                  value: it.price,
                })
              }
            >
              {ITEM_EMOJI[it.name] ?? "✨"} {it.name} · {formatEther(it.price)} ETH
              <span className="muted small">
                {" "}
                ({(it.maxSupply - it.minted).toString()} übrig)
              </span>
            </button>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="card">
          <h3>Marktplatz</h3>
          {listing ? (
            <div className="row between">
              <span>Gelistet für {formatEther(listing.price)} ETH</span>
              <button className="btn small" onClick={() => tx.send("Listing entfernen", { ...c.Marketplace, functionName: "cancel", args: [id] })}>
                Zurückziehen
              </button>
            </div>
          ) : (
            <div className="row">
              <input value={price} onChange={(e) => setPrice(e.target.value)} size={8} /> ETH
              <button
                className="btn"
                disabled={!!tx.pending}
                onClick={async () => {
                  const ok = await tx.send("Marktplatz freigeben", {
                    ...c.PetNFT,
                    functionName: "approve",
                    args: [c.Marketplace.address, id],
                  });
                  if (ok) await tx.send("Listen", { ...c.Marketplace, functionName: "list", args: [id, parseEther(price)] });
                }}
              >
                Verkaufen (inkl. Inventar)
              </button>
            </div>
          )}
          <p className="muted small">
            Käufer erhält Pet + gesamte Wallet. Wird das Inventar nach dem Listing verändert, schlägt der Kauf fehl
            (Schutz über ERC-6551 <code>state</code>).
          </p>
        </section>
      )}

      <p className="muted small">
        NFC-Tag-URL für dieses Pet: <code>{`${location.origin}/pet/${view.id}?nfc`}</code>
      </p>
      <p className="muted small">Stats: {STAT_NAMES.join(", ")} – Kosmetik beeinflusst sie nie.</p>
    </>
  );
}
