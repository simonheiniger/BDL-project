import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { load, SEED_DIR, TIER_NAMES, chipUrl } from "./lib";

/**
 * Haeuser fuer frisch gedruckte NFC-Chips praegen (nur Contract-Owner).
 * Pro Haus wird ein Chip-Schluessel erzeugt; on-chain steht nur seine Adresse. Die URL (mit privatem Schluessel im
 * Fragment) wird in contracts/seeds/houses-<chain>.csv gespeichert (gitignored!) und auf den NFC-Sticker geschrieben.
 *
 *   TIER=2 COUNT=3 npx hardhat run scripts/mint-houses.ts --network bdl        # 3x Cottage
 *   TIERS=0,0,1,4 TO=0xSpieler APP_URL=https://meine-app.vercel.app npx hardhat run scripts/mint-houses.ts --network bdl
 *
 * Stufen: 0 Huette (1 Platz) · 1 Bauernhaus (2) · 2 Cottage (3) · 3 Herrenhaus (4) · 4 Villa (5)
 */
async function main() {
  const { houses, chainId } = await load();
  const [me] = await ethers.getSigners();
  const to = process.env.TO ?? me.address;
  const tiers = process.env.TIERS
    ? process.env.TIERS.split(",").map((t) => Number(t.trim()))
    : Array<number>(Number(process.env.COUNT ?? "1")).fill(Number(process.env.TIER ?? "0"));

  fs.mkdirSync(SEED_DIR, { recursive: true });
  const file = path.join(SEED_DIR, `houses-${chainId}.csv`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "houseId,tier,owner,url\n");

  for (const tier of tiers) {
    const tag = ethers.Wallet.createRandom();
    const id: bigint = await houses.nextHouseId();
    await (await houses.mintHouse(to, tier, tag.address)).wait();
    const url = chipUrl(id, tag.privateKey);
    fs.appendFileSync(file, `${id},${TIER_NAMES[tier]},${to},${url}\n`);
    console.log(`Haus #${id} ${TIER_NAMES[tier]} -> ${to}\n  NFC: ${url}`);
  }
  console.log(`\nURLs gespeichert in ${path.relative(process.cwd(), file)} (geheim – nicht committen)`);
  console.log(`Netz ${network.name}. Jede URL als NDEF-URL-Record auf den passenden Sticker schreiben.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
