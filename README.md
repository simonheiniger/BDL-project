# BLD Pets – Phygitales Web3-Tamagotchi

Bonus-Projekt im Modul *Blockchains & Distributed Ledger Technologie* (ZHAW, HS 2026).

Jedes Pet ist ein ERC-721-NFT mit **eigener Wallet (ERC-6551 Token Bound Account)**. Cosmetics, Siegerurkunden
(Soulbound) und Preisgeld gehören dem Pet und wechseln beim Verkauf automatisch mit. Pets werden gepflegt
(XP-Kurve), können 2→1 fusioniert werden (Burn + Inventar-Migration) und treten in regionalen Turnieren an
(Geofence-Check-in per EIP-712-Signatur, Commit-Reveal-Zufall). Ein physisches, 3D-gedrucktes Haus mit NFC-Tag
öffnet das Pet auf dem Handy.

| Ordner | Inhalt |
|---|---|
| `contracts/` | Solidity (Hardhat 2, OZ 5.0.2): Registry, PetAccount, PetNFT, GameMath, Cosmetics, Trophy, Arena, Marketplace + Tests + Scripts |
| `app/` | PWA (Vite, React, wagmi/viem) |
| `checkin/` | Check-in-Service: prüft Standort (Geohash), signiert EIP-712 |
| `sim/` | Balance-Simulation (XP-Kurve, Gewinnchancen, Fusion, Supply) |
| `hardware/` | Parametrisches NFC-Haus (OpenSCAD) |
| `docs/` | [Konzept](docs/konzept.md), [Designentscheidungen / Q&A](docs/entscheidungen.md) |

## Lokal starten (Demo)

Voraussetzung: Node ≥ 20.19.

```bash
# 1) Abhängigkeiten
(cd contracts && npm i) && (cd checkin && npm i) && (cd app && npm i)

# 2) Lokale Chain (0.0.0.0 -> auch vom Handy im WLAN erreichbar)
cd contracts && npx hardhat node --hostname 0.0.0.0          # Terminal 1

# 3) Deploy + Demo-Daten + Turnier
npx hardhat run scripts/deploy.ts --network localhost         # schreibt app/src/contracts/*.json
npx hardhat run scripts/seed-demo.ts --network localhost      # 3 Pets, zwei auf Lv 5, Cosmetics
MINUTES=60 npx hardhat run scripts/create-tournament.ts --network localhost

# 4) Check-in-Service + App
cd ../checkin && npm start                                    # Terminal 2 (DEMO_BYPASS=1 ignoriert Standort)
cd ../app && npm run dev                                      # Terminal 3 -> http://localhost:5173

# 5) Turnier auslosen (lokal: Zeit vorspulen)
cd ../contracts && TID=1 FORCE_END=1 npx hardhat run scripts/settle.ts --network localhost
```

In der App: **Demo-Wallet** (unlocked Hardhat-Account, nur lokal; `?demo=1` / `?demo=2` = weitere Accounts)
oder **MetaMask** (Hardhat-Netz `http://127.0.0.1:8545`, chainId 31337).

## Kurs-Testnetz (chainId 24888)

```bash
cp contracts/.env.example contracts/.env      # BDL_RPC_URL + PRIVATE_KEY eines TEST-Accounts eintragen
cd contracts
CHECKIN_ADDRESS=<Adresse des Check-in-Keys> COOLDOWN=0 MAX_PER_DAY=1000 \
  npx hardhat run scripts/deploy.ts --network bdl
npx hardhat run scripts/seed-demo.ts --network bdl
# Check-in-Service gegen Testnetz:
RPC_URL=$BDL_RPC_URL CHECKIN_PRIVATE_KEY=0x... node ../checkin/server.js
# App: VITE_DEFAULT_CHAIN=24888 VITE_BDL_RPC_URL=... npm run dev
```

Produktionswerte statt Demo: `COOLDOWN=14400 MAX_PER_DAY=6`.

## Tests

```bash
cd contracts && npx hardhat test          # 27 Tests inkl. E2E-Szenario + 32-Teilnehmer-Gas-Test
cd checkin && npm test                    # Geohash
node sim/balance-sim.mjs                  # Balance-Tabellen + CSVs in sim/out/
```

## NFC

NTAG213/215-Sticker mit URL `https://<app-host>/pet/<id>?nfc` beschreiben (z.B. App „NFC Tools“).
iOS und Android öffnen die URL nativ – keine Web-NFC-API nötig. Sticker in die Vertiefung unter dem Haus
(`hardware/pet-house.scad`, `openscad -o house.stl hardware/pet-house.scad`).
