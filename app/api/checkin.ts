// Check-in ("Geofence-Orakel") als Vercel-Function – gleiche Logik wie checkin/server.js.
// Prueft, ob der Spieler in der Turnier-Zone ist, und signiert dann EIP-712 fuer Arena.join().
// Der Standort selbst geht nie on-chain und wird nicht gespeichert.
//
// Env: CHECKIN_PRIVATE_KEY (eigener Key, NICHT der Deploy-Key), optional BDL_RPC_URL, DEMO_BYPASS=1
import { readFileSync } from "node:fs";
import { createPublicClient, http, isAddress, hexToString, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeGeohash } from "./_geohash.js";

const RPC_URL = process.env.BDL_RPC_URL ?? "http://185.48.228.49:8545";
const CHAIN_ID = 24888;
const VALIDITY_S = 600;

const deployments = JSON.parse(readFileSync(new URL("../src/contracts/deployments.json", import.meta.url), "utf8"));
const ARENA = deployments[String(CHAIN_ID)]?.Arena as Address;

const arenaAbi = [
  {
    type: "function",
    name: "tournaments",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "zone", type: "bytes8" },
      { name: "start", type: "uint64" },
      { name: "end", type: "uint64" },
      { name: "entryFee", type: "uint96" },
      { name: "seedCommit", type: "bytes32" },
      { name: "organizer", type: "address" },
      { name: "host", type: "address" },
      { name: "closeBlock", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "challenge", type: "uint8" },
      { name: "winnerPet", type: "uint256" },
    ],
  },
] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const key = process.env.CHECKIN_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return json({ error: "Check-in nicht konfiguriert (CHECKIN_PRIVATE_KEY fehlt)" }, 500);
  if (!ARENA) return json({ error: "kein Arena-Deployment fuer chainId 24888" }, 500);

  let body: { player?: string; petId?: number; tournamentId?: number; lat?: number; lon?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const { player, petId, tournamentId, lat, lon } = body;
  if (!player || !isAddress(player) || petId == null || tournamentId == null) {
    return json({ error: "player, petId, tournamentId erforderlich" }, 400);
  }

  const client = createPublicClient({ transport: http(RPC_URL) });
  const [zoneHex, start, end, , , , , , status] = await client.readContract({
    address: ARENA,
    abi: arenaAbi,
    functionName: "tournaments",
    args: [BigInt(tournamentId)],
  });
  if (status !== 1) return json({ error: "Turnier nicht offen" }, 400);
  const block = await client.getBlock();
  const chainNow = Number(block.timestamp);
  if (chainNow > Number(end) || chainNow < Number(start)) return json({ error: "Turnier nicht im Zeitfenster" }, 400);

  const zone = hexToString(zoneHex).replace(/\0+$/, "");
  let cell: string | null = null;
  if (process.env.DEMO_BYPASS !== "1") {
    if (typeof lat !== "number" || typeof lon !== "number") return json({ error: "Standort (lat, lon) fehlt" }, 400);
    cell = encodeGeohash(lat, lon, zone.length);
    if (cell !== zone) return json({ error: `Nicht in Zone ${zone} (du bist in ${cell})` }, 403);
  }

  const expiry = Math.max(Math.floor(Date.now() / 1000), chainNow) + VALIDITY_S;
  const account = privateKeyToAccount(key);
  const signature = await account.signTypedData({
    domain: { name: "BDL Pet Arena", version: "1", chainId: CHAIN_ID, verifyingContract: ARENA },
    types: {
      CheckIn: [
        { name: "player", type: "address" },
        { name: "petId", type: "uint256" },
        { name: "tournamentId", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "CheckIn",
    message: { player, petId: BigInt(petId), tournamentId: BigInt(tournamentId), expiry: BigInt(expiry) },
  });
  return json({ signature, expiry, zone, cell });
}
