import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { load, zone, commitOf, SEED_DIR } from "./lib";

/**
 * Turnier anlegen. Seed wird lokal geheim gespeichert, nur der Hash geht on-chain (Commit).
 *
 *   ZONE=u0qnnw MINUTES=30 FEE=0.001 npx hardhat run scripts/create-tournament.ts --network localhost
 */
async function main() {
  const { arena, chainId } = await load();
  const [organizer] = await ethers.getSigners();
  const geohash = process.env.ZONE ?? "u0qnnw"; // ZHAW Winterthur (Technikumstrasse)
  const minutes = BigInt(process.env.MINUTES ?? "30");
  const fee = ethers.parseEther(process.env.FEE ?? "0.001");
  const host = process.env.HOST ?? organizer.address;

  const seed = ethers.hexlify(ethers.randomBytes(32));
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const rc = await (await arena.createTournament(zone(geohash), now, now + minutes * 60n, fee, commitOf(seed), host)).wait();
  const tid = await arena.tournamentCount();

  fs.mkdirSync(SEED_DIR, { recursive: true });
  fs.writeFileSync(path.join(SEED_DIR, `${chainId}-${tid}.txt`), seed);
  console.log(`Turnier #${tid} in Zone ${geohash}, ${minutes} min, Fee ${ethers.formatEther(fee)} ETH (tx ${rc!.hash})`);
  console.log(`Seed geheim gespeichert in seeds/${chainId}-${tid}.txt`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
