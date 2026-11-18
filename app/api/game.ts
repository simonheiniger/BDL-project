// Spiele-Server: startet Runden und stellt nach geprueftem Ergebnis signierte XP-Gutscheine aus (EIP-712).
// Zustandslos: Die Runde steckt in einem verschluesselten Token (AES-256-GCM). Der Browser kann ihn weder lesen
// (Seed bleibt geheim -> Quiz-Loesungen nicht berechenbar, obwohl der Code oeffentlich ist) noch faelschen.
// Der Gutschein-Nonce wird aus der Runden-ID abgeleitet -> pro Runde hoechstens ein Gutschein (Contract prueft).
//
// Env: GAME_PRIVATE_KEY (eigener Key NUR fuer Gutscheine, nie der Deploy-Key)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GAME_KINDS, memoryLayout, memoryResult, quizRound, QUIZ, quizResult, raceObstacles, raceResult, RACE, type GameKind } from "./_games.js";

// Lokal (Hardhat): oeffentlicher Test-Key #6. Auf Vercel MUSS GAME_PRIVATE_KEY gesetzt sein.
const DEV_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const KEY = (process.env.GAME_PRIVATE_KEY ?? (process.env.VERCEL ? "" : DEV_KEY)) as `0x${string}`;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const VOUCHER_TTL_S = 7 * 24 * 3600;
const MIN_MS: Record<GameKind, number> = { memory: 8000, quiz: 10000, race: 0 };

const deployments = JSON.parse(readFileSync(new URL("../src/contracts/deployments.json", import.meta.url), "utf8"));

type Round = { id: string; kind: GameKind; petId: string; player: Address; chainId: number; seed: string; iat: number };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const tokenKey = () => Buffer.from(keccak256(toBytes(`${KEY}:game-token`)).slice(2), "hex"); // 32 Byte

function seal(r: Round) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(r)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

function open(token: string): Round | null {
  try {
    const raw = Buffer.from(String(token), "base64url");
    const d = createDecipheriv("aes-256-gcm", tokenKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const r = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString()) as Round;
    return Date.now() - r.iat > TOKEN_TTL_MS ? null : r;
  } catch {
    return null; // manipuliert oder falscher Key
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!KEY) return json({ error: "Spiele nicht konfiguriert (GAME_PRIVATE_KEY fehlt)" }, 500);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (body.op === "start") {
    const kind = body.kind as GameKind;
    if (!GAME_KINDS.includes(kind)) return json({ error: "unbekanntes Spiel" }, 400);
    const chainId = Number(body.chainId);
    if (!deployments[String(chainId)]?.PetGames) return json({ error: `keine Spiele auf Chain ${chainId}` }, 400);
    const r: Round = {
      id: randomBytes(16).toString("hex"),
      kind,
      petId: String(BigInt(String(body.petId))),
      player: String(body.player) as Address,
      chainId,
      seed: randomBytes(16).toString("hex"),
      iat: Date.now(),
    };
    // Spieldaten fuer den Browser: Memory-Layout ist sichtbar (Schummeln moeglich -> Tageslimit begrenzt Schaden),
    // Quiz-Loesungen bleiben auf dem Server, das Rennen wird nachsimuliert.
    const data =
      kind === "memory"
        ? { layout: memoryLayout(r.seed) }
        : kind === "quiz"
          ? { questions: quizRound(r.seed).map(({ id, order }) => ({ q: QUIZ[id].q, options: order.map((k) => QUIZ[id].options[k]) })) }
          : { obstacles: raceObstacles(r.seed), ...RACE };
    return json({ token: seal(r), kind, data });
  }

  if (body.op === "finish") {
    const r = open(String(body.token));
    if (!r) return json({ error: "Runde ungueltig oder abgelaufen" }, 400);
    const elapsed = Date.now() - r.iat;
    const answer = body.answer as never;
    const res =
      r.kind === "memory" ? memoryResult(r.seed, answer) : r.kind === "quiz" ? quizResult(r.seed, answer) : raceResult(r.seed, answer);
    // Plausibilitaet: nicht schneller als ein Mensch (Rennen: Spieldauer in Echtzeit)
    const minMs = r.kind === "race" ? ("ticks" in res ? res.ticks * RACE.tickMs * 0.9 : 0) : MIN_MS[r.kind];
    if (elapsed < minMs) return json({ error: "zu schnell – Runde ungueltig" }, 400);
    if (!res.ok || res.xp <= 0) return json({ result: res, voucher: null });

    const account = privateKeyToAccount(KEY);
    const voucher = {
      player: r.player,
      petId: BigInt(r.petId),
      kind: GAME_KINDS.indexOf(r.kind),
      xp: res.xp,
      nonce: BigInt(keccak256(toBytes(`bdl-game:${r.id}`))),
      expiry: BigInt(Math.floor(Date.now() / 1000) + VOUCHER_TTL_S),
    };
    const signature = await account.signTypedData({
      domain: { name: "BDL Pet Games", version: "1", chainId: r.chainId, verifyingContract: deployments[String(r.chainId)].PetGames },
      types: {
        Voucher: [
          { name: "player", type: "address" },
          { name: "petId", type: "uint256" },
          { name: "kind", type: "uint8" },
          { name: "xp", type: "uint16" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint64" },
        ],
      },
      primaryType: "Voucher",
      message: voucher,
    });
    const v = Object.fromEntries(Object.entries(voucher).map(([k, x]) => [k, typeof x === "bigint" ? x.toString() : x]));
    return json({ result: res, voucher: { ...v, chainId: r.chainId }, signature });
  }

  return json({ error: "op muss start oder finish sein" }, 400);
}
