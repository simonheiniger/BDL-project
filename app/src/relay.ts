import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { API_BASE } from "./native";

/**
 * PC <-> Handy-Kopplung. Der PC (Wallet) erzeugt eine Pairing-ID und zeigt sie als QR-Code. Das Handy scannt den
 * NFC-Chip und signiert nur die Scan-Anfragen des PCs mit dem Chip-Schluessel. Schluessel bleibt auf dem Handy.
 * Transport: /api/relay (siehe api/relay.ts), Polling.
 */
const PC_KEY = "bdl.pc-pair";
const PHONE_KEY = "bdl.phone-pair";
const EVENT = "bdl-pair";

const rand = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch {
    /* privater Modus: Kopplung gilt bis zum Reload (nicht gespeichert) */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const getPcPair = () => read(PC_KEY);
export const getPhonePair = () => read(PHONE_KEY);
export const newPcPair = () => {
  const id = rand(16);
  write(PC_KEY, id);
  return id;
};
export const clearPcPair = () => write(PC_KEY, null);
export const setPhonePair = (id: string) => write(PHONE_KEY, id);
export const clearPhonePair = () => write(PHONE_KEY, null);
export const isPairId = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{32}$/.test(s);

/** QR-Inhalt: das Handy oeffnet die App direkt im Kopplungs-Modus. ID im Fragment (geht nicht an den Webserver). */
export const pairUrl = (id: string, origin = location.origin) => `${origin}/phone#p=${id}`;

export function usePair(which: "pc" | "phone") {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    window.addEventListener(EVENT, f);
    return () => window.removeEventListener(EVENT, f);
  }, []);
  return which === "pc" ? getPcPair() : getPhonePair();
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${API_BASE}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Relay ${r.status}`);
  return j;
}

// ---- PC-Seite ----------------------------------------------------------------------------------------------------
export type PhoneStatus = { online: boolean; houses: number[]; caretaker: Address | null };

const OFFLINE: PhoneStatus = { online: false, houses: [], caretaker: null };
export const phoneStatus = (pair: string) => call<PhoneStatus>({ a: "status", pair });

/** Reaktiv: ist das Handy online und welche Haeuser hat es gescannt? */
export function usePhoneStatus(): PhoneStatus & { paired: boolean } {
  const pair = usePair("pc");
  const [s, setS] = useState<PhoneStatus>(OFFLINE);
  useEffect(() => {
    if (!pair) {
      setS(OFFLINE);
      return;
    }
    let alive = true;
    const poll = () =>
      phoneStatus(pair)
        .then((v) => alive && setS(v))
        .catch(() => alive && setS(OFFLINE));
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pair]);
  return { ...s, paired: !!pair };
}

export type ScanRequest = {
  chainId: number;
  houses: Address;
  houseId: string;
  petId: string;
  player: Address;
  nonce: string;
  expiry: string;
};

/** Signatur beim Handy anfragen (wartet bis zu `timeoutMs`) */
export async function requestScanSignature(pair: string, req: ScanRequest, timeoutMs = 30_000): Promise<{ expiry: bigint; signature: Hex }> {
  const id = rand(8);
  await call({ a: "req", pair, id, payload: JSON.stringify(req) });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1000));
    const { res } = await call<{ res: { sig: Hex; expiry: string } | null }>({ a: "poll", pair, id });
    if (res) return { expiry: BigInt(res.expiry), signature: res.sig };
  }
  throw new Error("Das Handy hat nicht geantwortet. Ist die Seite am Handy offen und der Chip gescannt?");
}

// ---- Handy-Seite -------------------------------------------------------------------------------------------------
export const phoneHello = (pair: string, houses: number[]) => call({ a: "hello", pair, houses });
export const phoneNext = (pair: string) => call<{ req: { id: string; payload: string } | null }>({ a: "next", pair });
export const phoneRespond = (pair: string, id: string, sig: Hex, expiry: bigint) =>
  call({ a: "res", pair, id, sig, expiry: expiry.toString() });

/** Handy-App meldet die Adresse ihres Caretaker-Schluessels (der PC zeigt sie zur Freigabe an) */
export const phoneRegister = (pair: string, address: Address) => call({ a: "register", pair, address });
