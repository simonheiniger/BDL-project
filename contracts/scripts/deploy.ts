import { ethers, network, artifacts } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Deployt alle Contracts und schreibt Adressen + ABIs nach app/src/contracts/ (fuer das Frontend).
 *
 *   npx hardhat run scripts/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy.ts --network bdl
 *
 * Env (optional):
 *   COOLDOWN       Sekunden zwischen Aktionen   (Default 0 = Demo; Produktion 14400 = 4h)
 *   MAX_PER_DAY    Aktionen pro Tag             (Default 1000 = Demo; Produktion 6)
 *   CHECKIN_ADDRESS Adresse des Check-in-Signers (Default: Hardhat-Account #5, nur lokal!)
 */
const HARDHAT_ACCOUNT_5 = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const OUT_DIR = path.join(__dirname, "../../app/src/contracts");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const cooldown = BigInt(process.env.COOLDOWN ?? "0");
  const maxPerDay = BigInt(process.env.MAX_PER_DAY ?? "1000");
  const checkinSigner = process.env.CHECKIN_ADDRESS ?? HARDHAT_ACCOUNT_5;
  console.log(`Deploy auf ${network.name} (chainId ${chainId}) als ${deployer.address}`);
  console.log(`cooldown=${cooldown}s maxPerDay=${maxPerDay} checkinSigner=${checkinSigner}`);

  const deploy = async (name: string, args: unknown[] = []) => {
    const c = await ethers.deployContract(name, args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(16)} ${await c.getAddress()}`);
    return c;
  };

  const registry = await deploy("ERC6551Registry");
  const accountImpl = await deploy("PetAccount");
  const pets = await deploy("PetNFT", [
    await registry.getAddress(),
    await accountImpl.getAddress(),
    ethers.parseEther("0.01"),
    cooldown,
    maxPerDay,
  ]);
  const decor = await deploy("PetDecor");
  const anatomy = await deploy("PetAnatomy");
  const renderer = await deploy("PetRenderer", [await decor.getAddress(), await anatomy.getAddress()]);
  const cosmetics = await deploy("Cosmetics", ["https://bld-pets.local/cosmetics/{id}.json"]);
  const trophy = await deploy("Trophy");
  const arena = await deploy("Arena", [await pets.getAddress(), await trophy.getAddress(), checkinSigner]);
  const market = await deploy("Marketplace", [await pets.getAddress()]);

  await (await (pets as any).setGameContracts(await cosmetics.getAddress(), await trophy.getAddress())).wait();
  await (await (pets as any).setRenderer(await renderer.getAddress())).wait();
  await (await (trophy as any).setRoles(await arena.getAddress(), await pets.getAddress())).wait();

  // Reihenfolge = Item-ID 1..5; PetDecor.cosmetic(id) zeichnet genau diese Items
  const shop: [string, string, number][] = [
    ["Zylinder", "0.002", 500],
    ["Sonnenbrille", "0.001", 1000],
    ["Krone", "0.02", 50],
    ["Schal", "0.001", 1000],
    ["Fluegel", "0.05", 10],
  ];
  for (const [name, price, supply] of shop) {
    await (await (cosmetics as any).addItem(name, ethers.parseEther(price), supply)).wait();
  }

  const addresses = {
    ERC6551Registry: await registry.getAddress(),
    PetAccount: await accountImpl.getAddress(),
    PetNFT: await pets.getAddress(),
    PetRenderer: await renderer.getAddress(),
    Cosmetics: await cosmetics.getAddress(),
    Trophy: await trophy.getAddress(),
    Arena: await arena.getAddress(),
    Marketplace: await market.getAddress(),
  };

  // Adressen pro chainId sammeln (lokal + Kurs-Testnetz koennen parallel existieren)
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const depFile = path.join(OUT_DIR, "deployments.json");
  const all = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : {};
  all[chainId.toString()] = { network: network.name, deployedAt: new Date().toISOString(), ...addresses };
  fs.writeFileSync(depFile, JSON.stringify(all, null, 2));

  const abis: Record<string, unknown> = {};
  for (const name of Object.keys(addresses)) abis[name] = (await artifacts.readArtifact(name)).abi;
  fs.writeFileSync(path.join(OUT_DIR, "abis.json"), JSON.stringify(abis, null, 2));
  console.log(`-> ${path.relative(process.cwd(), depFile)} + abis.json geschrieben`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
