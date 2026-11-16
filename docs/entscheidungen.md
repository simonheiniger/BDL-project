# Designentscheidungen – Vorbereitung auf Fragen

Format: Entscheidung → Begründung → verworfene Alternative. Beide Teammitglieder sollten jede Zeile erklären können.

## Warum überhaupt Blockchain?

- **Echtes Eigentum + offener Handel:** Pets und Items gehören dem Spieler, nicht dem Betreiber. Handel ohne Plattform-Erlaubnis.
- **Nachweisbare Historie:** Trophäen sind öffentlich prüfbar und nicht fälschbar (Soulbound) – das ist der Prestigewert.
- **Überprüfbare Regeln:** No-Pay-to-Win, Fusionsformel und Gewinnwahrscheinlichkeiten stehen im Contract, nicht in einer Blackbox.
- **Ehrliche Grenze:** Pflege-Aktionen on-chain kosten Gas. Bei einem kommerziellen Spiel würde man sie batchen oder off-chain
  sammeln und nur Level-Ups committen.

## Standards

| Frage | Antwort |
|---|---|
| Warum ERC-6551 statt Inventar-Mapping im NFT-Contract? | Inventar besteht aus *beliebigen* Tokens (auch fremden ERC-20/721/1155). Mit TBA hält das Pet sie wirklich, jeder Wallet-/Marktplatz-Standard funktioniert. Mapping würde nur unsere eigenen Items kennen. |
| Warum eigene Registry? | Kanonische Registry liegt auf Mainnets/öffentlichen Testnetzen an fixer Adresse; auf dem Kurs-Hardhat-Netz (chainId 24888) existiert sie nicht. Logik identisch zur EIP. |
| Warum Proxies (ERC-1167)? | Ein TBA kostet so ~173 Byte Code (45 Byte Proxy + 128 Byte Bindung) statt eines vollen Contracts. Alle TBAs teilen eine Implementation. |
| Warum Stats im PetNFT und nicht im TBA? | Spiellogik braucht eine autoritative Quelle, die nur der Spiel-Contract ändern darf. Da Stats an der tokenId hängen, wechseln sie beim Verkauf trotzdem mit. |
| Warum ERC-1155 für Cosmetics? | Viele identische Exemplare pro Item → fungibel pro ID, Batch-Transfer bei der Migration in einem Call. |
| Warum Soulbound für Trophäen? | Sonst könnte man Trophäen kaufen und auf beliebige Pets legen → Historie wertlos. |
| Warum PetNFT nicht ERC721Enumerable? | Enumerable verteuert jeden Transfer. Frontend findet eigene Pets über Transfer-Events. Trophy ist dagegen Enumerable, weil `migrate` alle Trophäen eines TBA aufzählen muss. |

## Aussehen (NFT-Kunst)

| Frage | Antwort |
|---|---|
| Warum Bild on-chain statt IPFS? | Kein externer Dienst, der ausfallen kann; das Bild hängt live am Zustand (Level, Cosmetic). Bei IPFS müsste man bei jedem Level-Up neue Metadaten hochladen und einem Server vertrauen. |
| Warum drei Render-Contracts? | Ein Contract darf max. 24 KB Code haben (EIP-170). Renderer ~18 KB, Anatomy ~6 KB, Decor ~7 KB. |
| Warum 3D nicht on-chain? | Ein 3D-Generator in Solidity wäre zu gross und zu teuer. On-chain liegt die **DNA** (die Wahrheit); der Browser rendert sie deterministisch. Das SVG bleibt als on-chain Bild für Marktplätze. Next step: Generator-Bundle auf IPFS und per `animation_url` in den Metadaten verlinken → Marktplätze zeigen das 3D-Modell. |
| Warum prozedural statt fertiger 3D-Modelle? | Fertige Modelle können keine Mischlinge, Evolution oder Gen-Vererbung zeigen. Prozedural entsteht jedes Tier aus der DNA. |
| Warum Snapshots auf den Karten? | Browser erlauben nur ~16 WebGL-Kontexte gleichzeitig. Ein geteilter Renderer erzeugt Standbilder, nur die Detailseite läuft live. |
| Warum eigene Gene für Ohren und Schwanz? | Damit Breeding sichtbar wird: Mischlinge entstehen nur durch Fusion → zusätzlicher Anreiz zu fusionieren, ohne Pay-to-Win. |
| Wie kamen 8 neue Arten dazu, ohne Pets neu zu minten? | Neuer Renderer + `setRenderer()`. Die DNA bleibt; nur die Interpretation der Gene ändert sich. Gleichzeitig der Nachteil: Bestehende Pets können dadurch eine andere Art bekommen → in Produktion Art-Zuordnung einfrieren oder versionieren. |
| Warum ist der Renderer austauschbar? | Kunst soll sich weiterentwickeln können. Trade-off: Owner kann das Aussehen ändern – aber nie Stats, Level oder Besitz. Strengere Variante: `setRenderer` nach Launch sperren. |
| Ist die DNA manipulierbar? | Sie stammt aus `blockhash`/`prevrandao` beim Mint – ein Validator könnte theoretisch auf seltene DNA zielen. Akzeptiert, weil Aussehen keinen Einfluss auf Turniere hat. |
| Warum prüft `tokenURI` den Item-Bestand live? | Sonst könnte man ein Item anziehen, verkaufen und es wäre trotzdem im Bild sichtbar. |
| Warum gewichtete Traits statt Gleichverteilung? | Seltenheit erzeugt Sammelwert; die Verteilung ist im Code nachprüfbar (Transparenz). |

## Sicherheit

| Frage | Antwort |
|---|---|
| Warum `sweepTo` statt „PetNFT darf `execute()`“? | Least Privilege: PetNFT kann nur „alles an ein anderes TBA“ verschieben, nicht beliebige Calls aus fremden Wallets machen. |
| Warum Approvals im TBA gesperrt? | Ein Operator könnte sonst Assets abziehen, ohne dass `state` steigt → Marktplatz-Schutz aushebelbar. |
| Was passiert, wenn man ein Pet in seine eigene TBA schickt? | Gesperrt (`SelfOwnership`). Sonst besitzt die Wallet sich selbst, niemand kann je wieder signieren. Tiefere Zyklen (A in TBA von B, B in TBA von A) sind nicht abgefangen – bekanntes ERC-6551-Problem. |
| Reentrancy? | `fuse`, `reveal`, `buy`, `withdraw` mit `nonReentrant`; Zahlungen als Pull-Payment (ausser Preisgeld ins TBA, unser eigener Contract). |
| Warum Stats-Snapshot beim Join? | Sonst könnte man nach der Anmeldung noch leveln/fusionieren. Verbrannte Pets zählen beim Reveal mit Power 0. |
| Warum Preisgeld ins TBA statt an den Spieler? | Gewinn gehört zum Pet und steigert dessen Handelswert. Owner kann jederzeit via `execute` auszahlen. |
| Warum `evmVersion: paris`? | Kein PUSH0-Opcode → läuft sicher auch auf älteren Hardhat-Nodes wie dem Kurs-Testnetz. |

## Zufall

| Frage | Antwort |
|---|---|
| Warum nicht `block.prevrandao` oder `blockhash` allein? | Block-Proposer kann beeinflussen (Block weglassen/Reihenfolge). Beim Mint akzeptiert (Start-Stats sind wertarm), im Turnier nicht. |
| Warum Commit-Reveal + Blockhash? | Seed-Commit bindet den Organizer; der Blockhash nach Anmeldeschluss war beim Commit unbekannt. Keine Partei allein kennt das Ergebnis vorab. |
| Schwachstelle? | Organizer kann Reveal verweigern (Last-Revealer-Problem, wie bei RANDAO). Folge: Refund, kein Vorteil für ihn. Produktion: Kaution oder Chainlink VRF. |
| Warum Challenge erst beim Reveal? | Sonst meldet jeder das Pet mit dem passenden Stat-Profil an → Meta-Gaming. |

## Balancing

| Frage | Antwort |
|---|---|
| Warum Floor `C = 2000`? | Ohne Floor gewinnt Lv 20 gegen Lv 1 zu 87 %, mit Floor 75 %. Neulinge brauchen eine realistische Chance, sonst verlassen sie das Spiel. |
| Warum Fusion über XP statt Level? | Simulation zeigte Exploit der ersten Version (−11 % Vernichtung = Wertschöpfung bei Lv20+Lv5). Siehe `docs/konzept.md` §1.4. |
| Warum Diminishing Returns bei Stats? | Kettenfusion würde sonst unbegrenzt starke Pets erzeugen; Turniere würden deterministisch. |

## Öffentlicher Betrieb (Vercel)

| Frage | Antwort |
|---|---|
| Warum ein RPC-Proxy? | Vercel liefert über https, die Kurs-RPC spricht nur http → der Browser blockiert direkte Lesezugriffe (Mixed Content). Die Function leitet serverseitig weiter. |
| Ist der Proxy ein Risiko fürs Kurs-Netz? | Er lässt nur Lese-Methoden durch (Whitelist, max. 50 Calls pro Batch, 64 KB). Transaktionen laufen über MetaMask direkt zur RPC, nicht über uns. |
| Warum ein eigener Check-in-Key? | Der Key liegt auf einem Server (Vercel-Env). Wird er geleakt, kann man nur Check-ins fälschen – mit dem Deploy-Key könnte man den Renderer tauschen oder Einnahmen abziehen. Least Privilege. |
| Warum kein Ersatz-Standort mehr? | Lokal (http) gibt es kein GPS, darum der ZHAW-Fallback. Öffentlich wäre der Fallback ein Freifahrtschein durch den Geofence – dort ist der echte Standort Pflicht. |

## Geofencing

| Frage | Antwort |
|---|---|
| Warum Standort nicht on-chain? | Öffentliches, unveränderliches Ledger = permanentes Bewegungsprofil. Datensparsamkeit. |
| Warum ein zentraler Signer? | Pragmatisch für das MVP. Smart Contracts können GPS nicht selbst prüfen – es braucht immer ein Orakel. Verbesserung: m-of-n Signer, Venue-Tags. |
| Warum Geohash? | Präfix = Zelle, Vergleich ist ein String-Vergleich; Zellgrösse über Präfixlänge wählbar. |

## Was würden wir als Nächstes tun?

1. Account Abstraction (ERC-4337) für Social Login + gasless Pflege.
2. Chainlink VRF statt Commit-Reveal.
3. Merkle-basierte Grossturniere.
4. NTAG 424 DNA für fälschungssichere Häuser.
5. Deploy auf L2 (Base) statt Kurs-Testnetz.
