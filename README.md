# BDL Pets – Phygitales Web3-Tamagotchi

Bonus-Projekt im Modul *Blockchains & Distributed Ledger Technologie* (ZHAW, HS 2026).

Jedes Pet ist ein ERC-721-NFT mit **eigener Wallet (ERC-6551 Token Bound Account)**. Cosmetics, Siegerurkunden
(Soulbound) und Preisgeld gehören dem Pet und wechseln beim Verkauf automatisch mit. Pets werden gepflegt
(XP-Kurve), können 2→1 fusioniert werden (Burn + Inventar-Migration) und treten in regionalen Turnieren an
(Geofence-Check-in per EIP-712-Signatur, Commit-Reveal-Zufall). Ein physisches, 3D-gedrucktes Haus mit NFC-Tag
öffnet das Pet auf dem Handy.

| Ordner | Inhalt |
|---|---|
| `contracts/` | Solidity (Hardhat 2, OZ 5.0.2): Registry, PetAccount, PetNFT, PetRenderer + Sprite-Daten (Pixel-Art on-chain), GameMath, Cosmetics, Trophy, Arena, Marketplace + Tests + Scripts. Sprites: `node art/build-sprites.mjs` |
| `app/` | PWA (Vite, React, wagmi/viem). Zeigt die on-chain Pixel-Art direkt an, Galerie unter `/galerie` |
| `checkin/` | Check-in-Service: prüft Standort (Geohash), signiert EIP-712 |
| `sim/` | Balance-Simulation (XP-Kurve, Gewinnchancen, Fusion, Supply) |
| `hardware/` | 5 Haus-Stufen (Hütte bis Villa) als OpenSCAD, 4 Farben, Platz für NFC-Sticker; `render.sh` exportiert STLs |
| `docs/` | [Konzept](docs/konzept.md), [Designentscheidungen / Q&A](docs/entscheidungen.md) |

## Häuser & NFC (Pets müssen "ausgelagert" werden)

Pets entstehen nur in einem freien Platz eines **Hauses** (`PetHouse`, ERC-721 = physisches 3D-Haus mit NFC-Chip).
Stufe bestimmt Plätze und Zufriedenheit: Hütte 1 Platz / −40 pro Tag · Bauernhaus 2 / −30 · Cottage 3 / −20 ·
Herrenhaus 4 / −12 · Villa 5 / −6. Zufriedenheit < 50 → Pflege gibt nur 50–100 % XP (bessere Häuser geben nie mehr als
100 %, sie sparen nur Pflegeaufwand). **Pflegen geht nur nach NFC-Scan**: Der Chip enthält `/house/<id>#k=<Schlüssel>`;
die App signiert damit (EIP-712) jede Pflege, der Contract prüft gegen die Chip-Adresse (Nonce, Ablauf, Spieler gebunden).
Verkaufte Pets verlassen ihr Haus; ein Haus ist nur übertragbar, wenn es leer ist (`setTag` programmiert den Chip neu).

```bash
cd contracts
TIERS=0,2,4 npx hardhat run scripts/mint-houses.ts --network bdl   # Häuser prägen, URLs -> seeds/houses-<chain>.csv (gitignored)
cd ../hardware && ./render.sh                                      # STLs nach hardware/out/
```

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

RPC: `http://185.48.228.49:8545`. Aktuelles Deployment: Adressen in `app/src/contracts/deployments.json` (Key `24888`).

```bash
# contracts/.env: BDL_RPC_URL + PRIVATE_KEY eines TEST-Accounts (gitignored)
cd contracts
CHECKIN_ADDRESS=<Adresse zum PRIVATE_KEY> COOLDOWN=0 MAX_PER_DAY=1000 \
  npx hardhat run scripts/deploy.ts --network bdl
npx hardhat run scripts/seed-demo.ts --network bdl
MINUTES=10 npx hardhat run scripts/create-tournament.ts --network bdl
TID=<id> npx hardhat run scripts/settle.ts --network bdl     # nach Turnierende

cd ../checkin && npm run start:bdl     # Check-in-Service gegen Testnetz (Key aus contracts/.env)
cd ../app && npm run dev:bdl           # App auf Testnetz, Login nur via MetaMask (Netz "BDL-Test")
```

Produktionswerte statt Demo: `COOLDOWN=14400 MAX_PER_DAY=6`.

## Öffentlich auf Vercel

Die App (`app/`) läuft als statische Seite + zwei Vercel-Functions:

| Function | Zweck |
|---|---|
| `api/rpc.ts` | https→http-Proxy zur Kurs-RPC (Browser blockieren Mixed Content). Nur Lese-Methoden – Transaktionen gehen über MetaMask direkt an die RPC. |
| `api/checkin.ts` | Geofence-Check-in (wie `checkin/server.js`), signiert mit eigenem Check-in-Key. |

Einrichtung:
1. Vercel → *Add New Project* → GitHub-Repo `BDL-project` importieren, **Root Directory `app`** (Framework Vite wird erkannt).
2. Environment Variable **`CHECKIN_PRIVATE_KEY`** setzen (Wert aus `contracts/.env`, nur Check-in-Key, nie den Deploy-Key). Optional `BDL_RPC_URL`.
3. Deploy. Danach baut jeder Push auf `main` automatisch neu.

Konfiguration für Produktion: `app/.env.production` (Testnetz fest, Lesen über `/api/rpc`), SPA-Routing: `app/vercel.json`.
Check-in-Signer wechseln: `CHECKIN_ADDRESS=0x… npx hardhat run scripts/set-checkin-signer.ts --network bdl`.

## Tests

```bash
cd contracts && npx hardhat test          # 31 Tests inkl. E2E-Szenario + 32-Teilnehmer-Gas-Test
cd checkin && npm test                    # Geohash
node sim/balance-sim.mjs                  # Balance-Tabellen + CSVs in sim/out/
cd contracts && npx hardhat run scripts/gallery.ts   # Pet-Galerie -> docs/gallery/index.html
```

## NFC

NTAG213/215-Sticker mit URL `https://<app-host>/pet/<id>?nfc` beschreiben (z.B. App „NFC Tools“).
iOS und Android öffnen die URL nativ – keine Web-NFC-API nötig. Sticker in die Vertiefung unter dem Haus
(`hardware/pet-house.scad`, `openscad -o house.stl hardware/pet-house.scad`).
