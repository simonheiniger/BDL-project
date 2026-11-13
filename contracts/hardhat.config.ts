import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const { BDL_RPC_URL, PRIVATE_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // "paris" = kein PUSH0 -> laeuft sicher auch auf aelteren Hardhat-Nodes (Kurs-Testnetz)
      evmVersion: "paris",
      viaIR: true,
    },
  },
  networks: {
    hardhat: { chainId: 31337, accounts: { count: 40 } },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    bdl: {
      url: BDL_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 24888,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  gasReporter: { enabled: process.env.REPORT_GAS === "1" },
};

export default config;
