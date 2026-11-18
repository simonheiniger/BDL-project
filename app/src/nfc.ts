import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

/**
 * NFC-Chip initialisieren (Web NFC).
 * Der Chip bekommt EINE URL-Nachricht: <origin>/house/<id>#k=<privater Chip-Schluessel>.
 * Der Schluessel wird im Browser erzeugt; on-chain landet nur die Adresse (PetHouse.setTag / mintHouse).
 * Web NFC gibt es nur in Chrome auf Android (HTTPS) – nicht im MetaMask-Browser, nicht in iOS-Safari.
 */

// Web NFC ist (noch) nicht in lib.dom.d.ts
type NDEFReaderLike = {
  write(msg: { records: { recordType: string; data: string }[] }, opts?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  makeReadOnly?: (opts?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((e: { message: { records: { recordType: string; data?: DataView }[] } }) => void) | null;
  onreadingerror: (() => void) | null;
};
type NDEFReaderCtor = new () => NDEFReaderLike;

const reader = (): NDEFReaderCtor | undefined => (window as unknown as { NDEFReader?: NDEFReaderCtor }).NDEFReader;

export const nfcSupported = () => !!reader() && window.isSecureContext;

export type Chip = { key: Hex; address: Address };

export function newChip(): Chip {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address };
}

export const chipUrl = (houseId: bigint | number | string, key: Hex, origin = location.origin) =>
  `${origin}/house/${houseId}#k=${key.slice(2)}`;

/** URL auf den Chip schreiben (Chip an die Handy-Rueckseite halten). Ueberschreibt vorhandene Daten. */
export async function writeChip(url: string, opts: { lock?: boolean; signal?: AbortSignal } = {}) {
  const R = reader();
  if (!R) throw new Error("Web NFC wird nicht unterstützt (Chrome auf Android verwenden).");
  const ndef = new R();
  await ndef.write({ records: [{ recordType: "url", data: url }] }, { overwrite: true, signal: opts.signal });
  if (opts.lock) {
    if (!ndef.makeReadOnly) throw new Error("Dieser Browser kann Chips nicht sperren.");
    await ndef.makeReadOnly({ signal: opts.signal });
  }
}

/** Chip lesen und die enthaltene URL zurueckgeben (zum Pruefen nach dem Schreiben) */
export function readChip(signal?: AbortSignal): Promise<string> {
  const R = reader();
  if (!R) return Promise.reject(new Error("Web NFC wird nicht unterstützt."));
  const ndef = new R();
  return new Promise((resolve, reject) => {
    ndef.onreading = (e) => {
      const rec = e.message.records.find((r) => (r.recordType === "url" || r.recordType === "text") && r.data);
      if (!rec?.data) return reject(new Error("Chip enthält keine URL."));
      const bytes = new Uint8Array(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength);
      resolve(new TextDecoder().decode(bytes));
    };
    ndef.onreadingerror = () => reject(new Error("Chip nicht lesbar."));
    ndef.scan({ signal }).catch(reject);
  });
}

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const hasWallet = () => !!(window as unknown as { ethereum?: unknown }).ethereum;

/** Oeffnet die aktuelle Seite (inkl. #k=) im MetaMask-In-App-Browser */
export const metamaskLink = (url = location.href) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`;
