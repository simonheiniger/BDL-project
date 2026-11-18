import type { Abi, Address } from "viem";
import { useChainId } from "wagmi";
import deployments from "./contracts/deployments.json";
import abis from "./contracts/abis.json";

// deployments.json + abis.json werden von contracts/scripts/deploy.ts geschrieben.
type Name = "PetNFT" | "PetRenderer" | "PetAccount" | "Cosmetics" | "Trophy" | "Arena" | "Marketplace" | "PetHouse";

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
    PetHouse: c("PetHouse"),
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

/** Haus-Stufen (muss zu PetHouse.sol passen: Plaetze = Index + 1, Zufriedenheitsverlust pro Tag) */
export const HOUSE_TIERS = [
  { name: "Hütte", emoji: "🛖", capacity: 1, decay: 40 },
  { name: "Bauernhaus", emoji: "🏠", capacity: 2, decay: 30 },
  { name: "Cottage", emoji: "🏡", capacity: 3, decay: 20 },
  { name: "Herrenhaus", emoji: "🏰", capacity: 4, decay: 12 },
  { name: "Villa", emoji: "🏛️", capacity: 5, decay: 6 },
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
