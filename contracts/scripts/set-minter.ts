// Haus-Minter setzen/entziehen: MINTER=0x... [ALLOWED=0] npx hardhat run scripts/set-minter.ts --network bdl
import { ethers, network } from "hardhat";
import deployments from "../../app/src/contracts/deployments.json";

async function main() {
  const chainId = String(network.config.chainId ?? 31337);
  const addr = (deployments as Record<string, Record<string, string>>)[chainId]?.PetHouse;
  if (!addr) throw new Error(`kein PetHouse auf ${chainId}`);
  const minter = process.env.MINTER;
  if (!minter || !ethers.isAddress(minter)) throw new Error("MINTER=0x... fehlt");
  const allowed = process.env.ALLOWED !== "0";
  const houses = await ethers.getContractAt("PetHouse", addr);
  await (await houses.setMinter(minter, allowed)).wait();
  console.log(`Minter ${minter}: ${await houses.minters(minter)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
