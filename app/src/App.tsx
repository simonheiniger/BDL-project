import { NavLink, Route, Routes } from "react-router-dom";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain, useBalance } from "wagmi";
import { formatEther } from "viem";
import { useContracts } from "./contracts";
import { config, local, demoWallet } from "./wagmi";
import Home from "./pages/Home";
import PetPage from "./pages/PetPage";
import Fusion from "./pages/Fusion";
import Market from "./pages/Market";
import Arena from "./pages/Arena";
import Galerie from "./pages/Galerie";
import HousePage from "./pages/House";
import NfcSetup from "./pages/NfcSetup";
import Admin from "./pages/Admin";
import PhonePage, { PhoneSigner } from "./pages/Phone";
import { getPhonePair } from "./relay";
import { hasWallet, isMobile, metamaskLink } from "./nfc";
import Companion from "./companion/Companion";
import { isNative } from "./native";
import { AppGate } from "./components/AppGate";

function Wallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: bal } = useBalance({ address });
  if (!isConnected) {
    // Handy-Browser (Chrome/Safari) hat kein window.ethereum -> Seite im MetaMask-App-Browser oeffnen (inkl. #k=)
    if (isMobile() && !hasWallet() && !getPhonePair()) {
      return (
        <a className="btn" href={metamaskLink()}>
          In MetaMask öffnen
        </a>
      );
    }
    if (isMobile() && !hasWallet()) {
      return (
        <NavLink className="btn" to="/phone">
          📱 Handy-Modus
        </NavLink>
      );
    }
    return (
      <div className="row">
        <button className="btn" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>
          MetaMask verbinden
        </button>
        {import.meta.env.VITE_DEFAULT_CHAIN !== "24888" && <button
          className="btn small"
          disabled={isPending}
          title="Unlocked Hardhat-Account (nur lokaler Node)"
          onClick={() => {
            demoWallet.set(true);
            connect({ connector: connectors[1], chainId: local.id });
          }}
        >
          Demo-Wallet
        </button>}
      </div>
    );
  }
  return (
    <button
      className="wallet"
      onClick={() => {
        demoWallet.set(false);
        disconnect();
      }}
      title="Trennen"
    >
      {address!.slice(0, 6)}…{address!.slice(-4)}
      {bal && <span className="muted"> · {Number(formatEther(bal.value)).toFixed(3)} ETH</span>}
    </button>
  );
}

function ChainGuard() {
  const chainId = useChainId();
  const contracts = useContracts();
  const { chainId: walletChain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const appChain = config.chains.find((c) => c.id === chainId);
  if (isConnected && walletChain !== chainId) {
    return (
      <div className="card warn">
        ⚠️ Deine Wallet ist auf einem anderen Netzwerk (Chain {walletChain}) als die App ({appChain?.name ?? chainId}).
        Transaktionen würden dort landen.{" "}
        <button className="btn small" onClick={() => switchChain({ chainId })}>
          Zu {appChain?.name ?? chainId} wechseln
        </button>
      </div>
    );
  }
  if (contracts) return null;
  return (
    <div className="card warn">
      Auf Chain {chainId} ist nichts deployt. Netzwerk wechseln:{" "}
      {config.chains.map((c) => (
        <button key={c.id} className="btn small" onClick={() => switchChain({ chainId: c.id })}>
          {c.name}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  if (isNative) return <Companion />;
  return (
    <AppGate>
    <div className="app">
      <header>
        <NavLink to="/" className="logo">
          🥚 BDL Pets
        </NavLink>
        <Wallet />
      </header>
      <nav>
        <NavLink to="/" end>
          Pets
        </NavLink>
        <NavLink to="/fusion">Fusion</NavLink>
        <NavLink to="/market">Markt</NavLink>
        <NavLink to="/arena">Arena</NavLink>
        <NavLink to="/galerie">Galerie</NavLink>
      </nav>
      <PhoneSigner />
      <main>
        <ChainGuard />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pet/:id" element={<PetPage />} />
          <Route path="/house/:id" element={<HousePage />} />
          <Route path="/nfc" element={<NfcSetup />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/phone" element={<PhonePage />} />
          <Route path="/fusion" element={<Fusion />} />
          <Route path="/market" element={<Market />} />
          <Route path="/arena" element={<Arena />} />
          <Route path="/galerie" element={<Galerie />} />
        </Routes>
      </main>
    </div>
    </AppGate>
  );
}
