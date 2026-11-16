import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Galerie: rendert Pets mit zufaelliger DNA in allen Evolutionsstufen + mit Cosmetics
 * direkt ueber PetRenderer.svg() (In-Process-Hardhat, kein Deploy noetig).
 *
 *   npx hardhat run scripts/gallery.ts      -> docs/gallery/index.html
 *   N=200 npx hardhat run scripts/gallery.ts  (Seltenheits-Statistik ueber N Pets)
 */
const OUT = path.join(__dirname, "../../docs/gallery");

async function main() {
  const decor = await ethers.deployContract("PetDecor");
  const anatomy = await ethers.deployContract("PetAnatomy");
  const r = await ethers.deployContract("PetRenderer", [await decor.getAddress(), await anatomy.getAddress()]);
  const n = Number(process.env.N ?? 24);
  const base = {
    stats: [10, 10, 10, 10],
    focus: [0, 0, 0, 0],
    level: 5,
    xp: 0,
    lastAction: 0,
    dayStart: 0,
    actionsToday: 0,
    fusionCount: 0,
    generation: 1,
    equipped: 0,
  };
  const tiers = ["Common", "Rare", "Epic", "Legendary"];
  const count = [0, 0, 0, 0];
  const cards: string[] = [];

  for (let i = 0; i < n; i++) {
    // wie PetNFT.mint(): reinrassig -> Ohren-/Schwanz-Gen = Spezies-Gen
    let dna = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`gallery-${i}`)));
    const sp = (dna >> 16n) & 0xffffn;
    dna = (dna & ~((0xffffn << 32n) | (0xffffn << 112n))) | (sp << 32n) | (sp << 112n);
    const look = await r.look(dna, 5);
    count[Number(look.tier)]++;
    if (i < 24) {
      const svg = await r.svg({ ...base, dna }, 0);
      cards.push(card(svg, `#${i} ${tiers[Number(look.tier)]}`));
    }
  }

  // DNA gezielt bauen: Spezies-Gen = Untergrenze des Bereichs (siehe PetRenderer.speciesOf)
  const SP = [0, 9, 18, 27, 35, 42, 46, 51, 57, 62, 67, 75, 82, 88, 94];
  const names = ["Katze", "Fuchs", "Hase", "Baer", "Frosch", "Drache", "Giraffe", "Elefant", "Nashorn", "Krokodil", "Pinguin", "Eule", "Schildkroete", "Loewe", "Wolf"];
  const mk = (pal: number, body: number, ears: number, tail: number, eyes = 0, mouth = 0, pattern = 0, bg = 5) =>
    [pal, SP[body], SP[ears], eyes, mouth, pattern, bg, SP[tail]].reduce((acc, v, i) => acc | (BigInt(v) << BigInt(16 * i)), 0n);

  const species: string[] = [];
  for (let i = 0; i < names.length; i++) {
    species.push(card(await r.svg({ ...base, level: 8, dna: mk(i % 6, i, i, i, i % 4 === 3 ? 3 : 0, i % 4, i === 3 ? 1 : 0, i % 6) }, 0), names[i]));
  }

  const hybrids: string[] = [];
  for (const [b, e, t, label] of [
    [13, 7, 9, "Loewe + Elefantenohren + Krokodilschwanz"],
    [10, 11, 1, "Pinguin + Eulenohren + Fuchsschwanz"],
    [9, 5, 0, "Krokodil + Drachenhoerner + Katzenschwanz"],
    [8, 0, 5, "Nashorn + Katzenohren + Drachenschwanz"],
  ] as const) {
    hybrids.push(card(await r.svg({ ...base, level: 8, generation: 2, dna: mk(4, b, e, t, 3, 1, 0, 3) }, 0), label));
  }

  const dna = mk(2, 1, 1, 1, 0, 1, 1, 0);
  const evo: string[] = [];
  for (const [level, label] of [
    [1, "Ei (Lv 1)"],
    [3, "Baby (Lv 3)"],
    [8, "Erwachsen (Lv 8)"],
    [20, "Legendaer (Lv 20)"],
  ] as const) {
    evo.push(card(await r.svg({ ...base, level, dna }, 0), label));
  }
  const items = ["Zylinder", "Sonnenbrille", "Krone", "Schal", "Fluegel"];
  for (let id = 1; id <= 5; id++) {
    evo.push(card(await r.svg({ ...base, level: 8, dna: mk(id + 2, id % 6, id % 6, id % 6, id % 3, 0, 0, id) }, id), items[id - 1]));
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>BDL Pets Galerie</title>
<style>body{background:#1f1d2e;color:#e0def4;font:14px system-ui;margin:16px}.g{display:grid;grid-template-columns:repeat(auto-fill,180px);gap:12px}
.c{text-align:center}.c img{width:180px;height:180px;border-radius:12px;display:block}</style>
<h2>Spezies (reinrassig)</h2><div class="g">${species.join("")}</div>
<h2>Mischlinge (nur durch Fusion)</h2><div class="g">${hybrids.join("")}</div>
<h2>Evolution &amp; Cosmetics</h2><div class="g">${evo.join("")}</div>
<h2>Zufaellige DNA</h2><div class="g">${cards.join("")}</div>`,
  );
  console.log(`Seltenheit ueber ${n} Pets:`, tiers.map((t, i) => `${t} ${((count[i] / n) * 100).toFixed(1)}%`).join(", "));
  console.log(`-> ${path.relative(process.cwd(), OUT)}/index.html`);
}

const card = (svg: string, label: string) =>
  `<div class="c"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"><div>${label}</div></div>`;

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
