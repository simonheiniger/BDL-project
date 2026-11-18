import { ethers, artifacts } from "hardhat";
import fs from "fs";
import path from "path";
import { load } from "./lib";

/**
 * Neue Kunst ohne Neu-Deploy der Pets: PetDecor + SpriteBodies + SpriteExtras + PetRenderer deployen und per
 * PetNFT.setRenderer() umschalten. DNA, Stats, Besitz und Inventar bleiben unveraendert.
 *
 *   npx hardhat run scripts/upgrade-renderer.ts --network bdl
 */
async function main() {
  const { pets, chainId } = await load();
  const decor = await ethers.deployContract("PetDecor");
  const bodies = await ethers.deployContract("SpriteBodies");
  const extras = await ethers.deployContract("SpriteExtras");
  await Promise.all([decor.waitForDeployment(), bodies.waitForDeployment(), extras.waitForDeployment()]);
  const renderer = await ethers.deployContract("PetRenderer", [await decor.getAddress(), await bodies.getAddress(), await extras.getAddress()]);
  await renderer.waitForDeployment();
  const old = await pets.renderer();
  await (await pets.setRenderer(await renderer.getAddress())).wait();
  console.log(`Renderer ${old} -> ${await renderer.getAddress()}`);

  const file = path.join(__dirname, "../../app/src/contracts/deployments.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  all[chainId.toString()].PetRenderer = await renderer.getAddress();
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  const abiFile = path.join(path.dirname(file), "abis.json");
  const abis = JSON.parse(fs.readFileSync(abiFile, "utf8"));
  abis.PetRenderer = (await artifacts.readArtifact("PetRenderer")).abi;
  fs.writeFileSync(abiFile, JSON.stringify(abis, null, 2));
  console.log("deployments.json + abis.json aktualisiert");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
