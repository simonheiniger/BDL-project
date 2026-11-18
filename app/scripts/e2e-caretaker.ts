// Integrationstest gegen einen lokalen Hardhat-Node (npx hardhat node + deploy --network localhost):
// prueft den Caretaker-Weg der Handy-App mit dem ECHTEN App-Code (caretaker.ts, scan.ts).
//   npx tsx scripts/e2e-caretaker.ts
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import deployments from "../src/contracts/deployments.json";
import abis from "../src/contracts/abis.json";
import { caretakerAddress, loadGrants, sendCare } from "../src/caretaker";
import { scanExpiry, signScanWithKey } from "../src/scan";
import type { Abi, Address } from "viem";

const d = (deployments as Record<string, Record<string, string>>)["31337"];
const a = (n: string) => ({ address: d[n] as Address, abi: (abis as Record<string, unknown>)[n] as Abi });
const PetNFT = a("PetNFT");
const PetHouse = a("PetHouse");
const contracts = { PetNFT, PetHouse } as never;

const chain = { ...hardhat, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } };
const pc = createPublicClient({ chain, transport: http() });
// Hardhat-Account #0: Deployer = Besitzer von PetHouse (darf Haeuser pragen) und Spieler
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const wallet = createWalletClient({ account: owner, chain, transport: http() });
const send = async (c: { address: Address; abi: Abi }, functionName: string, args: unknown[], value?: bigint) => {
  const hash = await wallet.writeContract({ ...c, functionName, args, value } as never);
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} revertiert`);
  return rc;
};
const ok = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FEHLER: ${msg}`);
  console.log(`✔ ${msg}`);
};

const chipKey: Hex = generatePrivateKey();
const phone = caretakerAddress();

await send(PetHouse, "mintHouse", [owner.address, 1, privateKeyToAccount(chipKey).address]);
const houseId = ((await pc.readContract({ ...PetHouse, functionName: "nextHouseId" })) as bigint) - 1n;
const price = (await pc.readContract({ ...PetNFT, functionName: "mintPrice" })) as bigint;
await send(PetNFT, "mint", [houseId], price);
const petId = ((await pc.readContract({ ...PetNFT, functionName: "totalMinted" })) as bigint);

ok((await loadGrants(pc, contracts, phone)).length === 0, "ohne Freigabe keine Grants");

const now = (await pc.getBlock()).timestamp;
await send(PetNFT, "authorizeCaretaker", [phone, now + 30n * 86400n], parseEther("0.02"));
const grants = await loadGrants(pc, contracts, phone);
ok(grants.length === 1 && grants[0].owner.toLowerCase() === owner.address.toLowerCase(), "Grant mit Besitzer gefunden");
ok((await pc.getBalance({ address: phone })) === parseEther("0.02"), "Gas-Guthaben beim Handy");

const before = (await pc.readContract({ ...PetNFT, functionName: "getPet", args: [petId] })) as { xp: number };
const h = (await pc.readContract({ ...PetHouse, functionName: "houses", args: [houseId] })) as readonly [number, number, Address, bigint];
const expiry = await scanExpiry(pc);
const signature = await signScanWithKey(chipKey, {
  chainId: 31337,
  houses: PetHouse.address,
  houseId,
  petId,
  player: owner.address,
  nonce: h[3],
  expiry,
});
await sendCare({ pc, chain, pets: PetNFT, petId, action: 3, expiry, signature });
const after = (await pc.readContract({ ...PetNFT, functionName: "getPet", args: [petId] })) as { xp: number };
ok(Number(after.xp) > Number(before.xp), `Pflege per Caretaker-Key hat XP gebracht (${before.xp} -> ${after.xp})`);

// Replay mit derselben Signatur muss scheitern
let replay = false;
try {
  await sendCare({ pc, chain, pets: PetNFT, petId, action: 3, expiry, signature });
} catch {
  replay = true;
}
ok(replay, "Replay derselben Signatur wird abgelehnt");

await send(PetNFT, "revokeCaretaker", [phone]);
ok((await loadGrants(pc, contracts, phone)).length === 0, "nach Widerruf keine Grants");
console.log("\nAlles OK");
