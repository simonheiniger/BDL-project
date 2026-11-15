// Spiegel von PetRenderer.look() – gleiche Gene, gleiche Gewichte wie on-chain.
// Die DNA ist die einzige Quelle: SVG (on-chain) und 3D (Browser) zeigen dasselbe Tier.

export type Look = {
  palette: number; // 0 Karamell, 1 Schiefer, 2 Pfirsich, 3 Minze, 4 Lavendel, 5 Himmel, 6 Lagune, 7 Lava, 8 Galaxie, 9 Gold
  species: number; // 0 Katze, 1 Fuchs, 2 Hase, 3 Baer, 4 Frosch, 5 Drache, 6 Giraffe, 7 Elefant, 8 Nashorn, 9 Krokodil, 10 Pinguin, 11 Eule, 12 Schildkroete, 13 Loewe, 14 Wolf
  ears: number;
  tail: number;
  eyes: number; // 0 Kuller, 1 Schlaefrig, 2 Zwinkernd, 3 Funkelnd, 4 Herz, 5 Sterne
  mouth: number;
  pattern: number; // 0 Keins, 1 Bauch, 2 Punkte, 3 Streifen, 4 Herz (Brustfleck)
  bg: number; // 0 Sonnenuntergang, 1 Minzwiese, 2 Sternennacht, 3 Zuckerwatte, 4 Ozean, 5 Creme
  tier: number;
  stage: number; // 0 Ei, 1 Baby, 2 Erwachsen, 3 Legendaer
};

const gene = (dna: bigint, slot: number) => Number((dna >> BigInt(16 * slot)) & 0xffffn);

/** Kumulierte Wahrscheinlichkeiten (%) pro Spezies-Index – identisch zu PetRenderer.speciesOf */
const SPECIES_CUM = [9, 18, 27, 35, 42, 46, 51, 57, 62, 67, 75, 82, 88, 94, 100];
export const SPECIES = ["Katze", "Fuchs", "Hase", "Baer", "Frosch", "Drache", "Giraffe", "Elefant", "Nashorn", "Krokodil", "Pinguin", "Eule", "Schildkroete", "Loewe", "Wolf"];

export function speciesOf(g: number) {
  const r = g % 100;
  return SPECIES_CUM.findIndex((c) => r < c);
}

export function decode(dna: bigint, level: number): Look {
  let r = gene(dna, 0) % 100;
  const palette = r < 80 ? r % 6 : r < 92 ? 6 + (r % 2) : r < 98 ? 8 : 9;
  const species = speciesOf(gene(dna, 1));
  const ears = speciesOf(gene(dna, 2));
  const tail = speciesOf(gene(dna, 7));
  r = gene(dna, 3) % 100;
  const eyes = r < 30 ? 0 : r < 50 ? 1 : r < 65 ? 2 : r < 80 ? 3 : r < 92 ? 4 : 5;
  const mouth = gene(dna, 4) % 4;
  r = gene(dna, 5) % 100;
  const pattern = r < 35 ? 0 : r < 55 ? 1 : r < 72 ? 2 : r < 88 ? 3 : 4;
  const bg = gene(dna, 6) % 6;

  let pts = palette === 9 ? 6 : palette === 8 ? 4 : palette >= 6 ? 2 : 0;
  pts += eyes === 5 ? 2 : eyes === 4 ? 1 : 0;
  pts += species === 5 ? 3 : species === 6 || species === 8 || species === 9 ? 2 : species === 4 || species === 7 || species === 13 || species === 14 ? 1 : 0;
  pts += pattern === 4 ? 1 : 0;
  pts += (ears !== species ? 1 : 0) + (tail !== species ? 1 : 0);
  const tier = pts >= 6 ? 3 : pts >= 4 ? 2 : pts >= 2 ? 1 : 0;
  const stage = level <= 1 ? 0 : level < 5 ? 1 : level < 15 ? 2 : 3;
  return { palette, species, ears, tail, eyes, mouth, pattern, bg, tier, stage };
}

/** Item-IDs wie im Deploy-Script */
export const ITEM_IDS: Record<string, number> = { Zylinder: 1, Sonnenbrille: 2, Krone: 3, Schal: 4, Fluegel: 5 };
