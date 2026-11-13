// Spiegel von contracts/contracts/lib/GameMath.sol – fuer Vorschauen im UI (Fusion, Gewinnchancen).
// Die verbindliche Berechnung passiert immer on-chain.

const isqrt = (n: bigint) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};

export const MAX_LEVEL = 50;
export const POWER_FLOOR = 2000;

export const xpToNext = (level: number) => Number((50n * BigInt(level) * isqrt(BigInt(level) * 1_000_000n)) / 1000n);

export function totalXp(level: number, xp: number) {
  let t = xp;
  for (let l = 1; l < level; l++) t += xpToNext(l);
  return t;
}

export function levelFromXp(total: number): [number, number] {
  let level = 1;
  while (level < MAX_LEVEL && total >= xpToNext(level)) {
    total -= xpToNext(level);
    level++;
  }
  return [level, level === MAX_LEVEL ? 0 : total];
}

export function power(stats: readonly number[], level: number, weights: readonly number[]) {
  const score = stats.reduce((a, s, i) => a + s * weights[i], 0);
  return Math.floor((score * (100 + 4 * level)) / 100) + POWER_FLOOR;
}

/** Gewinnwahrscheinlichkeit p_j = P_j / Σ P */
export function winProbabilities(entries: { stats: readonly number[]; level: number }[], weights: readonly number[]) {
  const ps = entries.map((e) => power(e.stats, e.level, weights));
  const total = ps.reduce((a, b) => a + b, 0);
  return ps.map((p) => (total ? p / total : 0));
}

export function fusePreview(
  keep: { stats: readonly number[]; level: number; xp: number; fusionCount: number },
  burn: { stats: readonly number[]; level: number; xp: number; fusionCount: number },
) {
  const fc = Math.max(keep.fusionCount, burn.fusionCount);
  const stats = keep.stats.map((a, i) => {
    const b = burn.stats[i];
    const v = Math.max(a, b) + Math.floor((Math.min(a, b) * 3000) / (10_000 * (1 + fc)));
    return Math.min(v, 200);
  });
  const xpIn = totalXp(keep.level, keep.xp) + totalXp(burn.level, burn.xp);
  const xpOut = totalXp(keep.level, keep.xp) + Math.floor(totalXp(burn.level, burn.xp) / 2);
  const [level, xp] = levelFromXp(xpOut);
  return { stats, level, xp, fusionCount: fc + 1, burnedPct: Math.round((1 - xpOut / xpIn) * 100) };
}
