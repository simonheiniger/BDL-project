// RPC-Proxy: Die App laeuft auf Vercel ueber https, die Kurs-RPC nur ueber http.
// Browser blockieren https -> http (Mixed Content), darum leitet diese Function serverseitig weiter.
// Nur Lese-Methoden: Transaktionen schickt MetaMask direkt an die RPC, nicht ueber uns
// ("Be nice to our Testnet" – kein offenes Tor zum Kurs-Netz).

const UPSTREAM = process.env.BDL_RPC_URL ?? "http://185.48.228.49:8545";
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
  "net_version",
]);
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 50;

type RpcReq = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "request too large" }, 413);
  let body: RpcReq | RpcReq[];
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return json({ error: "invalid batch size" }, 400);
  const denied = calls.find((c) => !c.method || !ALLOWED.has(c.method));
  if (denied) {
    return json({ jsonrpc: "2.0", id: denied.id ?? null, error: { code: -32601, message: `method not allowed: ${denied.method}` } }, 403);
  }
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return json({ error: `upstream unreachable: ${(e as Error).message}` }, 502);
  }
}
