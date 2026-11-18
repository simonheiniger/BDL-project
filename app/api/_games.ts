// Spiellogik fuer die Minispiele – identisch im Browser (Spielen) und auf dem Server (Pruefen).
// Der Server vertraut nie einer vom Browser gemeldeten Punktzahl: Er spielt die Eingaben (Kartenzuege,
// Antworten, Sprung-Zeitpunkte) mit demselben Code nach und berechnet die XP selbst.
// Bewusst ohne Node-/Browser-Abhaengigkeiten (nur viem fuer keccak256, laeuft in beiden).

import { keccak256, toBytes } from "viem";

// Reihenfolge = `kind` im Gutschein (PetGames). Nur hinten anfuegen, sonst aendern alte Gutscheine ihre Bedeutung.
export const GAME_KINDS = ["memory", "quiz", "race", "flappy", "simon", "puzzle", "hash"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export const MAX_XP = 40; // = PetGames.MAX_XP_PER_VOUCHER

/** Deterministischer Zufall aus einem Seed-String (mulberry32 ueber FNV-Hash) */
export function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ Memory

export const MEMORY_SYMBOLS = ["🐱", "🦊", "🐰", "🐻", "🐸", "🐲", "🦒", "🐘"];

/** 16 Karten = 8 Paare, gemischt aus dem Seed */
export function memoryLayout(seed: string): number[] {
  const r = rng(seed);
  const deck = [...Array(8).keys(), ...Array(8).keys()];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Zuege nachspielen. Gueltig nur, wenn alle Paare gefunden wurden. XP sinken mit jedem Fehlversuch. */
export function memoryResult(seed: string, moves: [number, number][]) {
  const layout = memoryLayout(seed);
  const matched = new Set<number>();
  for (const [a, b] of moves) {
    if (a === b || a < 0 || b < 0 || a > 15 || b > 15 || matched.has(a) || matched.has(b)) return { ok: false, xp: 0, moves: moves.length };
    if (layout[a] === layout[b]) matched.add(a).add(b);
  }
  const ok = matched.size === 16;
  const misses = moves.length - 8;
  return { ok, moves: moves.length, xp: ok ? Math.max(10, MAX_XP - 2 * misses) : 0 };
}

// ------------------------------------------------------------------ Quiz (Stoff aus dem BDL-Kurs)

export type Question = { q: string; options: string[]; answer: number };

export const QUIZ: Question[] = [
  { q: "Was garantiert eine kryptografische Hashfunktion NICHT?", options: ["Kollisionsresistenz", "Einwegeigenschaft", "Verschluesselung der Daten", "Feste Ausgabelaenge"], answer: 2 },
  { q: "Womit wird eine digitale Signatur geprueft?", options: ["Mit dem Private Key", "Mit dem Public Key", "Mit dem Seed", "Mit dem Blockhash"], answer: 1 },
  { q: "Wozu dient ein Merkle Tree in einem Block?", options: ["Transaktionen effizient beweisen", "Mining beschleunigen", "Wallets verschluesseln", "Gas berechnen"], answer: 0 },
  { q: "Wie gross ist ein Merkle-Beweis bei n Transaktionen?", options: ["O(1)", "O(log n)", "O(n)", "O(n²)"], answer: 1 },
  { q: "Was bestimmt bei Bitcoin die gueltige Chain?", options: ["Die laengste/schwerste Chain", "Die neueste Chain", "Der Dozent", "Die Chain mit den meisten Wallets"], answer: 0 },
  { q: "Was ist die Nonce beim Proof-of-Work?", options: ["Eine Wallet-Adresse", "Ein Wert, den Miner variieren", "Die Blockgroesse", "Ein Smart Contract"], answer: 1 },
  { q: "Welches Modell nutzt Ethereum fuer Kontostaende?", options: ["UTXO", "Account-Modell", "DAG", "Merkle-Liste"], answer: 1 },
  { q: "Welches Modell nutzt Bitcoin?", options: ["Account-Modell", "UTXO", "eUTXO", "Patricia Trie"], answer: 1 },
  { q: "Welche Datenstruktur speichert den Ethereum-State?", options: ["Merkle Patricia Trie", "Binaerbaum", "Hashtabelle ohne Beweise", "Linked List"], answer: 0 },
  { q: "Wofuer steht ERC-721?", options: ["Fungible Token", "Non-Fungible Token", "Soulbound Token", "Stablecoin"], answer: 1 },
  { q: "Was macht ERC-6551 (Token Bound Account)?", options: ["Gibt jedem NFT eine eigene Wallet", "Verbrennt NFTs", "Macht NFTs fungibel", "Ersetzt MetaMask"], answer: 0 },
  { q: "Warum sind Trophaeen in BDL Pets soulbound?", options: ["Damit Historie nicht kaeuflich ist", "Damit sie billiger sind", "Weil ERC-721 es verlangt", "Damit sie verschwinden"], answer: 0 },
  { q: "Was verhindert Commit-Reveal im Turnier?", options: ["Dass der Organizer den Zufall nachtraeglich waehlt", "Dass Gas anfaellt", "Dass Pets fusionieren", "Dass jemand teilnimmt"], answer: 0 },
  { q: "Was ist Gas in Ethereum?", options: ["Ein Token", "Mass fuer Rechenaufwand", "Ein Konsensverfahren", "Ein Wallet-Typ"], answer: 1 },
  { q: "Was ist bei Proof-of-Stake die Grundlage der Blockauswahl?", options: ["Rechenleistung", "Hinterlegter Einsatz (Stake)", "Alter des Accounts", "Anzahl Transaktionen"], answer: 1 },
  { q: "Ab welchem Anteil ehrlicher Validatoren ist Casper FFG sicher?", options: ["> 1/2", "> 2/3", "> 1/3", "100 %"], answer: 1 },
  { q: "Was ist RANDAO in Ethereum?", options: ["Zufallsquelle aus Validator-Beitraegen", "Eine DAO", "Ein Token-Standard", "Ein Mining-Pool"], answer: 0 },
  { q: "Was bedeutet 'Not your keys, not your coins'?", options: ["Wer die Keys hat, kontrolliert die Coins", "Coins brauchen keine Keys", "Boersen sind immer sicher", "Keys sind oeffentlich"], answer: 0 },
  { q: "Warum geht der Standort im Turnier NICHT on-chain?", options: ["Ledger ist oeffentlich und permanent", "Zu wenig Speicher", "GPS ist verboten", "Solidity kennt keine Zahlen"], answer: 0 },
  { q: "Was prueft EIP-712?", options: ["Strukturierte, lesbare Signaturen", "Blockgroesse", "Token-Preise", "Netzwerk-Latenz"], answer: 0 },
  { q: "Was ist ein Cardano Slot Leader?", options: ["Darf im Slot einen Block erstellen", "Ein Wallet", "Ein Smart Contract", "Ein Miner bei Bitcoin"], answer: 0 },
  { q: "Warum lohnt es sich bei Cardano nicht, einen Pool aufzuteilen?", options: ["Gewinnwahrscheinlichkeit bleibt gleich", "Es ist verboten", "Es kostet Gas", "Pools sind immer gleich gross"], answer: 0 },
  { q: "Was passiert beim Burn eines NFT?", options: ["Es wird dauerhaft vernichtet", "Es wird kopiert", "Es wird verkauft", "Es wird gesperrt und spaeter zurueckgegeben"], answer: 0 },
  { q: "Wo liegt bei BDL Pets das Bild des Pets?", options: ["On-chain, aus der DNA erzeugt", "Auf IPFS", "Auf einem ZHAW-Server", "In MetaMask"], answer: 0 },
];

export const QUIZ_LEN = 5;

/** 5 Fragen aus dem Seed (ohne Wiederholung), Antwortreihenfolge pro Frage neu gemischt */
export function quizRound(seed: string): { id: number; order: number[] }[] {
  const r = rng(seed);
  const shuffle = (xs: number[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  return shuffle([...QUIZ.keys()])
    .slice(0, QUIZ_LEN)
    .map((id) => ({ id, order: shuffle([...QUIZ[id].options.keys()]) }));
}

export function quizResult(seed: string, answers: number[]) {
  const round = quizRound(seed);
  const correct = round.filter(({ id, order }, i) => order[answers[i]] === QUIZ[id].answer).length;
  return { ok: answers.length === QUIZ_LEN, correct, xp: answers.length === QUIZ_LEN ? correct * 8 : 0 };
}

// ------------------------------------------------------------------ Rennen (Huerdenlauf, deterministisch)

export const RACE = { tickMs: 50, maxTicks: 600, jumpTicks: 9, firstObstacle: 30 };

/** Huerden-Zeitpunkte (in Ticks). Abstaende werden enger, bleiben aber immer schaffbar (> Sprungdauer). */
export function raceObstacles(seed: string): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let t = RACE.firstObstacle;
  while (t < RACE.maxTicks) {
    out.push(t);
    const tighten = Math.floor((t / RACE.maxTicks) * 10);
    t += RACE.jumpTicks + 4 + Math.floor(r() * (22 - tighten));
  }
  return out;
}

/** Simulation: Sprung dauert jumpTicks; nur vom Boden aus moeglich. Kollision = Huerde trifft Pet am Boden. */
export function raceSimulate(seed: string, jumps: number[]) {
  const obstacles = new Set(raceObstacles(seed));
  const valid: number[] = [];
  let airUntil = -1;
  for (const j of [...jumps].sort((a, b) => a - b)) {
    if (j > airUntil && j >= 0 && j < RACE.maxTicks) {
      valid.push(j);
      airUntil = j + RACE.jumpTicks;
    }
  }
  const airborne = (t: number) => valid.some((j) => t > j && t <= j + RACE.jumpTicks);
  for (let t = 0; t < RACE.maxTicks; t++) {
    if (obstacles.has(t) && !airborne(t)) return { ticks: t, crashed: true };
  }
  return { ticks: RACE.maxTicks, crashed: false };
}

export function raceResult(seed: string, jumps: number[]) {
  const s = raceSimulate(seed, jumps);
  return { ok: true, ticks: s.ticks, crashed: s.crashed, xp: Math.min(MAX_XP, 5 + Math.floor(s.ticks / 17)) };
}

// ------------------------------------------------------------------ Flappy-Pet (ganzzahlige Physik -> Browser und Server rechnen bitgleich)

export const FLAPPY = {
  tickMs: 40,
  maxTicks: 750, // 30 s
  height: 1000, // Spielfeldhoehe in Einheiten (0 = oben)
  gravity: 4,
  flap: -38, // Geschwindigkeit nach einem Fluegelschlag
  maxFall: 40,
  gapHalf: 200, // halbe Lueckenhoehe
  r: 45, // Trefferradius des Pets
  pipeHalf: 3, // Ticks, die eine Roehre das Pet ueberdeckt (vor/nach)
  firstPipe: 60,
};

export type FlappyPipe = { t: number; g: number }; // t = Tick, an dem die Roehre beim Pet ist; g = Lueckenmitte

/** Roehren aus dem Seed. Sprung der Lueckenmitte begrenzt -> immer schaffbar (siehe Bot-Test). */
export function flappyPipes(seed: string): FlappyPipe[] {
  const r = rng(seed);
  const out: FlappyPipe[] = [];
  let g = 500;
  for (let t = FLAPPY.firstPipe; t < FLAPPY.maxTicks; t += 38 + Math.floor(r() * 14)) {
    g = Math.max(260, Math.min(740, g + Math.floor((r() - 0.5) * 440)));
    out.push({ t, g });
  }
  return out;
}

export type FlappyState = { y: number; vy: number };
export const flappyStart = (): FlappyState => ({ y: 500, vy: 0 });

/** Ein Tick. Gibt true zurueck, wenn das Pet in diesem Tick aufprallt. */
export function flappyStep(s: FlappyState, flap: boolean, t: number, pipes: FlappyPipe[]): boolean {
  s.vy = flap ? FLAPPY.flap : Math.min(s.vy + FLAPPY.gravity, FLAPPY.maxFall);
  s.y += s.vy;
  if (s.y < FLAPPY.r || s.y > FLAPPY.height - FLAPPY.r) return true;
  for (const p of pipes) {
    if (Math.abs(t - p.t) <= FLAPPY.pipeHalf && Math.abs(s.y - p.g) > FLAPPY.gapHalf - FLAPPY.r) return true;
  }
  return false;
}

export function flappySimulate(seed: string, flaps: number[]) {
  const pipes = flappyPipes(seed);
  const set = new Set(flaps.filter((f) => Number.isInteger(f) && f >= 0 && f < FLAPPY.maxTicks));
  const s = flappyStart();
  let t = 0;
  for (; t < FLAPPY.maxTicks; t++) if (flappyStep(s, set.has(t), t, pipes)) break;
  const passed = pipes.filter((p) => p.t + FLAPPY.pipeHalf < t).length;
  return { ticks: t, crashed: t < FLAPPY.maxTicks, passed };
}

export function flappyResult(seed: string, flaps: number[]) {
  if (!Array.isArray(flaps) || flaps.length > FLAPPY.maxTicks) return { ok: false, ticks: 0, passed: 0, xp: 0 };
  const s = flappySimulate(seed, flaps);
  return { ok: s.passed > 0, ticks: s.ticks, passed: s.passed, xp: Math.min(MAX_XP, 4 + s.passed * 3) };
}

// ------------------------------------------------------------------ Simon Says

export const SIMON = { colors: 4, maxLen: 12, stepMs: 550 };

export function simonSequence(seed: string): number[] {
  const r = rng(seed);
  return Array.from({ length: SIMON.maxLen }, () => Math.floor(r() * SIMON.colors));
}

/** `attempts[k]` = Eingabe in Runde k+1 (Laenge k+1). Gezaehlt werden lueckenlos richtige Runden. */
export function simonResult(seed: string, attempts: number[][]) {
  const seq = simonSequence(seed);
  let rounds = 0;
  if (Array.isArray(attempts)) {
    for (const a of attempts.slice(0, SIMON.maxLen)) {
      if (!Array.isArray(a) || a.length !== rounds + 1 || a.some((x, i) => x !== seq[i])) break;
      rounds++;
    }
  }
  return { ok: rounds > 0, rounds, xp: Math.min(MAX_XP, rounds * 4) };
}

/** Zeit, die allein das Vorspielen der geschafften Runden dauert (Plausibilitaet) */
export const simonMinMs = (rounds: number) => ((rounds * (rounds + 1)) / 2) * SIMON.stepMs * 0.8;

// ------------------------------------------------------------------ Schiebe-Puzzle 3x3 (8 = Luecke)

const PUZZLE_N = 3;
const BLANK = PUZZLE_N * PUZZLE_N - 1;
export const PUZZLE = { n: PUZZLE_N, maxMoves: 500, minMs: 15000 };

const neighbours = (i: number) =>
  [i - PUZZLE_N, i + PUZZLE_N, i % PUZZLE_N ? i - 1 : -1, (i + 1) % PUZZLE_N ? i + 1 : -1].filter((j) => j >= 0 && j <= BLANK);

const solved = (b: number[]) => b.every((v, i) => v === i);

/** Mischen durch zufaellige GUELTIGE Zuege ab dem geloesten Bild -> garantiert loesbar */
export function puzzleBoard(seed: string): number[] {
  const r = rng(seed);
  const b = [...Array(BLANK + 1).keys()];
  let blank = BLANK;
  let prev = -1;
  for (let k = 0; k < 80 || solved(b); k++) {
    const opts = neighbours(blank).filter((j) => j !== prev);
    const j = opts[Math.floor(r() * opts.length)];
    [b[blank], b[j]] = [b[j], b[blank]];
    prev = blank;
    blank = j;
  }
  return b;
}

/** Einen Zug ausfuehren: `pos` = Feld des Teils, das in die Luecke rutscht. false = ungueltig. */
export function puzzleMove(b: number[], pos: number): boolean {
  const blank = b.indexOf(BLANK);
  if (!neighbours(blank).includes(pos)) return false;
  [b[blank], b[pos]] = [b[pos], b[blank]];
  return true;
}

export function puzzleResult(seed: string, moves: number[]) {
  const b = puzzleBoard(seed);
  if (!Array.isArray(moves) || moves.length > PUZZLE.maxMoves) return { ok: false, moves: 0, xp: 0 };
  for (const m of moves) if (!puzzleMove(b, m)) return { ok: false, moves: moves.length, xp: 0 };
  const ok = solved(b);
  // Optimum liegt bei <= 31 Zuegen; pro 5 Zuege darueber 1 XP weniger, mindestens 10
  return { ok, moves: moves.length, xp: ok ? Math.max(10, Math.min(MAX_XP, MAX_XP - Math.floor((moves.length - 30) / 5))) : 0 };
}

// ------------------------------------------------------------------ Hash-Raetsel: Mini-Proof-of-Work

export const HASH = { blocks: 3, prefix: "0x0", minMs: 12000, maxNonce: 1_000_000 };
const PEOPLE = ["Alice", "Bob", "Carol", "Dave", "Eve", "Noel", "Simon", "Mallory"];

/** Pro Block eine Transaktion aus dem Seed */
export function hashTxs(seed: string): string[] {
  const r = rng(seed);
  return Array.from({ length: HASH.blocks }, () => {
    const a = PEOPLE[Math.floor(r() * PEOPLE.length)];
    let b = PEOPLE[Math.floor(r() * PEOPLE.length)];
    if (b === a) b = PEOPLE[(PEOPLE.indexOf(a) + 1) % PEOPLE.length];
    return `${a} -> ${b}: ${1 + Math.floor(r() * 9)} ETH`;
  });
}

/** Block-Inhalt: Nummer, Hash des Vorgaengers (Verkettung!), Transaktion, Nonce */
export const hashBlockText = (i: number, prev: string, tx: string, nonce: number) => `#${i + 1}|prev=${prev}|tx=${tx}|nonce=${nonce}`;
export const blockHash = (text: string) => keccak256(toBytes(text));
export const GENESIS = "0x" + "0".repeat(64);

/** Gueltig = Hash beginnt mit 0x0 (Schwierigkeit 1 Hex-Ziffer -> im Schnitt 16 Versuche pro Block) */
export function hashResult(seed: string, nonces: number[]) {
  const txs = hashTxs(seed);
  let prev = GENESIS;
  let blocks = 0;
  if (Array.isArray(nonces)) {
    for (let i = 0; i < HASH.blocks; i++) {
      const n = nonces[i];
      if (!Number.isInteger(n) || n < 0 || n > HASH.maxNonce) break;
      const h = blockHash(hashBlockText(i, prev, txs[i], n));
      if (!h.startsWith(HASH.prefix)) break;
      prev = h;
      blocks++;
    }
  }
  return { ok: blocks > 0, blocks, xp: blocks === HASH.blocks ? MAX_XP : blocks * 13 };
}
