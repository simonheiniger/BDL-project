import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { load, SEED_DIR } from "./lib";

/**
 * Turnier abschliessen: close() -> (mind. 1 Block warten) -> reveal(seed).
 *
 *   TID=1 npx hardhat run scripts/settle.ts --network localhost
 *   FORCE_END=1 ...   (nur lokal: Zeit bis Turnierende vorspulen)
 */
async function main() {
  const { arena, chainId } = await load();
  const tid = BigInt(process.env.TID ?? (await arena.tournamentCount()));
  const seed = fs.readFileSync(path.join(SEED_DIR, `${chainId}-${tid}.txt`), "utf8").trim();
  const t = await arena.tournaments(tid);

  if (process.env.FORCE_END && (network.name === "localhost" || network.name === "hardhat")) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(t.end) + 1]);
    await ethers.provider.send("evm_mine", []);
  }

  if (t.status === 1n) {
    const rc = await (await arena.close(tid)).wait();
    console.log(`close() in Block ${rc!.blockNumber}`);
  }
  // reveal braucht block.number > closeBlock; auf Automine-Netzen (Hardhat) einen Block erzeugen
  const closeBlock = (await arena.tournaments(tid)).closeBlock;
  while ((await ethers.provider.getBlockNumber()) <= Number(closeBlock)) {
    const [s] = await ethers.getSigners();
    await (await s.sendTransaction({ to: s.address, value: 0 })).wait();
  }

  const rc = await (await arena.reveal(tid, seed)).wait();
  const ev = rc!.logs.map((l) => arena.interface.parseLog(l)).find((e) => e?.name === "Settled");
  if (ev) {
    const [name] = await arena.getChallenge(ev.args.challenge);
    console.log(`Turnier #${tid}: Challenge "${name}", Gewinner Pet #${ev.args.winnerPet}, Trophy #${ev.args.trophyId}`);
  } else {
    console.log(`Turnier #${tid}: kein gueltiger Teilnehmer -> Refund`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
