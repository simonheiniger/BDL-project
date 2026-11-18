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
    houses: await ethers.getContractAt("PetHouse", dep.PetHouse),
    chainId,
  };
}

export const zone = (g: string) => ethers.zeroPadBytes(ethers.toUtf8Bytes(g), 8);
export const commitOf = (seed: string) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [seed]));

export const TIER_NAMES = ["Huette", "Bauernhaus", "Cottage", "Herrenhaus", "Villa"];

/** Chip-URL, die auf den NFC-Sticker geschrieben wird. Der Schluessel steht im Fragment (#k=...) und geht nie an einen Server. */
export const chipUrl = (houseId: bigint, tagKey: string) =>
  `${process.env.APP_URL ?? "https://bdl-pets.vercel.app"}/house/${houseId}#k=${tagKey.replace(/^0x/, "")}`;

/** EIP-712 Scan-Signatur des Chip-Schluessels (macht in der App der Browser; hier fuer Skripte/Seeds) */
export async function signScan(houses: any, tagKey: string, player: string, petId: bigint) {
  const houseId: bigint = await houses.houseOf(petId);
  const nonce: bigint = (await houses.houses(houseId)).nonce;
  const { chainId } = await ethers.provider.getNetwork();
  const latest = await ethers.provider.getBlock("latest");
  const expiry = BigInt(latest!.timestamp) + 600n;
  const sig = await new ethers.Wallet(tagKey).signTypedData(
    { name: "BDL Pet House", version: "1", chainId, verifyingContract: await houses.getAddress() },
    {
      Scan: [
        { name: "player", type: "address" },
        { name: "petId", type: "uint256" },
        { name: "houseId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    { player, petId, houseId, nonce, expiry },
  );
  return { expiry, sig };
}
