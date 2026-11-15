import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { load } from "./lib";

/**
 * Neue Kunst ohne Neu-Deploy der Pets: PetDecor + PetAnatomy + PetRenderer deployen und per
 * PetNFT.setRenderer() umschalten. DNA, Stats, Besitz und Inventar bleiben unveraendert.
 *
 *   npx hardhat run scripts/upgrade-renderer.ts --network bdl
 */
async function main() {
  const { pets, chainId } = await load();
  const decor = await ethers.deployContract("PetDecor");
  const anatomy = await ethers.deployContract("PetAnatomy");
  await decor.waitForDeployment();
  await anatomy.waitForDeployment();
  const renderer = await ethers.deployContract("PetRenderer", [await decor.getAddress(), await anatomy.getAddress()]);
  await renderer.waitForDeployment();
  const old = await pets.renderer();
  await (await pets.setRenderer(await renderer.getAddress())).wait();
  console.log(`Renderer ${old} -> ${await renderer.getAddress()}`);

  const file = path.join(__dirname, "../../app/src/contracts/deployments.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  all[chainId.toString()].PetRenderer = await renderer.getAddress();
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  console.log("deployments.json aktualisiert (ABI unveraendert)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
