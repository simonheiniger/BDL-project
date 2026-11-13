// Balance-Simulation – gleiche Formeln wie contracts/contracts/lib/GameMath.sol
//
//   node sim/balance-sim.mjs            -> Tabellen auf stdout + CSVs in sim/out/
//   EXP=1.3 C=1000 node sim/balance-sim.mjs   (Tuning-Parameter variieren)
import { mkdirSync, writeFileSync } from "node:fs";

const EXP = Number(process.env.EXP ?? 1.5); // XP-Kurve: xpToNext(L) = 50 * L^EXP
const C = Number(process.env.C ?? 2000); // Power-Floor
const XP_PER_ACTION = 20;
const ACTIONS_PER_DAY = 6;
const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- Formeln
const xpToNext = (L) => (EXP === 1.5 ? Math.floor((50 * L * Math.floor(Math.sqrt(L * 1e6))) / 1e3) : Math.floor(50 * L ** EXP));
const cumXp = (L) => {
  let s = 0;
  for (let i = 1; i < L; i++) s += xpToNext(i);
  return s;
};
const power = (stats, L, w) => Math.floor((stats.reduce((a, s, i) => a + s * w[i], 0) * (100 + 4 * L)) / 100) + C;
const fuseStat = (a, b, fc) => Math.min(Math.max(a, b) + Math.floor((Math.min(a, b) * 3000) / (10000 * (1 + fc))), 200);
const fuseLevelV1 = (a, b) => Math.min(Math.max(a, b) + Math.floor(Math.min(a, b) / 4), 50); // verworfen
const levelFromXp = (t) => {
  let L = 1;
  while (L < 50 && t >= xpToNext(L)) t -= xpToNext(L++);
  return L;
};
const fuseXpV2 = (xa, xb) => xa + Math.floor(xb / 2); // aktuell: XP' = XP_keep + 50 % XP_burn

/** Typisches Pet auf Level L: Start-Stats 10, pro Level-Up +1 alle, +2 Fokus (gleichmaessig verteilt -> +1.5 Schnitt) */
const typicalStats = (L) => [0, 1, 2, 3].map(() => Math.round(10 + (L - 1) * 1.5));

const CHALLENGES = {
  Sprint: [20, 50, 0, 30],
  Kraftprobe: [60, 10, 0, 30],
  Raetsel: [0, 20, 70, 10],
  Ausdauer: [20, 20, 10, 50],
};

const table = (rows, file) => {
  const head = Object.keys(rows[0]);
  console.log("| " + head.join(" | ") + " |\n|" + head.map(() => "---").join("|") + "|");
  for (const r of rows) console.log("| " + head.map((h) => r[h]).join(" | ") + " |");
  if (file) writeFileSync(new URL(`${file}.csv`, OUT), [head.join(","), ...rows.map((r) => head.map((h) => r[h]).join(","))].join("\n"));
};

// ---------------------------------------------------------------- 1) XP-Kurve
console.log(`\n## 1) XP-Kurve (xpToNext = 50 * L^${EXP}, ${XP_PER_ACTION} XP/Aktion, ${ACTIONS_PER_DAY} Aktionen/Tag)\n`);
table(
  [2, 5, 10, 15, 20, 30, 50].map((L) => ({
    Level: L,
    kumXP: cumXp(L),
    Aktionen: Math.ceil(cumXp(L) / XP_PER_ACTION),
    Tage: Math.ceil(cumXp(L) / XP_PER_ACTION / ACTIONS_PER_DAY),
  })),
  "xp_curve",
);

// ---------------------------------------------------------------- 2) Turnier 1-vs-1
console.log(`\n## 2) Gewinnchance 1-vs-1 gegen Level-1-Pet (Challenge Ausdauer, C=${C})\n`);
const w = CHALLENGES.Ausdauer;
const p1 = power(typicalStats(1), 1, w);
table(
  [1, 5, 10, 20, 30, 50].map((L) => {
    const pL = power(typicalStats(L), L, w);
    return { Level: L, Power: pL, "P(win) vs Lv1": (pL / (pL + p1)).toFixed(3), "ohne Floor": ((pL - C) / (pL - C + p1 - C)).toFixed(3) };
  }),
  "winrate_1v1",
);

// ---------------------------------------------------------------- 3) Monte Carlo: empirisch == analytisch?
console.log("\n## 3) Monte Carlo (10 000 Turniere, 8 Teilnehmer, gemischte Level)\n");
const levels = [1, 3, 5, 8, 10, 15, 20, 30];
const N = 10_000;
const wins = new Array(levels.length).fill(0);
const analytic = new Array(levels.length).fill(0);
const chNames = Object.keys(CHALLENGES);
for (let t = 0; t < N; t++) {
  const ch = CHALLENGES[chNames[Math.floor(Math.random() * chNames.length)]];
  const ps = levels.map((L) => power(typicalStats(L), L, ch));
  const tot = ps.reduce((a, b) => a + b, 0);
  ps.forEach((p, i) => (analytic[i] += p / tot / N));
  let r = Math.random() * tot;
  for (let i = 0; i < ps.length; i++) {
    if (r < ps[i]) {
      wins[i]++;
      break;
    }
    r -= ps[i];
  }
}
table(levels.map((L, i) => ({ Level: L, empirisch: (wins[i] / N).toFixed(3), analytisch: analytic[i].toFixed(3) })), "montecarlo");

// ---------------------------------------------------------------- 4) Fusion-Oekonomie
console.log("\n## 4) Fusion 2 -> 1: XP-Wert vorher/nachher (V1 = max+min/4 [verworfen], V2 = XP_a + XP_b/2)\n");
table(
  [
    [5, 5],
    [10, 10],
    [20, 20],
    [20, 5],
    [30, 5],
    [30, 30],
  ].map(([a, b]) => {
    const input = cumXp(a) + cumXp(b);
    const v1 = fuseLevelV1(a, b);
    const v2xp = fuseXpV2(cumXp(a), cumXp(b));
    const pct = (x) => `${Math.round((1 - x / input) * 100)}%`;
    return { Eltern: `${a}+${b}`, "XP rein": input, "V1 Level": v1, "V1 vernichtet": pct(cumXp(v1)), "V2 Level": levelFromXp(v2xp), "V2 vernichtet": pct(v2xp) };
  }),
  "fusion",
);
console.log("-> V1 negativ bei 20+5 / 30+5 = Wert wird ERZEUGT -> Futter-Pet-Exploit. V2 vernichtet immer >= 0.");

console.log("\n## 5) Kettenfusion: Diminishing Returns (Stat 40 + 40, Bonus pro Fusion)\n");
let s = 40;
const chain = [];
for (let fc = 0; fc < 6; fc++) {
  const n = fuseStat(s, 40, fc);
  chain.push({ Fusion: fc + 1, vorher: s, nachher: n, Bonus: n - s });
  s = n;
}
table(chain, "fusion_chain");

// ---------------------------------------------------------------- 6) Supply
console.log("\n## 6) Supply ueber 52 Wochen (500 Mints/Woche, Fusionsrate wachsend mit Anteil Pets >= Lv5)\n");
let supply = 0;
let burned = 0;
const rows = [];
for (let week = 1; week <= 52; week++) {
  supply += 500;
  const eligible = week > 1 ? Math.min(0.8, week / 30) : 0; // Anteil fusionsbereiter Pets
  const fusions = Math.floor(supply * eligible * 0.02); // 2 % davon fusionieren pro Woche
  supply -= fusions;
  burned += fusions;
  if (week % 4 === 0) rows.push({ Woche: week, Supply: supply, "Burned kum.": burned, "Burn/Mint": (fusions / 500).toFixed(2) });
}
table(rows, "supply");
console.log(`\nCSVs -> ${OUT.pathname}`);
