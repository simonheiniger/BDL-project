import { http, createConfig } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { defineChain } from "viem";
import { API_BASE } from "./native";

// Lokaler Hardhat-Node. Hostname der Seite statt 127.0.0.1 -> funktioniert auch vom Handy im selben WLAN
// (Node dann mit `npx hardhat node --hostname 0.0.0.0` starten).
const localRpc = import.meta.env.VITE_LOCAL_RPC_URL ?? `http://${location.hostname}:8545`;

export const local = defineChain({
  id: 31337,
  name: "Hardhat lokal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [localRpc] } },
});

/** Kurs-Testnetz (Hardhat-Node der ZHAW, chainId 24888) */
export const bdl = defineChain({
  id: 24888,
  name: "BDL Testnet",
  nativeCurrency: { name: "Test-Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_BDL_RPC_URL ?? "http://127.0.0.1:8545"] } },
  testnet: true,
});

// Relativer Proxy-Pfad (/api/rpc) braucht in der Handy-App die absolute Basis-URL
const readRpcRaw = import.meta.env.VITE_BDL_READ_RPC as string | undefined;
const readRpc = readRpcRaw ? (readRpcRaw.startsWith("/") ? `${API_BASE}${readRpcRaw}` : readRpcRaw) : undefined;

const defaultChain = import.meta.env.VITE_DEFAULT_CHAIN === "24888" ? bdl : local;

// Demo-Wallet: die ersten Hardhat-Accounts sind auf dem lokalen Node "unlocked" -> der Node signiert selbst.
// Nur fuer lokale Demos (z.B. Handy ohne MetaMask). Auf dem Kurs-Testnetz immer MetaMask verwenden.
const demoAccounts = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
] as const;
const demoIndex = Number(new URLSearchParams(location.search).get("demo") ?? 0) % demoAccounts.length;

// mock-Connector kennt nach Reload seinen Zustand nicht -> Wahl merken (z.B. NFC-Scan oeffnet Seite neu)
const DEMO_KEY = "demo-wallet";
const storage = {
  get: () => {
    try {
      return localStorage.getItem(DEMO_KEY) === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(DEMO_KEY, "1");
      else localStorage.removeItem(DEMO_KEY);
    } catch {
      /* privater Modus */
    }
  },
};
export const demoWallet = storage;

export const config = createConfig({
  chains: defaultChain.id === bdl.id ? [bdl, local] : [local, bdl],
  connectors: [
    injected(),
    mock({ accounts: [demoAccounts[demoIndex]], features: { reconnect: true, defaultConnected: storage.get() } }),
  ],
  // Lesen ueber VITE_BDL_READ_RPC (auf Vercel: https-Proxy /api/rpc), sonst direkt ueber die Chain-RPC
  transports: { [local.id]: http(), [bdl.id]: http(readRpc) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
