import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { load, SEED_DIR, TIER_NAMES, chipUrl, signScan } from "./lib";

/**
 * Demo-Daten fuer den ersten Account (inkl. Villa + Huette mit simulierten NFC-Chips) (setzt Deploy mit COOLDOWN=0 voraus):
 *   #1 Lv 5 (Erwachsen) mit Krone angezogen   #2 Lv 5 (fusionsbereit) mit Sonnenbrille im TBA
 *   #3 Lv 1 (Ei)    #4 Lv 3 (Baby)    #5 Lv 15 (Legendaer, nur lokal – ~800 Transaktionen)
 *
 *   npx hardhat run scripts/seed-demo.ts --network localhost
 *   LEGEND=1 ... --network bdl   (Legendaer-Pet auch auf dem Testnetz)
 */
async function main() {
  const { pets, cosmetics, houses, chainId } = await load();
  const [me] = await ethers.getSigners();
  const price = await pets.mintPrice();
  const legend = network.name !== "bdl" || process.env.LEGEND === "1";

  // Haeuser: Villa (5 Plaetze) fuer alle Demo-Pets, Huette zum Vergleich. Chip-URLs landen in seeds/ (gitignored).
  const tags: Record<string, string> = {};
  fs.mkdirSync(SEED_DIR, { recursive: true });
  const csv = path.join(SEED_DIR, `houses-${chainId}.csv`);
  if (!fs.existsSync(csv)) fs.writeFileSync(csv, "houseId,tier,owner,url\n");
  const makeHouse = async (tier: number) => {
    const tag = ethers.Wallet.createRandom();
    const id: bigint = await houses.nextHouseId();
    await (await houses.mintHouse(me.address, tier, tag.address)).wait();
    tags[id.toString()] = tag.privateKey;
    fs.appendFileSync(csv, `${id},${TIER_NAMES[tier]},${me.address},${chipUrl(id, tag.privateKey)}\n`);
    console.log(`Haus #${id} ${TIER_NAMES[tier]}: ${chipUrl(id, tag.privateKey)}`);
    return id;
  };
  const villa = await makeHouse(4);
  await makeHouse(0);

  const ids: bigint[] = [];
  for (let i = 0; i < (legend ? 5 : 4); i++) {
    const rc = await (await pets.mint(villa, { value: price })).wait();
    const ev = rc!.logs.map((l) => pets.interface.parseLog(l)).find((e) => e?.name === "Minted")!;
    ids.push(ev.args.petId);
  }
  console.log(`Pets ${ids.join(", ")} fuer ${me.address} gemintet`);

  // XP: Lv5 = 43 Aktionen, Lv3 = 10, Lv15 = 800
  const plan: [bigint, number, number][] = [
    [ids[0], 43, 0],
    [ids[1], 43, 2],
    [ids[3], 10, 1],
  ];
  if (legend) plan.push([ids[4], 800, 3]);
  for (const [id, n, action] of plan) {
    for (let i = 0; i < n; i++) {
      const { expiry, sig } = await signScan(houses, tags[villa.toString()], me.address, id);
      await (await pets.interact(id, action, expiry, sig, { value: await pets.careFee() })).wait();
    }
    console.log(`Pet #${id} -> Level ${(await pets.getPet(id)).level}`);
  }

  const buy = async (itemId: number, petId: bigint, amount = 1n) => {
    const item = await cosmetics.items(itemId);
    await (await cosmetics.buy(itemId, amount, await pets.accountOf(petId), { value: item.price * amount })).wait();
  };
  await buy(3, ids[0]); // Krone
  await buy(1, ids[0]); // Zylinder
  await buy(2, ids[1], 2n); // Sonnenbrille
  await (await pets.equip(ids[0], 3)).wait();
  await (await pets.equip(ids[1], 2)).wait();
  if (legend) {
    await buy(5, ids[4]); // Fluegel
    await (await pets.equip(ids[4], 5)).wait();
  }
  console.log("Cosmetics gekauft und angezogen");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
