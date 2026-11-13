import { ethers } from "hardhat";
import { load } from "./lib";

/**
 * Demo-Daten: 3 Pets fuer den ersten Account, zwei davon auf Level 5 (fusionsbereit),
 * Cosmetics in den TBAs. Setzt Deploy mit COOLDOWN=0 voraus.
 *
 *   npx hardhat run scripts/seed-demo.ts --network localhost
 */
async function main() {
  const { pets, cosmetics } = await load();
  const [me] = await ethers.getSigners();
  const price = await pets.mintPrice();

  const ids: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    const rc = await (await pets.mint({ value: price })).wait();
    const ev = rc!.logs.map((l) => pets.interface.parseLog(l)).find((e) => e?.name === "Minted")!;
    ids.push(ev.args.petId);
  }
  console.log(`Pets ${ids.join(", ")} fuer ${me.address} gemintet`);

  // 43 Aktionen = 860 XP -> Level 5
  for (const [id, action] of [
    [ids[0], 0],
    [ids[1], 2],
  ] as const) {
    for (let i = 0; i < 43; i++) await (await pets.interact(id, action)).wait();
    console.log(`Pet #${id} -> Level ${(await pets.getPet(id)).level}`);
  }

  const item1 = await cosmetics.items(1);
  const item2 = await cosmetics.items(2);
  await (await cosmetics.buy(1, 1, await pets.accountOf(ids[0]), { value: item1.price })).wait();
  await (await cosmetics.buy(2, 2, await pets.accountOf(ids[1]), { value: item2.price * 2n })).wait();
  console.log("Cosmetics in TBAs gekauft");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
