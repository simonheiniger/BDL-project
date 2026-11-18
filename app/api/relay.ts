// Relay PC <-> Handy: Das Handy haelt den NFC-Chip-Schluessel und signiert nur; der PC (Wallet) schickt Anfragen.
// Der Relay sieht nur Anfrage + Signatur (an Spieler/Nonce gebunden, <= 1 h gueltig) – nie den Chip-Schluessel.
// Die Pairing-ID (128 bit, vom PC erzeugt, steht nur im QR-Code) ist das Geheimnis, das beide Seiten kennen.
//
// Speicher: Upstash Redis / Vercel KV (REST). Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// (oder KV_REST_API_URL + KV_REST_API_TOKEN). Ohne Env: In-Memory (nur fuer lokale Entwicklung, nicht Serverless-tauglich).

type Cmd = (string | number)[];

const URL_ = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const REQ_TTL = 300; // s
const PRESENCE_TTL = 12; // s
const REGISTER_TTL = 3600; // s
const CODE_TTL = 300; // s, Kopplungs-Code (8 Ziffern, einmalig)
const MAX_QUEUE = 20;
const MAX_FIELD = 2048;

// ---- Speicher ---------------------------------------------------------------------------------------------------
const mem = new Map<string, { v: string | string[]; exp: number }>();
function memRun(cmd: Cmd): unknown {
  const [op, key, ...rest] = cmd as [string, string, ...(string | number)[]];
  const now = Date.now();
  const e = mem.get(key);
  const live = e && e.exp > now ? e : undefined;
  if (e && !live) mem.delete(key);
  switch (op) {
    case "SET": {
      const ex = rest[1] === "EX" ? Number(rest[2]) : 3600;
      mem.set(key, { v: String(rest[0]), exp: now + ex * 1000 });
      return "OK";
    }
    case "GET":
      return typeof live?.v === "string" ? live.v : null;
    case "RPUSH": {
      const list = Array.isArray(live?.v) ? live.v : [];
      list.push(String(rest[0]));
      mem.set(key, { v: list, exp: live?.exp ?? now + 3600_000 });
      return list.length;
    }
    case "LPOP":
      return Array.isArray(live?.v) ? (live.v.shift() ?? null) : null;
    case "LLEN":
      return Array.isArray(live?.v) ? live.v.length : 0;
    case "DEL":
      return mem.delete(key) ? 1 : 0;
    case "EXPIRE":
      if (live) live.exp = now + Number(rest[0]) * 1000;
      return live ? 1 : 0;
    default:
      throw new Error(`unsupported ${op}`);
  }
}

async function run(cmds: Cmd[]): Promise<unknown[]> {
  if (!URL_ || !TOKEN) return cmds.map(memRun);
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`store ${r.status}`);
  const out = (await r.json()) as { result?: unknown; error?: string }[];
  return out.map((o) => {
    if (o.error) throw new Error(o.error);
    return o.result;
  });
}

// ---- Handler ----------------------------------------------------------------------------------------------------
// Handy-App (Capacitor, Android) hat die Origin https://localhost; normale Aufrufe sind same-origin
const CORS = {
  "access-control-allow-origin": "https://localhost",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

/** Health-Check: zeigt, ob der Redis-Store konfiguriert ist (ohne Redis ist der Relay auf Vercel unzuverlaessig) */
export function GET(): Response {
  return json({ store: URL_ && TOKEN ? "redis" : "memory" });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

const isPair = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8,32}$/.test(s);
const isText = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= MAX_FIELD;

type Body = { a?: string; pair?: unknown; id?: unknown; payload?: unknown; sig?: unknown; expiry?: unknown; houses?: unknown; address?: unknown; code?: unknown };

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > 8 * 1024) return json({ error: "request too large" }, 413);
  let b: Body;
  try {
    b = JSON.parse(text);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (b.a === "claim") {
    // Handy loest den Code ein (einmalig) und erhaelt die Pairing-ID
    if (typeof b.code !== "string" || !/^\d{8}$/.test(b.code)) return json({ error: "bad code" }, 400);
    try {
      const [pair] = await run([["GET", `bdl:c:${b.code}`]]);
      if (!pair) return json({ error: "Code ungültig oder abgelaufen" }, 404);
      await run([["DEL", `bdl:c:${b.code}`]]);
      return json({ pair });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }
  if (!isPair(b.pair)) return json({ error: "bad pair" }, 400);
  const q = `bdl:q:${b.pair}`; // Anfragen PC -> Handy (Liste)
  const p = `bdl:p:${b.pair}`; // Handy online + freigeschaltete Haeuser
  const a = `bdl:a:${b.pair}`; // Adresse des Caretaker-Schluessels der Handy-App

  try {
    switch (b.a) {
      case "req": {
        if (!isId(b.id) || !isText(b.payload)) return json({ error: "bad request" }, 400);
        const [len] = await run([["LLEN", q]]);
        if (Number(len) >= MAX_QUEUE) return json({ error: "queue full" }, 429);
        await run([["RPUSH", q, JSON.stringify({ id: b.id, payload: b.payload })], ["EXPIRE", q, REQ_TTL]]);
        return json({ ok: true });
      }
      case "next": {
        const [item] = await run([["LPOP", q]]);
        return json({ req: item ? JSON.parse(String(item)) : null });
      }
      case "res": {
        if (!isId(b.id) || !isText(b.sig) || !isText(b.expiry)) return json({ error: "bad response" }, 400);
        await run([["SET", `bdl:s:${b.pair}:${b.id}`, JSON.stringify({ sig: b.sig, expiry: b.expiry }), "EX", REQ_TTL]]);
        return json({ ok: true });
      }
      case "poll": {
        if (!isId(b.id)) return json({ error: "bad id" }, 400);
        const [v] = await run([["GET", `bdl:s:${b.pair}:${b.id}`]]);
        return json({ res: v ? JSON.parse(String(v)) : null });
      }
      case "hello": {
        const houses = Array.isArray(b.houses) ? b.houses.filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 50) : [];
        await run([["SET", p, JSON.stringify({ houses }), "EX", PRESENCE_TTL]]);
        return json({ ok: true });
      }
      case "code": {
        // Kurzer Einmal-Code als Ersatz fuer den QR-Code (Handy ohne App-Link/Kamera): code -> Pairing-ID, 5 min gueltig
        const bytes = crypto.getRandomValues(new Uint32Array(1));
        const code = String(bytes[0] % 100_000_000).padStart(8, "0");
        const [taken] = await run([["GET", `bdl:c:${code}`]]);
        if (taken) return json({ error: "try again" }, 503);
        await run([["SET", `bdl:c:${code}`, b.pair, "EX", CODE_TTL]]);
        return json({ code, ttl: CODE_TTL });
      }
      case "register": {
        // Handy-App meldet die Adresse ihres Caretaker-Schluessels. Erste Adresse gewinnt (ein Foto vom QR-Code
        // soll sie nicht ueberschreiben koennen); der PC zeigt sie zur Kontrolle an.
        const addr = typeof b.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(b.address) ? b.address.toLowerCase() : null;
        if (!addr) return json({ error: "bad address" }, 400);
        const [cur] = await run([["GET", a]]);
        if (cur && cur !== addr) return json({ error: "already registered" }, 409);
        await run([["SET", a, addr, "EX", REGISTER_TTL]]);
        return json({ ok: true });
      }
      case "status": {
        const [v, caretaker] = await run([["GET", p], ["GET", a]]);
        return json({ ...(v ? { online: true, ...JSON.parse(String(v)) } : { online: false, houses: [] }), caretaker: caretaker ?? null });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
