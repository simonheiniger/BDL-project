import { createWalletClient, http, type Abi, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Contracts } from "./contracts";

/**
 * Handy-App: eigener Schluessel ("Caretaker"), nicht die Haupt-Wallet. Der Besitzer berechtigt ihn am PC fuer
 * <= 90 Tage (PetNFT.authorizeCaretaker). Er darf nur `interact` – nie verkaufen, uebertragen oder fusionieren.
 */
const KEY = "bdl.caretaker-key";
const memory: { key?: Hex } = {};

export function caretakerKey(): Hex {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && /^0x[0-9a-f]{64}$/.test(stored)) return stored as Hex;
    const key = generatePrivateKey();
    localStorage.setItem(KEY, key);
    return key;
  } catch {
    return (memory.key ??= generatePrivateKey());
  }
}

export const caretakerAddress = (): Address => privateKeyToAccount(caretakerKey()).address;

/** Kurzcode zum Abgleichen am PC (gegen Unterschieben einer fremden Adresse) */
export const fingerprint = (a: string) => a.slice(2, 6).toUpperCase();

export type Grant = { owner: Address; until: number };

/** Alle Besitzer, die diesen Schluessel (noch) berechtigt haben – gegen den aktuellen Contract-Stand geprueft */
export async function loadGrants(pc: PublicClient, c: Contracts, who: Address): Promise<Grant[]> {
  const logs = await pc.getContractEvents({
    address: c.PetNFT.address,
    abi: c.PetNFT.abi,
    eventName: "CaretakerSet",
    args: { caretaker: who },
    fromBlock: 0n,
  });
  const owners = [...new Set(logs.map((l) => (l as unknown as { args: { owner: Address } }).args.owner))];
  const now = Math.floor(Date.now() / 1000);
  const grants: Grant[] = [];
  for (const owner of owners) {
    const until = Number(
      (await pc.readContract({ address: c.PetNFT.address, abi: c.PetNFT.abi, functionName: "caretakerUntil", args: [owner, who] })) as bigint,
    );
    if (until > now) grants.push({ owner, until });
  }
  return grants;
}

/** Pflege senden: signiert lokal mit dem Caretaker-Schluessel, Gas zahlt der Caretaker (vom PC beim Koppeln befuellt) */
export async function sendCare(args: {
  pc: PublicClient;
  chain: Chain;
  pets: { address: Address; abi: Abi };
  petId: bigint;
  action: number;
  expiry: bigint;
  signature: Hex;
}) {
  const wallet = createWalletClient({
    account: privateKeyToAccount(caretakerKey()),
    chain: args.chain,
    transport: http(args.chain.rpcUrls.default.http[0]),
  });
  const hash = await wallet.writeContract({
    address: args.pets.address,
    abi: args.pets.abi,
    functionName: "interact",
    args: [args.petId, args.action, args.expiry, args.signature],
  });
  const rc = await args.pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("Transaktion revertiert");
  return rc;
}
