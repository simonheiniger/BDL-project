import { useChainQuery } from "../hooks";

// Galerie aller Arten/Mischlinge/Stufen/Cosmetics – gerendert vom PetRenderer-Contract selbst (eth_call),
// also exakt das Bild, das ein Pet mit dieser DNA on-chain bekommt.
// Spezies-Gen = Untergrenze des Bereichs (PetRenderer.speciesOf, kumulierte Prozent-Grenzen)
const SP = [0, 9, 18, 27, 35, 42, 46, 51, 57, 62, 67, 75, 82, 88, 94];
const SPECIES = ["Katze", "Fuchs", "Hase", "Bär", "Frosch", "Drache", "Giraffe", "Elefant", "Nashorn", "Krokodil", "Pinguin", "Eule", "Schildkröte", "Löwe", "Wolf"];
const mk = (pal: number, body: number, ears: number, tail: number, eyes = 0, pattern = 0, bg = 1) =>
  [pal, SP[body], SP[ears], eyes, 0, pattern, bg, SP[tail]].reduce((a, v, i) => a | (BigInt(v) << BigInt(16 * i)), 0n);

type Item = { label: string; dna: bigint; level?: number; generation?: number; item?: number };
const PAL = [0, 2, 2, 4, 3, 5, 0, 1, 1, 3, 5, 0, 3, 0, 1]; // passende Farbe pro Art
const BG = [0, 1, 2, 3, 4, 5, 0, 1, 5, 4, 4, 2, 1, 0, 2];

const SECTIONS: [string, Item[]][] = [
  ["Arten (reinrassig)", SPECIES.map((n, i) => ({ label: n, dna: mk(PAL[i], i, i, i, i % 3 === 0 ? 3 : 0, 0, BG[i]) }))],
  [
    "Mischlinge (nur durch Fusion)",
    [
      { label: "Wolf + Fuchsohren + Löwenschwanz", dna: mk(1, 14, 1, 13), generation: 2 },
      { label: "Löwe + Elefantenohren + Krokodilschwanz", dna: mk(2, 13, 7, 9), generation: 2 },
      { label: "Pinguin + Eulenohren + Fuchsschwanz", dna: mk(5, 10, 11, 1), generation: 2 },
      { label: "Krokodil + Drachenhörner + Katzenschwanz", dna: mk(3, 9, 5, 0), generation: 2 },
      { label: "Bär + Froschaugen + Drachenschwanz", dna: mk(4, 3, 4, 5), generation: 2 },
    ],
  ],
  [
    "Evolution",
    [
      { label: "Ei (Lv 1)", dna: mk(2, 1, 1, 1), level: 1 },
      { label: "Baby (Lv 3)", dna: mk(2, 1, 1, 1), level: 3 },
      { label: "Erwachsen (Lv 8)", dna: mk(2, 1, 1, 1), level: 8 },
      { label: "Legendär (Lv 20)", dna: mk(2, 1, 1, 1, 5, 0, 2), level: 20 },
    ],
  ],
  [
    "Seltene Farben, Muster & Cosmetics",
    [
      { label: "Galaxie", dna: mk(93, 5, 5, 5, 3, 0, 2) },
      { label: "Gold", dna: mk(98, 13, 13, 13, 5, 0, 5) },
      { label: "Tigerstreifen", dna: mk(2, 0, 0, 0, 0, 3, 0) },
      { label: "Herz-Muster", dna: mk(4, 3, 3, 3, 4, 4, 3) },
      { label: "Zylinder", dna: mk(1, 10, 10, 10), item: 1 },
      { label: "Sonnenbrille", dna: mk(2, 1, 1, 1), item: 2 },
      { label: "Krone", dna: mk(2, 13, 13, 13), item: 3 },
      { label: "Schal", dna: mk(5, 6, 6, 6), item: 4 },
      { label: "Flügel", dna: mk(3, 7, 7, 7), item: 5 },
    ],
  ],
];

const ALL = SECTIONS.flatMap(([, items]) => items);

export default function Galerie() {
  const { data: imgs } = useChainQuery(["galerie"], async (pc, c) => {
    const out: Record<string, string> = {};
    await Promise.all(
      ALL.map(async (it) => {
        const pet = {
          stats: [10, 10, 10, 10],
          focus: [0, 0, 0, 0],
          level: it.level ?? 8,
          xp: 0,
          lastAction: 0n,
          dayStart: 0n,
          actionsToday: 0,
          fusionCount: 0,
          generation: it.generation ?? 1,
          equipped: 0,
          dna: it.dna,
        };
        const svg = (await pc.readContract({ ...c.PetRenderer, functionName: "svg", args: [pet, BigInt(it.item ?? 0)] })) as string;
        out[it.label] = `data:image/svg+xml;base64,${btoa(svg)}`;
      }),
    );
    return out;
  });

  return (
    <>
      <h2>Galerie</h2>
      <p className="muted">Pixel-Art, komplett on-chain aus der DNA erzeugt – jedes Bild hier kommt direkt vom Contract.</p>
      {SECTIONS.map(([title, items]) => (
        <section key={title}>
          <h3>{title}</h3>
          <div className="gal3d">
            {items.map((it) => (
              <figure key={it.label}>
                {imgs?.[it.label] ? <img className="pixel" src={imgs[it.label]} alt={it.label} /> : <div className="ph" />}
                <figcaption>{it.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
