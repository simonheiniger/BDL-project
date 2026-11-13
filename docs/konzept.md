# Konzept: BLD Pets (verfeinert)

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

### 1.5 Aussehen: DNA, Seltenheit, Evolution

Jedes Pet bekommt beim Mint eine **DNA** (`uint256`). Die unteren 112 Bit sind 7 Gene à 16 Bit; daraus erzeugt
`PetRenderer` Bild und Traits **komplett on-chain** (SVG, kein IPFS, kein Server).

| Gen | Varianten (Wahrscheinlichkeit) |
|---|---|
| Farbe | 6 gewöhnliche (80 %), Lagune/Lava (12 %), Galaxie (6 %), Gold (2 %) |
| Form | Mochi, Tropfen, Bohne, Birne (je 25 %) |
| Kopf | Keiner, Katzenohren, Hasenohren, Antennen, Spross, Hörner (10 %), Heiligenschein (5 %) |
| Augen | Kuller, Schläfrig, Zwinkernd, Funkelnd, Herz (12 %), Sterne (8 %) |
| Mund / Muster / Hintergrund | 4 / 5 / 6 Varianten |

**Seltenheit** = Summe der Trait-Punkte (Gold 6, Galaxie 4, Lagune/Lava 2, Sterne 2, Herz 1, Heiligenschein 3,
Hörner 1, Herz-Muster 1) → Common (< 2) / Rare (≥ 2) / Epic (≥ 4) / Legendary (≥ 6).
Gemessen über 1 000 Pets (`N=1000 npx hardhat run scripts/gallery.ts`): **67 % / 20 % / 10 % / 4 %**.
Die Seltenheit ist im Bild selbst sichtbar (farbiger Rahmen + Badge), also auf jedem NFT-Marktplatz.

**Evolution** nach Level: Ei (Lv 1) → Baby (2–4) → Erwachsen (5–14, Kopf-Trait erscheint) → Legendär (15+, Aura).
Pflege verändert damit sichtbar das NFT – das Bild ist ein Abbild des on-chain Zustands.

**Fusion vererbt Gene:** Jedes Gen kommt zufällig von einem Elternteil, mit 1/16 Chance pro Gen auf eine Mutation
(neu gewürfelt) → Fusion kann einen selteneren Look erzeugen. Fusionierte Pets tragen ein Juwel auf der Stirn.

**Cosmetics im Bild:** `equip(petId, itemId)` speichert das getragene Item on-chain. `tokenURI` prüft bei jedem Aufruf,
ob das Item noch in der Pet-Wallet liegt – wird es verkauft oder verschoben, verschwindet es aus dem Bild.

Galerie aller Varianten: `docs/gallery/index.html`.

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
| `PetRenderer` / `PetDecor` | Erzeugen SVG + Metadaten aus DNA, Level, Generation und getragenem Cosmetic. Zwei Contracts wegen 24-KB-Limit (EIP-170). |
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

## 4. Physische Komponente

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
