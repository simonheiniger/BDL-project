import { useEffect, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PublicClient } from "viem";

/**
 * NFC-Scan: Der Chip enthaelt die URL /house/<id>#k=<privater Chip-Schluessel>. Das Fragment geht nie an einen
 * Server. Die App behaelt den Schluessel nur im sessionStorage (Tab) und nur fuer SCAN_TTL – danach muss der Chip
 * erneut gescannt werden. Jede Pflege signiert damit eine frische EIP-712-Nachricht (siehe PetHouse.scan).
 */
const SCAN_TTL_MS = 15 * 60 * 1000;
const EVENT = "bdl-scan";
const storageKey = (chainId: number, houseId: bigint) => `bdl.scan.${chainId}.${houseId}`;

export function saveScan(chainId: number, houseId: bigint, key: Hex) {
  try {
    sessionStorage.setItem(storageKey(chainId, houseId), JSON.stringify({ key, at: Date.now() }));
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
    const raw = sessionStorage.getItem(k);
    if (raw) v = JSON.parse(raw);
  } catch {
    /* ignorieren */
  }
  v ??= memory.get(k);
  if (!v || Date.now() - v.at > SCAN_TTL_MS) return null;
  return { key: v.key, expiresAt: v.at + SCAN_TTL_MS };
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

/** Scan-Signatur fuer eine Pflege-Aktion (Ablauf relativ zur Chain-Zeit, nicht zur Handy-Uhr) */
export async function signScan(args: {
  pc: PublicClient;
  key: Hex;
  chainId: number;
  houses: Address;
  houseId: bigint;
  petId: bigint;
  player: Address;
  nonce: bigint;
}) {
  const block = await args.pc.getBlock();
  const expiry = block.timestamp + 600n;
  const signature = await privateKeyToAccount(args.key).signTypedData({
    domain: { name: "BDL Pet House", version: "1", chainId: args.chainId, verifyingContract: args.houses },
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
    message: { player: args.player, petId: args.petId, houseId: args.houseId, nonce: args.nonce, expiry },
  });
  return { expiry, signature };
}
