import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

export const SEED_DIR = path.join(__dirname, "../seeds"); // geheime Turnier-Seeds (gitignored!)

/** Contracts anhand von app/src/contracts/deployments.json fuer die aktuelle Chain laden */
export async function load() {
  const { chainId } = await ethers.provider.getNetwork();
  const file = path.join(__dirname, "../../app/src/contracts/deployments.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8"))[chainId.toString()];
  if (!dep) throw new Error(`Kein Deployment fuer chainId ${chainId} – zuerst scripts/deploy.ts ausfuehren`);
  return {
    pets: await ethers.getContractAt("PetNFT", dep.PetNFT),
    cosmetics: await ethers.getContractAt("Cosmetics", dep.Cosmetics),
    trophy: await ethers.getContractAt("Trophy", dep.Trophy),
    arena: await ethers.getContractAt("Arena", dep.Arena),
    market: await ethers.getContractAt("Marketplace", dep.Marketplace),
    chainId,
  };
}

export const zone = (g: string) => ethers.zeroPadBytes(ethers.toUtf8Bytes(g), 8);
export const commitOf = (seed: string) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [seed]));
