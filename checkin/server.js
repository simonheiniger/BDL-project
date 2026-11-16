// Check-in-Service ("Geofence-Orakel")
//
// Prueft, ob ein Spieler in der Turnier-Zone ist, und stellt dann eine EIP-712-Signatur aus,
// die Arena.join() on-chain verifiziert. Der Standort selbst geht NIE auf die Blockchain.
//
//   npm start            -> lokaler Hardhat-Node, Test-Key #5
//   npm run start:bdl    -> Kurs-Testnetz, Key aus contracts/.env
//
// Vertrauensannahme (in Praesentation erklaeren): Wer diesen Key hat, kann Check-ins faelschen,
// und GPS kann vom Client gespooft werden. Next steps: NFC-Tag/rotierender QR am Veranstaltungsort.
import express from "express";
import cors from "cors";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { encodeGeohash } from "../app/api/_geohash.js";

// `npm run start:bdl` laedt contracts/.env -> BDL_RPC_URL / PRIVATE_KEY werden uebernommen
const RPC_URL = process.env.RPC_URL ?? process.env.BDL_RPC_URL ?? "http://127.0.0.1:8545";
// Default = Hardhat-Account #5 (oeffentlich bekannter Test-Key, NUR lokal verwenden!)
const KEY = process.env.CHECKIN_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const PORT = Number(process.env.PORT ?? 8787);
const VALIDITY_S = 600; // Signatur 10 min gueltig
const DEMO_BYPASS = process.env.DEMO_BYPASS === "1"; // Laptop-Demo ohne GPS

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(KEY, provider);
const deployments = JSON.parse(readFileSync(new URL("../app/src/contracts/deployments.json", import.meta.url)));
const abis = JSON.parse(readFileSync(new URL("../app/src/contracts/abis.json", import.meta.url)));

const zoneToString = (b8) => ethers.toUtf8String(b8).replace(/\0+$/, "");

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const { chainId } = await provider.getNetwork();
    res.json({ ok: true, signer: signer.address, chainId: Number(chainId), demoBypass: DEMO_BYPASS });
  });

  app.post("/checkin", async (req, res) => {
    try {
      const { player, petId, tournamentId, lat, lon } = req.body ?? {};
      if (!ethers.isAddress(player) || petId == null || tournamentId == null) {
        return res.status(400).json({ error: "player, petId, tournamentId erforderlich" });
      }
      const { chainId } = await provider.getNetwork();
      const dep = deployments[chainId.toString()];
      if (!dep) return res.status(500).json({ error: `kein Deployment fuer chainId ${chainId}` });
      const arena = new ethers.Contract(dep.Arena, abis.Arena, provider);

      const t = await arena.tournaments(tournamentId);
      if (t.status !== 1n) return res.status(400).json({ error: "Turnier nicht offen" });
      const now = Math.floor(Date.now() / 1000);
      const chainNow = Number((await provider.getBlock("latest")).timestamp);
      if (chainNow > Number(t.end)) return res.status(400).json({ error: "Turnier vorbei" });

      const zone = zoneToString(t.zone);
      let cell = null;
      if (!DEMO_BYPASS) {
        if (typeof lat !== "number" || typeof lon !== "number") {
          return res.status(400).json({ error: "Standort (lat, lon) fehlt" });
        }
        cell = encodeGeohash(lat, lon, zone.length);
        if (cell !== zone) return res.status(403).json({ error: `Nicht in Zone ${zone} (du bist in ${cell})` });
      }

      const expiry = Math.max(now, chainNow) + VALIDITY_S;
      const signature = await signer.signTypedData(
        { name: "BDL Pet Arena", version: "1", chainId, verifyingContract: dep.Arena },
        {
          CheckIn: [
            { name: "player", type: "address" },
            { name: "petId", type: "uint256" },
            { name: "tournamentId", type: "uint256" },
            { name: "expiry", type: "uint256" },
          ],
        },
        { player, petId: BigInt(petId), tournamentId: BigInt(tournamentId), expiry: BigInt(expiry) },
      );
      // Nur Zone/Zelle loggen, nie Koordinaten (Datensparsamkeit)
      console.log(`check-in ok: ${player} pet #${petId} turnier #${tournamentId} zone ${zone}`);
      res.json({ signature, expiry, zone, cell });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.shortMessage ?? e.message });
    }
  });

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createApp().listen(PORT, () => {
    console.log(`Check-in-Service auf :${PORT}, Signer ${signer.address}, RPC ${RPC_URL}${DEMO_BYPASS ? " [DEMO_BYPASS]" : ""}`);
  });
}
