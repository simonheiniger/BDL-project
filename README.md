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
cd contracts && npx hardhat run scripts/prerender-gallery.ts   # App-Galerie vorrendern -> app/public/gallery/ (nach Sprite-Aenderungen)
```

## NFC

NTAG213/215-Sticker mit URL `https://<app-host>/pet/<id>?nfc` beschreiben (z.B. App „NFC Tools“).
iOS und Android öffnen die URL nativ – keine Web-NFC-API nötig. Sticker in die Vertiefung unter dem Haus
(`hardware/pet-house.scad`, `openscad -o house.stl hardware/pet-house.scad`).

## NFC-Chip initialisieren (Handy)

1. App-Seite `/nfc` in **Chrome auf Android** öffnen (HTTPS, NFC an). Haus-Nummer eingeben, „Chip programmieren“, NTAG213/215/216 an die Handy-Rückseite halten. Die App erzeugt den Schlüssel, schreibt `…/house/<id>#k=<key>` und liest zur Kontrolle zurück.
2. Danach „In MetaMask öffnen“ tippen (Link `/house/<id>?settag=<Chip-Adresse>`) und auf der Hausseite „Chip übernehmen“ bestätigen (`PetHouse.setTag`).
3. Wallet am Handy: App im MetaMask-App-Browser öffnen. Chip-Scans öffnen die URL im Standardbrowser; dort erscheint „In MetaMask öffnen“ (Schlüssel bleibt im Link).
4. Ohne Web NFC (iOS): URLs aus `contracts/seeds/houses-<chain>.csv` mit „NFC Tools“ als URL-Record schreiben.

## Handy als NFC-Scanner, Logik am PC

Wallet und Transaktionen bleiben am PC, das Handy scannt nur den Chip und signiert.

1. PC: Hausseite (`/house/<id>`) → „Handy koppeln“ → QR-Code mit der Handy-Kamera scannen (öffnet `/phone`).
2. Handy: Seite offen lassen, NFC-Chip scannen. Der Chip-Schlüssel bleibt auf dem Handy (localStorage, 15 min).
3. PC: Pflege-Button → Anfrage geht über `/api/relay` ans Handy, das Handy signiert (EIP-712 `Scan`), der PC sendet `interact(...)` mit seiner Wallet.

Der Relay sieht nur Anfrage und Signatur (an Spieler/Nonce gebunden, ≤ 1 h gültig). Die Pairing-ID (128 bit) steht nur im QR-Code.
`api/relay.ts` braucht auf Vercel einen Redis-Store: Upstash-Integration (`UPSTASH_REDIS_REST_URL`/`_TOKEN`) oder Vercel KV (`KV_REST_API_URL`/`_TOKEN`). Ohne Env läuft ein In-Memory-Store (nur `npm run dev`; auf Serverless unzuverlässig).

## Handy-App (Companion, Android)

Die App ist nur zum Pflegen/Füttern. Verkaufen, Fusion, Arena, Häuser verwalten bleiben am PC.

**Anmeldung (einmal pro Monat):**
1. PC: Startseite oder Hausseite → „Handy koppeln“ → QR-Code. Handy-Kamera scannt ihn, die App öffnet sich und zeigt einen 4-stelligen Code.
2. PC: zeigt denselben Code → Codes vergleichen → „Handy freigeben“ (eine MetaMask-Bestätigung, schickt etwas Test-ETH als Gas mit).
3. Das ruft `PetNFT.authorizeCaretaker(handyAdresse, +30 Tage)` auf. Der Handy-Schlüssel (in der App erzeugt, nicht die Haupt-Wallet) darf **nur** `interact` aufrufen. Er läuft nach 30 Tagen ab, ist widerrufbar („Freigabe widerrufen“) und gilt nur für den berechtigenden Besitzer (nach einem Verkauf wertlos).

**Pflegen:** NFC-Chip des Hauses ans Handy halten (öffnet die App über den Link `https://<app>/house/<id>#k=…`), dann in der App füttern/trainieren. Das Handy signiert den Scan mit dem Chip-Schlüssel und sendet die Transaktion selbst. Der PC listet alle Tiere und zeigt, welche in einem Haus wohnen (nur diese sind pflegbar).

**APK bauen** (Android SDK + JDK 17, Capacitor 6):
```
cd app
APP_URL=https://<deine-vercel-domain> npm run native:build   # Web-App bauen, Android-Projekt synchronisieren, App-Link eintragen
npm run native:apk                                            # android/app/build/outputs/apk/debug/app-debug.apk
```
`APP_URL` ist die Domain der PC-App (Relay `/api/relay` und Lese-Proxy `/api/rpc`); dieselbe Domain steht auch in den Chip-URLs (`APP_URL` beim Haus-Minten). Pflege-Transaktionen gehen direkt an die Kurs-RPC (`VITE_BDL_RPC_URL`, http – in der App erlaubt).
Damit ein Chip-Scan die App ohne Auswahldialog öffnet, muss `https://<domain>/.well-known/assetlinks.json` den SHA-256-Fingerabdruck des APK-Zertifikats enthalten (Digital Asset Links, Paket `ch.zhaw.bdl.pets`); ohne das fragt Android einmalig „Öffnen mit“.

**Contracts neu deployen** (neue Funktionen `authorizeCaretaker`/`revokeCaretaker` in `PetNFT`): `npx hardhat run scripts/deploy.ts --network bdl`. Integrationstest des Handy-Wegs gegen einen lokalen Node: `npx hardhat node`, deploy mit `--network localhost`, dann `cd app && npx tsx scripts/e2e-caretaker.ts`.

## Entwickler-Tool: Häuser definieren (`/admin`)

Nur der Owner des `PetHouse`-Contracts (Deployer-Wallet) kann Häuser prägen (`mintHouse` ist `onlyOwner`, das erzwingt der Contract). Spieler können weder Häuser erzeugen noch ihre Stufe ändern.

1. PC: `https://<domain>/admin` mit der Entwickler-Wallet öffnen. Stufe, Anzahl und Besitzer wählen → „Häuser prägen“ (eine MetaMask-Bestätigung pro Haus). Die Chip-Schlüssel entstehen im Browser und liegen nur in diesem Browser.
2. Pro Haus erscheint ein QR-Code. Handy (Chrome, NFC an): QR scannen → „Chip beschreiben“ → Sticker auflegen. Die App liest den Chip zur Kontrolle zurück.
3. Am PC „✔ Chip beschrieben“ drücken (löscht den Schlüssel vom PC). „CSV exportieren“ sichert die URLs vorher (geheim, nicht committen).

Ein-/Auslagern der Tiere und Pflege laufen in der Handy-App (Caretaker darf `interact`, `moveIn`, `moveOut`). **`PetHouse` hat sich geändert → Contracts neu deployen.**

**Weitere Admins:** Der Owner trägt sie in `/admin` unter „Admins“ ein (oder `ADMIN=0x… npx hardhat run scripts/set-minter.ts --network bdl`). Admins dürfen Häuser prägen, aber keine weiteren Admins ernennen. Contract-Funktionen: `setMinter`, `isMinter`.
