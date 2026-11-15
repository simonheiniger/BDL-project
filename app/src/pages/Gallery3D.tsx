import { useEffect, useState } from "react";
import { snapshot, type PetInput } from "../three/scene";
import { SPECIES } from "../three/dna";

// Galerie aller Spezies/Mischlinge/Stufen – gleiche DNA-Bauweise wie contracts/scripts/gallery.ts
// Gen-Wert = Untergrenze des Spezies-Bereichs (siehe dna.ts SPECIES_CUM)
const SP = [0, 9, 18, 27, 35, 42, 46, 51, 57, 62, 67, 75, 82, 88, 94];
const mk = (pal: number, body: number, ears: number, tail: number, eyes = 0, pattern = 0, bg = 1) =>
  [pal, SP[body], SP[ears], eyes, 0, pattern, bg, SP[tail]].reduce((a, v, i) => a | (BigInt(v) << BigInt(16 * i)), 0n);

type Item = { label: string; input: PetInput };
const P = (dna: bigint, level = 8, generation = 1, item = 0): PetInput => ({ dna, level, generation, item });
const PAL = [0, 2, 2, 4, 3, 5, 0, 1, 1, 3, 5, 0, 3, 2, 1]; // passende Farbe pro Spezies
const BG = [0, 1, 2, 3, 4, 5, 0, 1, 5, 4, 4, 2, 1, 0, 2];

const SECTIONS: [string, Item[]][] = [
  ["Spezies (reinrassig)", SPECIES.map((n, i) => ({ label: n, input: P(mk(PAL[i], i, i, i, 0, i === 0 ? 3 : 1, BG[i])) }))],
  [
    "Mischlinge (nur durch Fusion)",
    [
      { label: "Wolf + Fuchsohren + Löwenschwanz", input: P(mk(1, 14, 1, 13), 8, 2) },
      { label: "Löwe + Elefantenohren + Krokodilschwanz", input: P(mk(2, 13, 7, 9), 8, 2) },
      { label: "Pinguin + Eulenohren + Fuchsschwanz", input: P(mk(5, 10, 11, 1), 8, 2) },
      { label: "Giraffe + Hasenohren + Löwenschwanz", input: P(mk(0, 6, 2, 13), 8, 2) },
      { label: "Krokodil + Drachenhörner + Katzenschwanz", input: P(mk(3, 9, 5, 0), 8, 2) },
      { label: "Bär + Hasenohren + Fuchsschwanz", input: P(mk(0, 3, 2, 1), 8, 2) },
      { label: "Nashorn + Katzenohren + Drachenschwanz", input: P(mk(1, 8, 0, 5), 8, 2) },
    ],
  ],
  [
    "Evolution",
    [
      { label: "Ei (Lv 1)", input: P(mk(2, 1, 1, 1), 1) },
      { label: "Baby (Lv 3)", input: P(mk(2, 1, 1, 1), 3) },
      { label: "Erwachsen (Lv 8)", input: P(mk(2, 1, 1, 1), 8) },
      { label: "Legendär (Lv 20)", input: P(mk(2, 1, 1, 1, 5, 0, 2), 20) },
    ],
  ],
  [
    "Seltene Farben & Cosmetics",
    [
      { label: "Galaxie", input: P(mk(93, 5, 5, 5, 3, 0, 2)) },
      { label: "Gold", input: P(mk(98, 13, 13, 13, 5, 0, 5)) },
      { label: "Lava", input: P(mk(81, 9, 9, 9, 0, 0, 0)) },
      { label: "Zylinder", input: P(mk(1, 10, 10, 10), 8, 1, 1) },
      { label: "Sonnenbrille", input: P(mk(2, 1, 1, 1), 8, 1, 2) },
      { label: "Krone", input: P(mk(2, 13, 13, 13), 8, 1, 3) },
      { label: "Schal", input: P(mk(5, 6, 6, 6), 8, 1, 4) },
      { label: "Flügel", input: P(mk(3, 7, 7, 7), 8, 1, 5) },
    ],
  ],
];

export default function Gallery3D() {
  const [imgs, setImgs] = useState<Record<string, string>>({});
  useEffect(() => {
    // nacheinander rendern, damit die Seite nicht blockiert
    const all = SECTIONS.flatMap(([, items]) => items);
    let i = 0;
    const next = () => {
      if (i >= all.length) return;
      const it = all[i++];
      const url = snapshot(it.input, 400);
      if (url) setImgs((m) => ({ ...m, [it.label]: url }));
      setTimeout(next, 0);
    };
    next();
  }, []);
  return (
    <>
      <h2>3D-Galerie</h2>
      <p className="muted">Alle Tiere werden prozedural aus der DNA gebaut – dieselbe DNA wie on-chain.</p>
      {SECTIONS.map(([title, items]) => (
        <section key={title}>
          <h3>{title}</h3>
          <div className="gal3d">
            {items.map((it) => (
              <figure key={it.label}>
                {imgs[it.label] ? <img src={imgs[it.label]} alt={it.label} /> : <div className="ph" />}
                <figcaption>{it.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
