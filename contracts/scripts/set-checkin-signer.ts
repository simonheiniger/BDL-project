import { load } from "./lib";

/**
 * Check-in-Signer der Arena austauschen (nur Owner). Eigener Key statt Deploy-Key:
 * Wer den Check-in-Key hat, kann nur Check-ins faelschen – nicht die Contracts steuern.
 *
 *   CHECKIN_ADDRESS=0x... npx hardhat run scripts/set-checkin-signer.ts --network bdl
 */
async function main() {
  const { arena } = await load();
  const signer = process.env.CHECKIN_ADDRESS;
  if (!signer) throw new Error("CHECKIN_ADDRESS fehlt");
  console.log(`Check-in-Signer ${await arena.checkinSigner()} -> ${signer}`);
  await (await arena.setCheckinSigner(signer)).wait();
  console.log("ok:", await arena.checkinSigner());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
