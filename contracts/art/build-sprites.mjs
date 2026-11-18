// Pixel-Art-Generator: zeichnet alle Sprites (32x32, Chibi-Stil) und schreibt sie als
// kompakte Nibble-Daten (4 Bit pro Pixel) in Solidity-Contracts.
//
//   node art/build-sprites.mjs        -> contracts/pixel/SpriteBodies.sol + SpriteExtras.sol
//                                        + art/out/preview.txt (ASCII-Vorschau)
//
// Farb-Indizes (siehe PetRenderer._style): 0 transparent, 1 Kontur, 2 Fell, 3 Fell hell, 4 Fell dunkel,
// 5 weiss, 6 rosa, 7 gelb, 8 schwarz, 9 rot, 10 gruen, 11 cyan, 12 silber, 13 braun, 14 orange
//
// Feste Anker (alle Arten gleich -> Ohren/Schwanz/Cosmetics passen bei Mischlingen pixelgenau):
//   Kopf  ~ Spalten 8..23, Zeilen 7..19      Augen 3x3 bei (11,11) und (18,11)
//   Mund  Zeilen 16..18 um Spalte 15.5        Ohren-Ebene Zeilen 0..19, Schwanz-Ebene x 20..31 / y 13..28
import { writeFileSync, mkdirSync } from "node:fs";

const CH = { ".": 0, o: 1, b: 2, l: 3, d: 4, w: 5, p: 6, y: 7, k: 8, r: 9, g: 10, c: 11, s: 12, n: 13, e: 14 };
const SPECIES = ["Katze", "Fuchs", "Hase", "Baer", "Frosch", "Drache", "Giraffe", "Elefant", "Nashorn", "Krokodil", "Pinguin", "Eule", "Schildkroete", "Loewe", "Wolf"];

// ------------------------------------------------------------------ Zeichen-Werkzeuge

const grid = (h = 32, w = 32) => Array.from({ length: h }, () => Array(w).fill("."));
const inb = (g, x, y) => y >= 0 && y < g.length && x >= 0 && x < g[0].length;
const set = (g, x, y, c) => inb(g, x, y) && (g[y][x] = c);
const get = (g, x, y) => (inb(g, x, y) ? g[y][x] : ".");

/** Ellipse (Pixelmitten-Test); gibt die Maske zurueck */
function ellipse(g, cx, cy, rx, ry, c, cond = () => true) {
  const m = new Set();
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && cond(x, y)) {
        g[y][x] = c;
        m.add(y * 64 + x);
      }
    }
  return m;
}
function rect(g, x0, y0, x1, y1, c) {
  const m = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(g, x, y)) (g[y][x] = c), m.add(y * 64 + x);
  return m;
}
/** Polygon (Pixelmitten in Polygon) */
function poly(g, pts, c) {
  const m = new Set();
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) (g[y][x] = c), m.add(y * 64 + x);
    }
  return m;
}
/** Dicker Strich: Kreise entlang einer Punktfolge, Radius r0 -> r1 */
function stroke(g, pts, r0, r1, c) {
  const m = new Set();
  const n = 40;
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const lt = t * (pts.length - 1) - seg;
    const [ax, ay] = pts[seg], [bx, by] = pts[seg + 1];
    const cx = ax + (bx - ax) * lt, cy = ay + (by - ay) * lt;
    const r = r0 + (r1 - r0) * t;
    for (const k of ellipse(g, cx, cy, r, r, c)) m.add(k);
  }
  return m;
}
/** Kontur: alle Nachbarn (4er) der Maske, die nicht zur Maske gehoeren, werden 'o' */
function outline(g, mask, only = () => true) {
  for (const k of mask) {
    const x = k % 64, y = Math.floor(k / 64);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inb(g, nx, ny) && !mask.has(ny * 64 + nx) && only(nx, ny)) g[ny][nx] = "o";
    }
  }
}
/** Schattierung: Fellpixel mit Kontur rechts/unten werden dunkel */
function shade(g, mask) {
  for (const k of mask) {
    const x = k % 64, y = Math.floor(k / 64);
    if (g[y][x] !== "b") continue;
    if (get(g, x + 1, y) === "o" || get(g, x, y + 1) === "o") g[y][x] = "d";
  }
}
const mirror = (g) => {
  for (const row of g) for (let x = 0; x < 16; x++) if (row[x] !== "." && row[31 - x] === ".") row[31 - x] = row[x];
};
/** ASCII-Stempel an Position */
function stamp(g, x0, y0, rows) {
  rows.forEach((r, dy) => [...r].forEach((c, dx) => c !== " " && c !== "_" && set(g, x0 + dx, y0 + dy, c)));
}

// ------------------------------------------------------------------ Grundkoerper (Chibi)

const HEAD = { cx: 16, cy: 13.5, rx: 8.2, ry: 6.8 };

/** Standard-Koerper: Rumpf, Fuesse, Kopf, Bauch. Optionen fuer Spezies-Varianten */
function baseBody(o = {}) {
  const g = grid();
  const h = { ...HEAD, ...(o.head ?? {}) };
  const body = o.body ?? { cx: 16, cy: 23.5, rx: 6.2, ry: 5 };
  const back = o.behind?.(g); // Fluegel, Maehne ... hinter allem
  // Rumpf
  const bm = ellipse(g, body.cx, body.cy, body.rx, body.ry, "b");
  // Fuesse
  const feetY = o.feetY ?? [27, 29];
  const fm = new Set([...rect(g, 11, feetY[0], 13, feetY[1], o.feet ?? "b"), ...rect(g, 18, feetY[0], 20, feetY[1], o.feet ?? "b")]);
  if (o.neck) for (const k of rect(g, ...o.neck, "b")) bm.add(k);
  const torso = new Set([...bm, ...fm]);
  outline(g, torso, (x, y) => !(back && back.has(y * 64 + x)) || true);
  // Bauch
  if (o.belly !== false) ellipse(g, body.cx, body.cy + 0.8, body.rx * 0.55, body.ry * 0.6, o.bellyColor ?? "l", (x, y) => g[y][x] === "b");
  o.bodyExtra?.(g, torso);
  // Kopf mit eigener Kontur ueber dem Rumpf
  const hm = ellipse(g, h.cx, h.cy, h.rx, h.ry, "b");
  outline(g, hm);
  shade(g, torso);
  shade(g, hm);
  // Glanzpunkt
  if (o.shine !== false) {
    set(g, 11, 8, "w");
    set(g, 12, 8, "w");
    set(g, 10, 9, "w");
  }
  o.face?.(g, hm);
  return g;
}

const nose = (g, c = "k") => (set(g, 15, 15, c), set(g, 16, 15, c));
const muzzle = (g, c = "l", rx = 3.2, ry = 2.2, cy = 16.3) => ellipse(g, 16, cy, rx, ry, c, (x, y) => g[y][x] === "b" || g[y][x] === "d");

// ------------------------------------------------------------------ Koerper je Spezies

const bodies = [
  // 0 Katze: Schnurrhaare, rosa Naeschen
  () =>
    baseBody({
      face: (g) => {
        nose(g, "p");
        for (const y of [15, 17]) {
          set(g, 5, y, "k"), set(g, 6, y, "k");
          set(g, 25, y, "k"), set(g, 26, y, "k");
        }
      },
    }),
  // 1 Fuchs: weisse Schnauze/Wangen, schwarze Socken
  () =>
    baseBody({
      feet: "k",
      face: (g, hm) => {
        for (const k of hm) {
          const x = k % 64, y = Math.floor(k / 64);
          const cheek = y >= 15 && (Math.abs(x - 15.5) <= 3 || y >= 17);
          if (cheek && (g[y][x] === "b" || g[y][x] === "d")) g[y][x] = "w";
        }
        nose(g);
      },
    }),
  // 2 Hase: Hasenzaehne
  () =>
    baseBody({
      face: (g) => {
        nose(g, "p");
        set(g, 15, 18, "w"), set(g, 16, 18, "w");
      },
      bellyColor: "w",
    }),
  // 3 Baer: helle Schnauze, grosse Nase
  () =>
    baseBody({
      body: { cx: 16, cy: 23.5, rx: 7, ry: 5.2 },
      face: (g) => {
        muzzle(g);
        nose(g);
        set(g, 15, 14, "k"), set(g, 16, 14, "k");
      },
    }),
  // 4 Frosch: breiter flacher Kopf, Breitmaul (eigenes Maul -> kein Mund-Gen)
  () =>
    baseBody({
      head: { cy: 14.2, rx: 9.6, ry: 5.8 },
      body: { cx: 16, cy: 23.8, rx: 7, ry: 4.6 },
      face: (g) => {
        stamp(g, 9, 16, ["k            k", " kkkkkkkkkkkk "]);
        ellipse(g, 16, 19, 6, 1.6, "l", (x, y) => g[y][x] === "b" || g[y][x] === "d");
      },
    }),
  // 5 Drache: Bauchschuppen, kleine Fluegel, Nuestern
  () =>
    baseBody({
      behind: (g) => {
        const m = new Set([
          ...poly(g, [[10, 21], [3, 16], [5, 20], [3, 22], [6, 23], [5, 25], [10, 25]], "d"),
          ...poly(g, [[22, 21], [29, 16], [27, 20], [29, 22], [26, 23], [27, 25], [22, 25]], "d"),
        ]);
        outline(g, m);
        return m;
      },
      bellyColor: "y",
      bodyExtra: (g) => {
        for (const y of [22, 24, 26]) for (let x = 13; x <= 18; x++) if (g[y][x] === "y") g[y][x] = "e";
      },
      face: (g) => (set(g, 14, 15, "k"), set(g, 17, 15, "k")),
    }),
  // 6 Giraffe: langer Hals, Flecken
  () =>
    baseBody({
      head: { cy: 12.5, rx: 7.2, ry: 6 },
      body: { cx: 16, cy: 25, rx: 5.6, ry: 3.6 },
      neck: [13, 17, 18, 23],
      feetY: [27, 30],
      bodyExtra: (g, m) => {
        for (const k of m) {
          const x = k % 64, y = Math.floor(k / 64);
          if ((g[y][x] === "b" || g[y][x] === "l") && ((x >> 1) + (y >> 1) * 3) % 4 === 0) g[y][x] = "n";
        }
      },
      face: (g) => {
        muzzle(g, "l", 3, 2, 15.8);
        set(g, 14, 15, "k"), set(g, 17, 15, "k");
        set(g, 9, 9, "n"), set(g, 10, 9, "n"), set(g, 21, 10, "n");
      },
    }),
  // 7 Elefant: Ruessel + Stosszaehne (kein Mund-Gen)
  () =>
    baseBody({
      body: { cx: 16, cy: 23.5, rx: 7.2, ry: 5.2 },
      face: (g) => {
        const tm = stroke(g, [[16, 14], [16, 19], [16.5, 22], [18.5, 23.5]], 1.6, 1.1, "b");
        outline(g, tm, (x, y) => y > 15);
        set(g, 13, 18, "w"), set(g, 12, 19, "w");
        set(g, 19, 18, "w"), set(g, 20, 19, "w");
      },
    }),
  // 8 Nashorn: helle Schnauze + Horn
  () =>
    baseBody({
      body: { cx: 16, cy: 23.5, rx: 7.2, ry: 5.2 },
      face: (g) => {
        muzzle(g, "l", 4, 2.6, 16.6);
        const hm = poly(g, [[14, 15], [16.5, 8], [18, 15]], "w");
        outline(g, hm, (x, y) => g[y][x] !== "w");
        set(g, 14, 17, "k"), set(g, 17, 17, "k");
      },
    }),
  // 9 Krokodil: flacher Kopf, Zahnreihe, Ruecken-Schuppen (kein Mund-Gen)
  () =>
    baseBody({
      head: { cy: 14.5, rx: 9.8, ry: 5.6 },
      body: { cx: 16, cy: 24.2, rx: 7.6, ry: 4.2 },
      feetY: [27, 28],
      face: (g) => {
        ellipse(g, 16, 17.6, 7.2, 1.9, "l", (x, y) => g[y][x] === "b" || g[y][x] === "d");
        for (let x = 10; x <= 21; x++) set(g, x, 16, "k");
        for (let x = 10; x <= 21; x += 2) set(g, x, 17, "w");
        set(g, 14, 14, "k"), set(g, 17, 14, "k");
      },
      bodyExtra: (g) => {
        for (let x = 11; x <= 20; x += 2) set(g, x, 20, "d");
      },
    }),
  // 10 Pinguin: Frack (dunkel), weisser Bauch + Gesicht, Schnabel, Flossen
  () =>
    baseBody({
      body: { cx: 16, cy: 22.8, rx: 7, ry: 6.4 },
      feet: "e",
      feetY: [28, 29],
      bellyColor: "w",
      bodyExtra: (g) => {
        ellipse(g, 16, 23.6, 4.6, 5, "w", (x, y) => g[y][x] === "b" || g[y][x] === "l" || g[y][x] === "d");
        for (const [x0, s] of [[8, -1], [23, 1]]) stamp(g, s < 0 ? x0 : x0, 19, ["d", "d", "d", "d", "d"]);
      },
      face: (g, hm) => {
        for (const k of hm) {
          const x = k % 64, y = Math.floor(k / 64);
          if (y >= 11 && Math.abs(x - 15.5) < 6 && (g[y][x] === "b" || g[y][x] === "d")) g[y][x] = "w";
        }
        stamp(g, 15, 15, ["ee", "ee"]);
        set(g, 15, 17, "e"), set(g, 16, 17, "e");
      },
    }),
  // 11 Eule: Gesichtsscheiben, Schnabel, Fluegel, Brustfedern (kein Mund-Gen)
  () =>
    baseBody({
      body: { cx: 16, cy: 23.6, rx: 6.8, ry: 5.2 },
      feet: "e",
      feetY: [28, 29],
      bodyExtra: (g) => {
        for (const y of [22, 24, 26]) for (const x of [13, 15, 17]) if (g[y][x] === "l") set(g, x, y, "d"), set(g, x + 1, y + 1, "d");
        for (const x of [9, 22]) for (let y = 20; y <= 25; y++) if (g[y][x] !== "o") set(g, x, y, "d");
      },
      face: (g) => {
        for (const cx of [12.5, 19.5]) ellipse(g, cx, 12.6, 3.3, 3.1, "l", (x, y) => g[y][x] === "b" || g[y][x] === "d" || g[y][x] === "w");
        stamp(g, 15, 15, ["yy", "yy", " y"]);
      },
    }),
  // 12 Schildkroete: Panzer hinter dem Kopf
  () =>
    baseBody({
      head: { cy: 14, rx: 7, ry: 5.8 },
      body: { cx: 16, cy: 25, rx: 5.5, ry: 3.6 },
      feetY: [27, 29],
      bodyExtra: (g) => {
        const sm = ellipse(g, 16, 23, 10.5, 6.2, "g", (x, y) => y <= 26);
        outline(g, sm);
        for (const k of sm) {
          const x = k % 64, y = Math.floor(k / 64);
          if ((x + y * 2) % 7 === 0 || y === 26) g[y][x] = "d";
        }
        for (let x = 6; x <= 25; x++) if (get(g, x, 27) === "o" || get(g, x, 26) === "g") set(g, x, 27, "y");
      },
      face: (g) => (set(g, 14, 15, "k"), set(g, 17, 15, "k")),
    }),
  // 13 Loewe: Maehne (hinter dem Kopf), helle Schnauze
  () =>
    baseBody({
      behind: (g) => {
        const m = new Set();
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          for (const k of ellipse(g, 16 + Math.cos(a) * 8.6, 13.5 + Math.sin(a) * 7.4, 2.6, 2.6, "n")) m.add(k);
        }
        for (const k of ellipse(g, 16, 13.5, 9.5, 8.2, "n")) m.add(k);
        outline(g, m);
        return m;
      },
      face: (g) => {
        muzzle(g);
        nose(g);
      },
    }),
  // 14 Wolf: weisse Maske + Brustpelz, dunkle Nase
  () =>
    baseBody({
      feetY: [27, 30],
      bodyExtra: (g) => {
        stamp(g, 12, 19, ["wwwwwwww", " wwwwww ", "  wwww  ", "   ww   "]);
      },
      face: (g, hm) => {
        for (const k of hm) {
          const x = k % 64, y = Math.floor(k / 64);
          const brow = y === 9 && (x === 11 || x === 12 || x === 19 || x === 20);
          if ((y >= 15 || brow) && (g[y][x] === "b" || g[y][x] === "d")) g[y][x] = "w";
        }
        nose(g);
        set(g, 15, 14, "k"), set(g, 16, 14, "k");
        // grimmige Augenbrauen -> unterscheidet Wolf klar vom Fuchs
        for (const [x, y] of [[11, 9], [12, 9], [13, 10], [20, 9], [19, 9], [18, 10]]) set(g, x, y, "k");
      },
    }),
];

// ------------------------------------------------------------------ Ohren (Ebene hinter dem Koerper, Zeilen 0..19)

function earsOf(sp) {
  const g = grid(20, 32);
  const both = (fn) => {
    fn(g);
    mirror(g);
  };
  if (sp === 0 || sp === 14) {
    // Katze / Wolf: spitze Dreiecksohren
    both((g) => {
      const tall = sp === 14 ? 1 : 3;
      const m = poly(g, [[8, 12], [9.5, tall], [15, 9]], "b");
      outline(g, m);
      poly(g, [[10, 10], [10.5, tall + 3], [13.5, 9]], sp === 14 ? "l" : "p");
    });
  } else if (sp === 1) {
    both((g) => {
      const m = poly(g, [[7, 12], [8.5, 0], [15, 8]], "b");
      outline(g, m);
      poly(g, [[9.5, 9], [9.5, 3], [13, 8]], "w");
      for (let y = 0; y <= 2; y++) for (let x = 7; x <= 11; x++) if (g[y][x] === "b") g[y][x] = "k";
    });
  } else if (sp === 2) {
    both((g) => {
      const m = ellipse(g, 12.5, 4.5, 2.3, 6.8, "b");
      outline(g, m);
      ellipse(g, 12.5, 4.8, 0.9, 4.8, "p");
    });
  } else if (sp === 3 || sp === 13) {
    both((g) => {
      const r = sp === 13 ? 2.4 : 3;
      const m = ellipse(g, 10, 7.5, r, r, "b");
      outline(g, m);
      ellipse(g, 10, 7.5, r * 0.45, r * 0.45, "p");
    });
  } else if (sp === 4 || sp === 9) {
    // Augenhuegel (Augen werden darauf gezeichnet)
    both((g) => {
      const r = sp === 9 ? 3 : 3.6;
      const m = ellipse(g, 12, 8.2, r, r, "b");
      outline(g, m);
    });
  } else if (sp === 5) {
    // Drachenhoerner
    both((g) => {
      const m = stroke(g, [[11, 9], [9.5, 5], [8, 2]], 1.2, 0.6, "y");
      outline(g, m);
    });
  } else if (sp === 6) {
    // Ossikone + seitliche Ohren
    both((g) => {
      const m = new Set([...rect(g, 12, 2, 12, 8, "y"), ...ellipse(g, 12.5, 2.5, 1.5, 1.5, "n")]);
      outline(g, m);
      const e = ellipse(g, 6.5, 11, 3, 1.4, "b");
      outline(g, e);
    });
  } else if (sp === 7) {
    // Elefant: riesige Schlappohren seitlich
    both((g) => {
      const m = ellipse(g, 6.5, 13.5, 5.2, 6.2, "b");
      outline(g, m);
      ellipse(g, 7, 13.5, 3.2, 4.2, "p");
    });
  } else if (sp === 8) {
    both((g) => {
      const m = poly(g, [[9, 10], [10, 4], [13, 9]], "b");
      outline(g, m);
    });
  } else if (sp === 11) {
    // Eulen-Federohren
    both((g) => {
      const m = poly(g, [[8, 10], [7, 2], [13, 8]], "d");
      outline(g, m);
    });
  }
  // 10 Pinguin, 12 Schildkroete: keine Ohren
  return g;
}

// ------------------------------------------------------------------ Schwaenze (Ebene x 20..31, y 13..28)

function tailOf(sp) {
  const g = grid(16, 12); // lokale Koordinaten: x+20, y+13
  let m = new Set();
  const tuft = (x, y, c = "n") => {
    const t = ellipse(g, x, y, 1.6, 1.6, c);
    for (const k of t) m.add(k);
  };
  if (sp === 0) m = stroke(g, [[1, 12], [6, 11], [8.5, 6], [7, 1.5]], 1.2, 1.1, "b");
  else if (sp === 1 || sp === 14) {
    const up = sp === 1;
    m = stroke(g, up ? [[1, 12], [5, 10], [8, 5]] : [[1, 9], [4, 12], [7, 14]], 2, up ? 3 : 2.4, "b");
    for (const k of m) {
      const x = k % 64, y = Math.floor(k / 64);
      if (up ? y <= 5 : y >= 13) g[y][x] = up ? "w" : "d";
    }
  } else if (sp === 2) m = ellipse(g, 2, 11.5, 2.6, 2.6, "w");
  else if (sp === 3) m = ellipse(g, 1.5, 11, 2, 2, "b");
  else if (sp === 5 || sp === 9) {
    const croc = sp === 9;
    m = stroke(g, croc ? [[1, 12], [6, 13.5], [11, 14.5]] : [[1, 11], [6, 9], [10, 4]], croc ? 2.4 : 1.8, 0.7, "b");
    for (const [x, y] of croc ? [[3, 10], [6, 11], [9, 12]] : [[3, 8], [6, 6], [8, 3]]) set(g, x, y, "d"), m.add(y * 64 + x);
  } else if (sp === 6 || sp === 7 || sp === 8) {
    m = stroke(g, [[1, 9], [2.5, 12], [3.5, 14]], 0.6, 0.6, "b");
    tuft(3.5, 14.2, "n");
  } else if (sp === 13) {
    m = stroke(g, [[1, 11], [4, 9], [6.5, 4]], 0.7, 0.6, "b");
    tuft(7, 3, "n");
  } else if (sp === 10) m = poly(g, [[0, 12], [4, 15], [0, 15]], "d");
  else if (sp === 11) for (const [x, y] of [[2, 12], [3, 13], [2, 14]]) for (const k of stroke(g, [[0, y], [x + 2, y]], 0.8, 0.8, "d")) m.add(k);
  else if (sp === 12) m = rect(g, 0, 13, 1, 13, "b");
  outline(g, m);
  return g;
}

// ------------------------------------------------------------------ Extras: Eierschale, Cosmetics, Aura

function shellSprite() {
  const g = grid(14, 32); // y 18..31
  const m = ellipse(g, 16, 5, 8.6, 8, "w", (x, y) => {
    const zig = 2 + ((x % 4 < 2 ? x % 2 : 1 - (x % 2)) * 2);
    return y >= zig;
  });
  for (const k of m) {
    const x = k % 64, y = Math.floor(k / 64);
    if (((x * 7 + y * 5) % 11) < 2) g[y][x] = "b";
  }
  outline(g, m);
  return g;
}

function cosmetic(id) {
  const g = grid();
  let m = new Set();
  if (id === 1) {
    m = new Set([...rect(g, 8, 6, 23, 7, "k"), ...rect(g, 11, 0, 20, 5, "k")]);
    for (let x = 11; x <= 20; x++) g[5][x] = "r";
    g[1][12] = "s", g[2][12] = "s";
  } else if (id === 2) {
    m = new Set([...rect(g, 10, 11, 14, 13, "k"), ...rect(g, 17, 11, 21, 13, "k"), ...rect(g, 15, 11, 16, 11, "k")]);
    set(g, 11, 11, "w"), set(g, 18, 11, "w");
  } else if (id === 3) {
    m = new Set([...rect(g, 10, 4, 21, 6, "y")]);
    for (const x of [10, 13, 18, 21]) for (const k of rect(g, x, 2, x, 3, "y")) m.add(k);
    for (const k of rect(g, 15, 1, 16, 3, "y")) m.add(k);
    set(g, 15, 5, "r"), set(g, 16, 5, "r"), set(g, 12, 5, "c"), set(g, 19, 5, "c");
  } else if (id === 4) {
    m = new Set([...rect(g, 9, 20, 22, 21, "r"), ...rect(g, 18, 22, 19, 25, "r")]);
    for (const x of [10, 13, 16, 19, 22]) set(g, x, 20, "w");
    set(g, 18, 24, "w"), set(g, 19, 24, "w");
  } else if (id === 5) {
    m = poly(g, [[10, 19], [2, 13], [3, 17], [1, 19], [4, 21], [3, 24], [10, 24]], "w");
    for (const k of m) {
      const x = k % 64, y = Math.floor(k / 64);
      if ((x + y) % 3 === 0) g[y][x] = "s";
    }
    mirror(g);
    m = new Set();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (g[y][x] !== ".") m.add(y * 64 + x);
  }
  outline(g, m);
  return g;
}

function aura() {
  const g = grid();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    if (i % 2) set(g, Math.round(16 + Math.cos(a) * 14), Math.round(16.5 + Math.sin(a) * 13.5), "y");
  }
  return g;
}

// ------------------------------------------------------------------ Kodierung + Solidity

function pack(g) {
  const flat = g.flat().map((c) => {
    if (!(c in CH)) throw new Error(`unbekanntes Zeichen ${c}`);
    return CH[c];
  });
  if (flat.length % 2) flat.push(0);
  let hex = "";
  for (let i = 0; i < flat.length; i += 2) hex += ((flat[i] << 4) | flat[i + 1]).toString(16).padStart(2, "0");
  return hex;
}

const chain = (name, items, size) =>
  `    /// @dev ${size}\n    function ${name}(uint256 i) external pure returns (bytes memory) {\n` +
  items.map((h, i) => `        if (i == ${i}) return hex"${h}";`).join("\n") +
  `\n        return "";\n    }\n`;

const bodyHex = bodies.map((f) => pack(f()));
const earHex = SPECIES.map((_, i) => pack(earsOf(i)));
const tailHex = SPECIES.map((_, i) => pack(tailOf(i)));

const header = `// SPDX-License-Identifier: MIT
// AUTOMATISCH ERZEUGT von contracts/art/build-sprites.mjs – nicht von Hand bearbeiten.
pragma solidity ^0.8.24;
`;

const OUT = new URL("../contracts/pixel/", import.meta.url);
mkdirSync(OUT, { recursive: true });
writeFileSync(
  new URL("SpriteBodies.sol", OUT),
  header +
    `
/// @title SpriteBodies – Pixel-Art der ${SPECIES.length} Arten (4 Bit pro Pixel, Zeile fuer Zeile)
/// @notice Index = Spezies (${SPECIES.map((s, i) => `${i} ${s}`).join(", ")})
contract SpriteBodies {
${chain("body", bodyHex, "32x32")}
${chain("ears", earHex, "32x20, Zeilen 0..19, hinter dem Koerper")}
${chain("tail", tailHex, "12x16 ab (20,13), hinter dem Koerper")}}
`,
);
writeFileSync(
  new URL("SpriteExtras.sol", OUT),
  header +
    `
/// @title SpriteExtras – Eierschale, Cosmetics (Item-IDs 1..5), Aura
contract SpriteExtras {
    /// @dev 32x14 ab Zeile 18
    function shell() external pure returns (bytes memory) {
        return hex"${pack(shellSprite())}";
    }

${chain("cosmetic", [0, 1, 2, 3, 4, 5].map((i) => (i === 0 ? "" : pack(cosmetic(i)))), "32x32; 1 Zylinder, 2 Sonnenbrille, 3 Krone, 4 Schal, 5 Fluegel (hinter dem Koerper)")}
    /// @dev 32x32 Ring fuer legendaere Pets
    function aura() external pure returns (bytes memory) {
        return hex"${pack(aura())}";
    }
}
`,
);

// ASCII-Vorschau (Koerper + Ohren + Schwanz zusammengesetzt)
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
const preview = SPECIES.map((name, i) => {
  const c = grid();
  const ears = earsOf(i), tail = tailOf(i), body = bodies[i]();
  ears.forEach((r, y) => r.forEach((ch, x) => ch !== "." && (c[y][x] = ch)));
  tail.forEach((r, y) => r.forEach((ch, x) => ch !== "." && (c[y + 13][x + 20] = ch)));
  body.forEach((r, y) => r.forEach((ch, x) => ch !== "." && (c[y][x] = ch)));
  return `${name}\n` + c.map((r) => r.join("")).join("\n");
}).join("\n\n");
writeFileSync(new URL("./out/preview.txt", import.meta.url), preview);
console.log(`Sprites: ${SPECIES.length} Arten, Bytes Koerper ${bodyHex.join("").length / 2}, Ohren ${earHex.join("").length / 2}, Schwaenze ${tailHex.join("").length / 2}`);
