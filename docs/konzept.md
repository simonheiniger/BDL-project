# Konzept: BDL Pets (verfeinert)

Alle Formeln sind in `contracts/contracts/lib/GameMath.sol` implementiert, im Frontend gespiegelt
(`app/src/gamemath.ts`) und in `sim/balance-sim.mjs` simuliert. Tabellen unten = Ausgabe der Simulation.

## 1. Game-Loop

### 1.1 Stats und Pflege

- 4 Stats: **STR, AGI, INT, VIT**. Beim Mint je 5–15 (Pseudo-Zufall aus `blockhash`, `prevrandao`, Minter, ID).
- 4 Aktionen, je **+20 XP**: Trainieren → STR, Spielen → AGI, Rätseln → INT, Füttern → VIT.
- **Level-Up**: alle Stats +1, der *Fokus-Stat* (meistgenutzte Aktion seit dem letzten Level-Up) zusätzlich +2.
  Spieler formen so das Profil ihres Pets – das ist relevant, weil jede Turnier-Challenge andere Stats gewichtet.
- Anti-Bot: Cooldown + Tageslimit on-chain (`cooldown`, `maxActionsPerDay`, beim Deploy fixiert,
  Produktion 4 h / 6 pro Tag, Demo 0 s / 1000).
- **No-Pay-to-Win**: `GameMath` bekommt nie Cosmetics als Input. Das ist im Code überprüfbar, nicht nur ein Versprechen.

### 1.2 XP-Kurve

`xpToNext(L) = 50 · L^1.5`, Levelcap 50. Solidity hat keine Gleitkommazahlen: `50 · L · sqrt(L·10⁶) / 10³`.

| Level | kum. XP | Aktionen | Tage (6/Tag) |
|---|---|---|---|
| 2 | 50 | 3 | 1 |
| 5 | 850 | 43 | 8 |
| 10 | 5 549 | 278 | 47 |
| 20 | 33 557 | 1 678 | 280 |
| 30 | 94 497 | 4 725 | 788 |
| 50 | 344 715 | 17 236 | 2 873 |

Warum Exponent 1.5: Linear (1.0) wäre nach wenigen Wochen „durchgespielt“, quadratisch (2.0) würde Gelegenheitsspieler
ab Level ~10 abhängen. 1.5 gibt schnellen Einstieg (Level 5 = Fusionsreife in gut einer Woche) und macht hohe Level zu einem
echten Zeitinvestment – das ist, was hohe Level handelswert macht. Exponent ist Tuning-Parameter (`EXP=1.3 node sim/balance-sim.mjs`).

### 1.2b Minispiele: Leveln ohne Transaktion pro Aktion

Neben der Pflege im Haus (NFC-Scan, eine Transaktion pro Aktion) gibt es **Minispiele** in der App:
🧠 Memory, ❓ Blockchain-Quiz (Fragen aus dem BDL-Kurs), 🏃 Hürdenlauf, 🪽 Flappy-Pet, 🎵 Simon Says,
🧩 Schiebe-Puzzle (mit dem eigenen Pet-Bild) und ⛏️ Hash-Rätsel (Mini-Proof-of-Work).

```
Browser spielt (off-chain, gratis) ──Ergebnis──► api/game.ts prüft ──► signierter XP-Gutschein (EIP-712)
Gutscheine sammeln ──► PetGames.claim(gutscheine[], signaturen[])  = EINE Transaktion für beliebig viele Runden
```

- **Server prüft, Browser nicht:** Memory-Züge, Sprung-/Flügelschlag-Zeitpunkte, Simon-Eingaben, Puzzle-Züge und Nonces werden mit demselben Code (`app/api/_games.ts`)
  nachgespielt; die Quiz-Lösungen kennt nur der Server, die Antwortreihenfolge wird pro Runde gemischt.
- **Runden-Token** ist mit AES-256-GCM verschlüsselt: zustandslos, fälschungssicher, Seed bleibt geheim.
- **On-chain-Grenzen (`PetGames`):** jeder Gutschein nur einmal (Nonce), max. 40 XP pro Gutschein, **max. 200 Spiel-XP
  pro Pet und Tag** (≈ 10 Pflege-Aktionen) → Spiele ergänzen die Pflege, ersetzen sie nicht. Über dem Limit wird gekappt.
- XP: Memory 40 − 2 × Fehlversuche (min. 10) · Quiz 8 pro richtige Antwort · Rennen 5 + Strecke (max. 40) ·
  Flappy 4 + 3 pro Röhre · Simon 4 pro Runde · Puzzle 40 − 1 pro 5 Züge über 30 (min. 10) · Hash 13 pro Block, 40 für die ganze Kette.
- **Flappy-Physik in Ganzzahlen** (Höhe 0–1000, Schwerkraft 4/Tick): Gleitkomma kann zwischen Browser und Server minimal
  abweichen, dann wäre eine knappe Runde im Browser geschafft und auf dem Server ein Absturz. Eine vollständige Suche über alle
  Flügelschlag-Folgen zeigt: jede erzeugte Röhrenfolge ist schaffbar (Lückenmitte springt pro Röhre höchstens ±220).
- **Puzzle** wird durch zufällige *gültige* Züge ab dem gelösten Bild gemischt → immer lösbar (die Hälfte aller zufälligen
  3×3-Anordnungen wäre unlösbar).
- **Hash-Rätsel = Kursstoff zum Anfassen:** Block = `#i | prev=<Hash Vorgänger> | tx | nonce`, gültig wenn
  `keccak256` mit `0x0` beginnt (Schwierigkeit 1 Hex-Ziffer ≈ 16 Versuche). Ändert man Block 1, werden 2 und 3 ungültig –
  genau die Verkettung, die eine Blockchain manipulationssicher macht.
- Memory, Quiz und die neuen Spiele zahlen auf den INT-Fokus ein, das Rennen auf AGI (fest im Contract:
  `kind == 2 ? AGI : INT`; Flappy wäre eigentlich AGI – dafür müsste PetGames neu deployt werden).

### 1.3 Turnier: gewichteter Zufall

Pro Turnier wird eine **Challenge** ausgelost (erst beim Reveal – sonst würden Spieler gezielt das passende Pet anmelden):

| Challenge | STR | AGI | INT | VIT |
|---|---|---|---|---|
| Sprint | 20 | 50 | 0 | 30 |
| Kraftprobe | 60 | 10 | 0 | 30 |
| Rätsel | 0 | 20 | 70 | 10 |
| Ausdauer | 20 | 20 | 10 | 50 |

```
score = Σ wᵢ · statᵢ                    (Σ w = 100)
P     = score · (1 + L/25) + C          (C = 2000, Floor)
p_j   = P_j / Σ P_k                     (Lotterie, Ziehung: r = rand mod ΣP)
```

Gewinnchance 1-vs-1 gegen ein Level-1-Pet (typische Stats, Challenge Ausdauer):

| Level | Power | P(Sieg) mit Floor | ohne Floor |
|---|---|---|---|
| 5 | 3 920 | 56 % | 65 % |
| 10 | 5 360 | 64 % | 76 % |
| 20 | 9 020 | 75 % | 87 % |
| 50 | 27 200 | 90 % | 96 % |

→ „Hohes Level erhöht die Chance, garantiert keinen Sieg.“ Der Floor `C` hält Neulinge im Spiel (Retention); `C` ist der
wichtigste Tuning-Knopf. Monte Carlo mit 10 000 Turnieren à 8 Teilnehmern bestätigt die Formel (empirisch ≈ analytisch,
Abweichung < 0.5 Prozentpunkte, siehe `sim/out/montecarlo.csv`).

**Zufallsquelle (Commit-Reveal):**

```
rand = keccak256(seed, blockhash(closeBlock), tournamentId)
```

1. Organizer committet `keccak256(seed)` beim Erstellen → kann den Seed später nicht mehr anpassen.
2. `close()` nach Anmeldeschluss fixiert `closeBlock`; dessen Hash war beim Commit unbekannt → Organizer kann das Ergebnis
   beim Commit nicht berechnen. Teilnehmer kennen den Seed nicht → können nichts vorhersagen.
3. `reveal(seed)` innerhalb von 200 Blöcken (`blockhash` ist nur für die letzten 256 Blöcke verfügbar).
4. Restrisiko: Organizer sieht nach `closeBlock` das Ergebnis und könnte den Reveal **zurückhalten**. Folge ist nur ein
   Refund aller Startgelder (`refund()`), kein Gewinn für ihn. Produktiv: Organizer-Kaution oder Chainlink VRF.

Kursbezug: gleiches Prinzip wie **RANDAO** in Ethereum (Topic 12) – Commit-Reveal mit dem Problem des „last revealer“.

### 1.4 Fusion 2 → 1

Bedingungen: gleicher Owner, beide ≥ Level 5. Das zweite Pet wird verbrannt.

```
stat'  = max(a, b) + ⌊min(a, b) · 30 % / (1 + fusionCount)⌋     (Cap 200)
XP'    = XP_total(keep) + 50 % · XP_total(burn)                  → Level + Rest-XP
fusionCount' = max(fc_keep, fc_burn) + 1,  generation' = max + 1
```

**Erste Version war ausnutzbar** – die Simulation hat es gefunden. Ursprünglich `Level' = max + ⌊min/4⌋`:

| Eltern | XP rein | V1 Level | V1 vernichtet | V2 Level | V2 vernichtet |
|---|---|---|---|---|---|
| 5+5 | 1 700 | 6 | 17 % | 5 | 25 % |
| 10+10 | 11 098 | 12 | 19 % | 11 | 25 % |
| 20+5 | 34 407 | 21 | **−11 %** | 20 | 1 % |
| 30+5 | 95 347 | 31 | **−8 %** | 30 | 0 % |

Negativ = es wird Wert *erzeugt*: Ein Lv-20-Pet plus ein billiges Lv-5-„Futter-Pet“ ergab mehr XP-Wert als beide
zusammen. Leveln über Futter-Pets wäre ~5× schneller als Pflegen gewesen. V2 rechnet über XP statt über Level → jede
Fusion vernichtet Wert, Futter-Pets sind nie effizienter als Pflegen.

Kettenfusion (Stat 40 + 40): Bonus +12, +6, +4, +3, +2 … → **Diminishing Returns**, kein Runaway.
`fusionCount = max(beide)` verhindert, dass man den Zähler über ein frisches Pet „wäscht“.

**Ökonomie:** Fusion ist ein Token-Sink (Supply sinkt, 25 % XP-Wert bei gleichwertigen Eltern vernichtet), lohnt sich
aber trotzdem: Pro Spieler und Turnier startet nur ein Pet, und die Stats steigen. In der Supply-Simulation (500 Mints/Woche)
erreicht die Burn-Rate nach einem Jahr ~58 % der Mint-Rate.

### 1.5 Aussehen: Spezies, DNA, Breeding

Jedes Pet ist ein Tier im Chibi-Stil (grosser Kopf, Körper, Pfoten, Schwanz). Beim Mint bekommt es eine **DNA**
(`uint256`); die unteren 128 Bit sind 8 Gene à 16 Bit. Daraus erzeugt `PetRenderer` (mit den Pixel-Daten aus `SpriteBodies`/`SpriteExtras`)
Bild und Traits **komplett on-chain** (SVG, kein IPFS, kein Server).

| Slot | Gen | Varianten (Wahrscheinlichkeit) |
|---|---|---|
| 1 | Spezies (Kopf, Körper, Schnauze) | 15 Arten: Katze, Fuchs, Hase je 9 % · Bär, Pinguin je 8 % · Frosch, Eule je 7 % · Elefant, Schildkröte, Löwe, Wolf je 6 % · **Giraffe, Nashorn, Krokodil je 5 %** · **Drache 4 %** |
| 2 | Ohren | wie Spezies (beim Mint identisch mit Slot 1) |
| 7 | Schwanz | wie Spezies (beim Mint identisch mit Slot 1) |
| 0 | Farbe | 6 gewöhnliche (80 %), Lagune/Lava (12 %), Galaxie (6 %), Gold (2 %) |
| 3 | Augen | Kuller, Schläfrig, Zwinkernd, Funkelnd, Herz (12 %), Sterne (8 %) |
| 4–6 | Mund / Muster / Hintergrund | 4 / 5 / 6 Varianten |

**Breeding (Fusion):** Jedes Gen kommt zufällig von einem Elternteil, mit 1/16 Chance pro Gen auf eine Mutation.
Weil Ohren und Schwanz eigene Gene sind, entstehen **Mischlinge** (z.B. Katze mit Fuchsschwanz, Frosch mit
Drachenhörnern). Gemintete Pets sind immer reinrassig → Mischlinge gibt es **nur durch Fusion**. Das macht die
Fusion nicht nur wegen der Stats interessant, sondern auch für Sammler.

**Seltenheit** = Summe der Trait-Punkte (Gold 6, Galaxie 4, Lagune/Lava 2, Drache 3, Giraffe/Nashorn/Krokodil 2,
Frosch/Elefant/Löwe/Wolf 1, Sterne 2, Herz 1, Herz-Muster 1, je +1 für fremde Ohren / fremden Schwanz)
→ Common (< 2) / Rare (≥ 2) / Epic (≥ 4) / Legendary (≥ 6).
Beim Mint gemessen über 1 000 Pets: **56 % / 29 % / 10 % / 5 %**. Die Seltenheit ist im Bild sichtbar (Rahmen + Badge).

**Erweiterung ohne Migration:** Die zusätzlichen Arten (von 6 auf 15) wurden nachträglich ergänzt, indem nur ein neuer Renderer deployt und
per `PetNFT.setRenderer()` aktiviert wurde (`scripts/upgrade-renderer.ts`). DNA, Stats, Besitz und Inventar bleiben
unverändert; das Aussehen bestehender Pets wird aus derselben DNA neu abgeleitet (Arten können sich dadurch ändern).

**Evolution** nach Level: Ei (Lv 1) → Baby (2–4) → Erwachsen (5–14) → Legendär (15+, Aura).

**Cosmetics im Bild:** `equip(petId, itemId)` speichert das getragene Item on-chain. `tokenURI` prüft bei jedem Aufruf,
ob das Item noch in der Pet-Wallet liegt – wird es verkauft oder verschoben, verschwindet es aus dem Bild.

**Stil: Pixel-Art (Retro, 32×32), eine einzige Darstellung.** Der Contract erzeugt das Bild selbst; die App zeigt genau
dieses NFT-Bild an (kein separater 3D-/Browser-Renderer mehr). Marktplatz-Bild = App-Bild.

| Ebene (Zeichenreihenfolge) | Quelle |
|---|---|
| Hintergrund (Himmel, Boden, Deko) | Hintergrund-Gen |
| Flügel-Cosmetic | `SpriteExtras.cosmetic(5)` |
| Ohren | `SpriteBodies.ears(Ohren-Gen)` – hinter dem Kopf |
| Schwanz | `SpriteBodies.tail(Schwanz-Gen)` |
| Körper inkl. Kopf und Art-Merkmalen (Rüssel, Horn, Mähne, Panzer …) | `SpriteBodies.body(Spezies-Gen)` |
| Muster, Mund, Wangen, Augen | Muster-/Mund-/Augen-Gen, als Pixel gestempelt |
| Cosmetic (Hut, Brille, Krone, Schal) | `SpriteExtras.cosmetic(id)` |
| Eierschale (nur Stufe Ei) | `SpriteExtras.shell()` |

- **Feste Anker:** Kopf, Augen und Mund liegen bei allen 15 Arten an denselben Pixeln → Ohren/Schwanz einer anderen Art
  (Mischling) und Cosmetics passen immer pixelgenau.
- **Sprites werden generiert:** `contracts/art/build-sprites.mjs` zeichnet alle Sprites (Formen, Konturen, Schattierung,
  Art-Merkmale) und schreibt sie als 4-Bit-Pixeldaten in die Contracts (≈ 14 KB). Farben kommen erst beim Rendern aus
  dem Farb-Gen → jede Art in 10 Farbvarianten.
- **Animation im SVG:** Pixel-Wippen, Blinzeln, wackelndes Ei, blinkende Aura bei legendären Pets.
- **Gas:** `tokenURI` ist ein reiner Lesezugriff (kostet nichts), muss aber unter dem Gas-Limit des Nodes bleiben (30 M).
  Worst Case gemessen ≈ 11 M; ein Test prüft < 15 M.

Galerie: on-chain SVG `docs/gallery/index.html` und in der App unter `/galerie` (direkt vom Contract gerendert).

## 2. Smart-Contract-Architektur

```
                         createAccount (CREATE2)
 PetNFT (ERC-721) ───────────────────────────────► ERC6551Registry
   │  Stats, XP, fuse()                                  │ deployt ERC-1167 Proxy
   │                                                     ▼
   │                                       PetAccount (TBA, 1 pro Pet)
   │                                       hält: Cosmetics (1155), Trophies, ETH
   ├─ fuse(): sweepTo(keepTBA) ───────────►│ (nur PetNFT darf)
   └─ fuse(): Trophy.migrate(burnTBA, keepTBA)
 Cosmetics (ERC-1155 + Shop)   Trophy (Soulbound, ERC-5192)   Arena   Marketplace
```

| Contract | Verantwortung |
|---|---|
| `ERC6551Registry` | EIP-6551-Registry (lesbare Solidity-Variante). Account-Adresse = CREATE2(salt, Proxy-Bytecode + Footer). Eigene Instanz, weil das Kurs-Netz keine kanonische Registry hat. |
| `PetAccount` | Account-Implementation. Liest seine NFT-Bindung aus dem Proxy-Footer (`extcodecopy`). `owner()` = Owner des NFTs. `execute()` nur Owner, erhöht `state`. `approve`/`setApprovalForAll` gesperrt. `sweepTo()` nur für PetNFT. |
| `PetNFT` | Mint (legt TBA an, würfelt DNA), Pflege-Loop, Fusion inkl. Gen-Mischung, `equip()`. `tokenURI` delegiert an den Renderer. Verhindert Transfer eines Pets in die eigene Wallet. |
| `PetRenderer` / `SpriteBodies` / `SpriteExtras` / `PetDecor` | Pixel-Art-SVG + Metadaten aus DNA, Level, Generation und getragenem Cosmetic. Aufgeteilt wegen 24-KB-Limit (EIP-170). |
| `Cosmetics` | ERC-1155 mit Shop (`buy(id, amount, to)` → direkt ins TBA), Max-Supply pro Item. |
| `Trophy` | Soulbound: `_update` revertiert ausser beim Mint (nur Arena) und bei Fusion-Migration (nur PetNFT). |
| `Arena` | Turniere: Check-in-Signatur prüfen, Stats-Snapshot beim Join, Commit-Reveal, Trophy-Mint, Preisgeld-Split. |
| `Marketplace` | Festpreis-Handel, 2.5 % Fee, Pull-Payments, Schutz gegen „Drain-before-sale“. |

**Inventar-Migration bei Fusion (Reihenfolge entscheidend):**

1. Checks (Owner beider Pets, Level ≥ 5)
2. `PetAccount(burnTBA).sweepTo(keepTBA)` – alle Cosmetic-IDs (1..32) + ETH
3. `Trophy.migrate(burnTBA, keepTBA)` – alle Soulbound-Trophäen
4. Stats/XP berechnen
5. `_burn(burnId)`

Würde zuerst verbrannt, hätte das TBA keinen Owner mehr (`ownerOf` revertiert) → Inventar für immer gesperrt.

**Drain-before-sale:** Bei ERC-6551 könnte ein Verkäufer das Inventar leeren, nachdem der Käufer es angeschaut hat
(Front-Running). Lösung: `Listing` speichert `PetAccount.state()`; der Käufer übergibt den State, den er im UI gesehen hat;
jeder Abfluss erhöht `state` → Kauf revertiert. Damit das lückenlos ist, sind Approvals aus dem TBA gesperrt (sonst könnte
ein Operator Assets abziehen, ohne dass `state` steigt).

**Gas (lokal gemessen):** `reveal` mit 32 Teilnehmern ≈ 633 000 Gas.

## 3. Geofencing-Turniere – wirtschaftlich skalierbar

```
 Handy ──GPS──► Check-in-Service ──EIP-712 Signatur──► Handy ──join(sig)──► Arena (verifiziert ecrecover)
                (prüft Geohash-Zelle,                                         speichert nur zoneId + Zeitfenster
                 speichert keine Koordinaten)
```

- **Standort nie on-chain.** Das Ledger ist öffentlich und permanent (Topic 6); Koordinaten wären ein Bewegungsprofil.
  On-chain steht nur die Zone als Geohash-Präfix (6 Zeichen ≈ 1.2 × 0.6 km, z.B. `u0qnnw` = ZHAW Winterthur).
- **Check-in = Signatur** (Topic 2): Service signiert `CheckIn(player, petId, tournamentId, expiry)` nach EIP-712. Die
  Signatur ist an Spieler, Pet und Turnier gebunden und läuft nach 10 min ab → nicht weiterreichbar, nicht wiederverwendbar.
- **Vertrauensannahme:** Der Service ist ein Orakel. GPS kann gespooft werden. Härtung (next steps): rotierender QR-Code
  oder NFC-Tag (NTAG 424 DNA mit SUN-CMAC) am Veranstaltungsort, mehrere unabhängige Signer (m-of-n).
- **Skalierung on-chain:** Ein `Arena`-Contract, Turniere sind Structs (kein Contract-Deploy pro Turnier). Bis 32 Teilnehmer
  läuft die Auslosung on-chain (O(N), ~633k Gas). Für grosse Turniere: Teilnehmer off-chain sammeln, nur den **Merkle-Root**
  posten, Gewinner claimt mit Merkle-Proof (Topic 4) → On-chain-Kosten O(log N) pro Claim, unabhängig von der Teilnehmerzahl.
- **Wirtschaft:** Startgeld-Pool 70 % Sieger-Pet (ins TBA – der Preis bleibt beim Pet), 20 % Host, 10 % Treasury.
  Hosts sind lokale Venues (Cafés, Game-Shops, Events): Sie legen Turniere selbst an und verdienen am Pool, dafür bringen
  Turniere Laufkundschaft. Damit skaliert das Angebot an Turnieren ohne zentrale Organisation. Auf einer L2 (Base, Polygon)
  kostet ein Join wenige Cent.
- **Stufen:** Venue (Geohash 7, ~150 m) → Stadt (Geohash 5, ~5 km) → Saison-Finale (Trophäe als Zulassung).

## 4. Physische Komponente: Häuser

- Pets leben in **Häusern** (`PetHouse`, ERC-721, 5 Stufen). Mint nur in einen freien Platz → die Pet-Zahl ist durch die real gedruckten Häuser begrenzt.
- Zufriedenheit sinkt linear pro Tag (Hütte −40 … Villa −6), außerhalb eines Hauses ist sie eingefroren. Pflege +25; unter 50 gibt es nur 50–100 % XP. Kein Pay-to-Win: ein besseres Haus gibt nie mehr als 100 %.
- **Scan-Pflicht:** Chip-Schlüssel signiert EIP-712 `Scan(player, petId, houseId, nonce, expiry)`; `PetNFT.interact` verlangt diese Signatur. Der Schlüssel liegt nur im URL-Fragment des Chips, die App hält ihn 15 min im sessionStorage.
- Ehrlich: Eine kopierte Chip-URL funktioniert ebenfalls (NTAG213 ist kopierbar). Schutz: nur der Haus-Besitzer kann pflegen, `setTag` rotiert den Schlüssel. Next step: NTAG 424 DNA (SUN/CMAC).
- Modelle: `hardware/` (OpenSCAD, 4 Farbslots, runde Ausnehmung 27 mm für den NFC-Sticker unten).

### Alt: Physische Komponente (MVP)

- NFC-Sticker im 3D-gedruckten Haus (`hardware/pet-house.scad`, parametrisch) enthält nur die URL `…/pet/<id>?nfc`.
  iOS und Android öffnen sie nativ, die App zeigt das Pet „aufgeweckt“ an.
- Ehrlich: Ein NTAG213 ist kopierbar – das Haus ist im MVP ein Erlebnis-, kein Sicherheitsfeature. Echte Bindung via
  NTAG 424 DNA (pro Scan neuer CMAC, Server prüft) = next step.

## 5. Bewusst nicht im MVP (next steps)

| Thema | Warum nicht jetzt | Weg |
|---|---|---|
| Account Abstraction (Web2-Login, gasless) | Kurs-Netz hat keinen ERC-4337 EntryPoint/Bundler | EntryPoint + Paymaster deployen oder L2 mit AA-Infrastruktur (Base) |
| Chainlink VRF | auf Kurs-Netz nicht verfügbar | ersetzt Commit-Reveal |
| Cosmetics anziehen on-chain | Mehr Gas, kein Mehrwert für die Kernidee | Slot-Mapping im PetNFT |
| Handel mit Cosmetics | ERC-1155 bereits frei transferierbar | Marketplace für 1155 erweitern |
| Merkle-Turniere | nur für > 32 Teilnehmer nötig | siehe §3 |
