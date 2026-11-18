import { ethers } from "hardhat";
import { load } from "./lib";

/**
 * Admin (Minter) fuer PetHouse eintragen oder entziehen – nur der Owner (Deployer-Key).
 *   ADMIN=0xDeineAdresse npx hardhat run scripts/set-minter.ts --network bdl
 *   ADMIN=0x... REMOVE=1 npx hardhat run scripts/set-minter.ts --network bdl
 */
async function main() {
  const { houses } = await load();
  const admin = process.env.ADMIN;
  if (!admin || !ethers.isAddress(admin)) throw new Error("ADMIN=0x... (gueltige Adresse) setzen");
  const allowed = !process.env.REMOVE;
  const [me] = await ethers.getSigners();
  if ((await houses.owner()).toLowerCase() !== me.address.toLowerCase()) throw new Error(`Signer ${me.address} ist nicht der Owner`);
  await (await houses.setMinter(admin, allowed)).wait();
  console.log(`${admin}: ${allowed ? "ist jetzt Admin" : "ist kein Admin mehr"} (canMint=${await houses.canMint(admin)})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
