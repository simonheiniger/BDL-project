import { ethers, network } from "hardhat";
import { load } from "./lib";

/**
 * Demo-Daten fuer den ersten Account (setzt Deploy mit COOLDOWN=0 voraus):
 *   #1 Lv 5 (Erwachsen) mit Krone angezogen   #2 Lv 5 (fusionsbereit) mit Sonnenbrille im TBA
 *   #3 Lv 1 (Ei)    #4 Lv 3 (Baby)    #5 Lv 15 (Legendaer, nur lokal – ~800 Transaktionen)
 *
 *   npx hardhat run scripts/seed-demo.ts --network localhost
 *   LEGEND=1 ... --network bdl   (Legendaer-Pet auch auf dem Testnetz)
 */
async function main() {
  const { pets, cosmetics } = await load();
  const [me] = await ethers.getSigners();
  const price = await pets.mintPrice();
  const legend = network.name !== "bdl" || process.env.LEGEND === "1";

  const ids: bigint[] = [];
  for (let i = 0; i < (legend ? 5 : 4); i++) {
    const rc = await (await pets.mint({ value: price })).wait();
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
    for (let i = 0; i < n; i++) await (await pets.interact(id, action)).wait();
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
