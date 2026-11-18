import { useEffect, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PublicClient } from "viem";
import { getPhonePair } from "./relay";
import { isNative } from "./native";

/**
 * NFC-Scan: Der Chip enthaelt die URL /house/<id>#k=<privater Chip-Schluessel>. Das Fragment geht nie an einen
 * Server. Die App behaelt den Schluessel nur im sessionStorage (Tab) und nur fuer SCAN_TTL – danach muss der Chip
 * erneut gescannt werden. Jede Pflege signiert damit eine frische EIP-712-Nachricht (siehe PetHouse.scan).
 */
const SCAN_TTL_MS = 15 * 60 * 1000;
const EVENT = "bdl-scan";
const storageKey = (chainId: number, houseId: bigint) => `bdl.scan.${chainId}.${houseId}`;

/** Gekoppeltes Handy: Scan muss Tab-Wechsel/Schliessen ueberleben (Signer laeuft in einem anderen Tab) -> localStorage */
const store = (): Storage => (isNative || getPhonePair() ? localStorage : sessionStorage);

export function saveScan(chainId: number, houseId: bigint, key: Hex) {
  try {
    store().setItem(storageKey(chainId, houseId), JSON.stringify({ key, at: Date.now() }));
  } catch {
    /* Storage gesperrt (Privatmodus): Scan gilt dann nur bis zum Reload */
    memory.set(storageKey(chainId, houseId), { key, at: Date.now() });
  }
  window.dispatchEvent(new Event(EVENT));
}

const memory = new Map<string, { key: Hex; at: number }>();

export function loadScan(chainId: number, houseId: bigint): { key: Hex; expiresAt: number } | null {
  const k = storageKey(chainId, houseId);
  let v: { key: Hex; at: number } | undefined;
  try {
    const raw = sessionStorage.getItem(k) ?? localStorage.getItem(k);
    if (raw) v = JSON.parse(raw);
  } catch {
    /* ignorieren */
  }
  v ??= memory.get(k);
  if (!v || Date.now() - v.at > SCAN_TTL_MS) return null;
  return { key: v.key, expiresAt: v.at + SCAN_TTL_MS };
}

/** Alle noch gueltigen Scans dieser Chain (fuer den Handy-Signer) */
export function listScans(chainId: number): { houseId: bigint; key: Hex }[] {
  const out: { houseId: bigint; key: Hex }[] = [];
  const prefix = `bdl.scan.${chainId}.`;
  for (const st of [sessionStorage, localStorage]) {
    try {
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        if (!k?.startsWith(prefix)) continue;
        const houseId = BigInt(k.slice(prefix.length));
        if (out.some((o) => o.houseId === houseId)) continue;
        const v = loadScan(chainId, houseId);
        if (v) out.push({ houseId, key: v.key });
      }
    } catch {
      /* Storage gesperrt */
    }
  }
  return out;
}

/** Reaktiv: aktueller Scan eines Hauses (laeuft nach 15 min ab) */
export function useScan(chainId: number, houseId: bigint | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    window.addEventListener(EVENT, bump);
    const t = setInterval(bump, 15_000);
    return () => {
      window.removeEventListener(EVENT, bump);
      clearInterval(t);
    };
  }, []);
  return houseId && houseId > 0n ? loadScan(chainId, houseId) : null;
}

/** "#k=<64 hex>" -> Schluessel (oder null) */
export function parseKey(hash: string): Hex | null {
  const m = /k=(?:0x)?([0-9a-fA-F]{64})/.exec(hash);
  return m ? (`0x${m[1]}` as Hex) : null;
}

export const keyAddress = (key: Hex): Address => privateKeyToAccount(key).address;

type ScanMsg = { chainId: number; houses: Address; houseId: bigint; petId: bigint; player: Address; nonce: bigint; expiry: bigint };

/** EIP-712-Signatur des Chip-Schluessels (gleiche Struktur wie PetHouse.SCAN_TYPEHASH) */
export function signScanWithKey(key: Hex, m: ScanMsg) {
  return privateKeyToAccount(key).signTypedData({
    domain: { name: "BDL Pet House", version: "1", chainId: m.chainId, verifyingContract: m.houses },
    types: {
      Scan: [
        { name: "player", type: "address" },
        { name: "petId", type: "uint256" },
        { name: "houseId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "Scan",
    message: { player: m.player, petId: m.petId, houseId: m.houseId, nonce: m.nonce, expiry: m.expiry },
  });
}

/** Ablauf relativ zur Chain-Zeit, nicht zur Handy-Uhr */
export async function scanExpiry(pc: PublicClient) {
  return (await pc.getBlock()).timestamp + 600n;
}

/** Scan-Signatur mit lokalem Schluessel (Handy-Wallet-Modus) */
export async function signScan(args: Omit<ScanMsg, "expiry"> & { pc: PublicClient; key: Hex }) {
  const expiry = await scanExpiry(args.pc);
  return { expiry, signature: await signScanWithKey(args.key, { ...args, expiry }) };
}
