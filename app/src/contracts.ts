import type { Abi, Address } from "viem";
import { useChainId } from "wagmi";
import deployments from "./contracts/deployments.json";
import abis from "./contracts/abis.json";

// deployments.json + abis.json werden von contracts/scripts/deploy.ts geschrieben.
type Name = "PetNFT" | "PetRenderer" | "PetAccount" | "Cosmetics" | "Trophy" | "Arena" | "Marketplace";

export type Contracts = Record<Name, { address: Address; abi: Abi }>;

export function useContracts(): Contracts | null {
  const chainId = useChainId();
  const d = (deployments as Record<string, Record<string, string>>)[String(chainId)];
  if (!d) return null;
  const c = (n: Name) => ({ address: d[n] as Address, abi: (abis as Record<string, unknown>)[n] as Abi });
  return {
    PetNFT: c("PetNFT"),
    PetRenderer: c("PetRenderer"),
    PetAccount: c("PetAccount"),
    Cosmetics: c("Cosmetics"),
    Trophy: c("Trophy"),
    Arena: c("Arena"),
    Marketplace: c("Marketplace"),
  };
}

/** ABI fuer eine beliebige TBA-Adresse (alle TBAs teilen die PetAccount-ABI) */
export const accountAbi = (abis as Record<string, unknown>).PetAccount as Abi;

export const STAT_NAMES = ["STR", "AGI", "INT", "VIT"] as const;
export const ACTIONS = [
  { label: "Trainieren", stat: "STR", emoji: "🏋️" },
  { label: "Spielen", stat: "AGI", emoji: "🎾" },
  { label: "Rätseln", stat: "INT", emoji: "🧩" },
  { label: "Füttern", stat: "VIT", emoji: "🍎" },
] as const;

export const ITEM_EMOJI: Record<string, string> = {
  Zylinder: "🎩",
  Sonnenbrille: "🕶️",
  Krone: "👑",
  Schal: "🧣",
  Fluegel: "🪽",
};

export type Pet = {
  stats: readonly number[];
  focus: readonly number[];
  level: number;
  xp: number;
  lastAction: bigint;
  dayStart: bigint;
  actionsToday: number;
  fusionCount: number;
  generation: number;
  equipped: number;
  dna: bigint;
};

export const TIERS = ["Common", "Rare", "Epic", "Legendary"] as const;

export const ZERO = "0x0000000000000000000000000000000000000000";

export const zoneString = (hex: string) => {
  const bytes = hex.slice(2).match(/../g) ?? [];
  return bytes
    .map((b) => parseInt(b, 16))
    .filter((b) => b !== 0)
    .map((b) => String.fromCharCode(b))
    .join("");
};
