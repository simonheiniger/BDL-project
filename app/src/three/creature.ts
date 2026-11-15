// Prozeduraler Kreaturen-Generator im Monster-Sammel-Stil (Three.js):
// glatte Formen + Toon-Shading + Konturen (Inverted Hull), Chibi-Proportionen, Anime-Augen,
// Element-Merkmale. Alles deterministisch aus der on-chain DNA -> gleiche DNA = gleiches Tier.
import * as THREE from "three";
import type { Look } from "./dna";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (hex: string) => new THREE.Color(hex);

// ------------------------------------------------------------------ Zufall

export function rng(seed: bigint) {
  let a = Number(seed & 0xffffffffn) ^ Number((seed >> 32n) & 0xffffffffn) ^ 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ Typen & Farben

/** Element-Typ aus dem Farb-Gen (Index wie on-chain Palette) */
export const ELEMENTS = ["Normal", "Gestein", "Feuer", "Pflanze", "Psycho", "Eis", "Wasser", "Magma", "Kosmos", "Elektro"] as const;

type Fur = { base: string; light: string; dark: string; accent: string };
export const FUR: Fur[] = [
  { base: "#c98b55", light: "#f6e3c6", dark: "#7a4a26", accent: "#fff3df" }, // Normal (Karamell)
  { base: "#8d93a6", light: "#d9dde8", dark: "#4b5063", accent: "#b9a58a" }, // Gestein (Schiefer)
  { base: "#f07a3c", light: "#ffe0b8", dark: "#a8431c", accent: "#ffcc33" }, // Feuer
  { base: "#58b98a", light: "#d8f3c4", dark: "#2d7a57", accent: "#8ddc5a" }, // Pflanze
  { base: "#a98ae6", light: "#f0e6ff", dark: "#6a4fb0", accent: "#ff7ad9" }, // Psycho
  { base: "#7cc4ef", light: "#ecfaff", dark: "#3c84b8", accent: "#bff4ff" }, // Eis
  { base: "#3fb5c9", light: "#d4f7f5", dark: "#1f7590", accent: "#8fe9ff" }, // Wasser
  { base: "#4a2f35", light: "#ffb07a", dark: "#24161a", accent: "#ff6a1f" }, // Magma
  { base: "#3d2f8f", light: "#b9a8ff", dark: "#1c1452", accent: "#ffe27a" }, // Kosmos
  { base: "#ffd23f", light: "#fff6c9", dark: "#c99a12", accent: "#ffffff" }, // Elektro (Gold)
];

// ------------------------------------------------------------------ Materialien

let gradient: THREE.DataTexture | null = null;
/** 3 harte Lichtstufen -> Anime/Toon-Look */
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

function toon(color: string | THREE.Color, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

function glow(color: string, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** Kontur per "Inverted Hull": Rueckseiten-Kopie, entlang der Normalen aufgeblasen (wie in Anime-Spielen) */
let outlineMat: THREE.MeshBasicMaterial | null = null;
export function outlineMaterial() {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: "#241a2e", side: THREE.BackSide });
    outlineMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "vec3 transformed = position + normalize(normal) * 0.014;",
      );
    };
  }
  return outlineMat;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos?: THREE.Vector3) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (pos) m.position.copy(pos);
  if (mat instanceof THREE.MeshToonMaterial) m.add(new THREE.Mesh(geo, outlineMaterial()));
  parent.add(m);
  return m;
}

const sphere = (r: [number, number, number], seg = 32) => {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  g.scale(...r);
  return g;
};

/** Vertex-Farben: Funktion (Position) -> Farbe, fuer Bauch/Muster mit klaren Kanten */
function paint(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => THREE.Color) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const p = V();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p).toArray(col, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Rohr entlang einer Kurve, von r0 auf r1 verjuengt (Schwaenze, Hoerner) */
function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 24, radial = 12) {
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  const p = V();
  for (let i = 0; i <= seg; i++) {
    const c = curve.getPointAt(i / seg);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ Gesicht (Canvas-Texturen)

const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, draw: (g: CanvasRenderingContext2D) => void) {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    draw(c.getContext("2d")!);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

const IRIS = ["#5a3a1e", "#5a3a1e", "#5a3a1e", "#16b8d8", "#ff3d7f", "#ffb400"];

/** Anime-Auge: grosse Iris, Pupille, zwei Glanzlichter, kraeftige Oberlid-Linie */
function eyeTexture(kind: number, closed: boolean, mirror: boolean) {
  return canvasTex(`eye-${kind}-${closed}-${mirror}`, (g) => {
    g.translate(mirror ? 256 : 0, 0);
    g.scale(mirror ? -1 : 1, 1);
    g.lineCap = "round";
    if (closed) {
      g.strokeStyle = "#1a1220";
      g.lineWidth = 22;
      g.beginPath();
      g.moveTo(40, 150);
      g.quadraticCurveTo(128, 70, 216, 150);
      g.stroke();
      return;
    }
    // Sklera
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(128, 136, 92, 108, 0, 0, Math.PI * 2);
    g.fill();
    // Iris mit Verlauf
    const grad = g.createLinearGradient(0, 40, 0, 230);
    grad.addColorStop(0, "#120b14");
    grad.addColorStop(0.55, IRIS[kind]);
    grad.addColorStop(1, new THREE.Color(IRIS[kind]).offsetHSL(0, 0, 0.25).getStyle());
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(132, 146, 70, 88, 0, 0, Math.PI * 2);
    g.fill();
    // Pupille / Sonderformen
    g.fillStyle = "#0b070d";
    if (kind === 4) {
      heart(g, 132, 150, 40, "#7a0026");
    } else if (kind === 5) {
      star(g, 132, 150, 42, "#7a4a00");
    } else {
      g.beginPath();
      g.ellipse(134, 152, 34, 46, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Glanzlichter
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(160, 100, 26, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(100, 196, 12, 13, 0, 0, Math.PI * 2);
    g.fill();
    if (kind === 3) star(g, 96, 112, 16, "#ffffff");
    // Oberlid (leicht schraeg -> selbstbewusster Blick); schlaefrig = halb geschlossen
    g.fillStyle = "#1a1220";
    g.beginPath();
    if (kind === 1) {
      g.rect(0, 0, 256, 130);
    } else {
      g.moveTo(20, 96);
      g.quadraticCurveTo(110, 8, 236, 52);
      g.lineTo(236, 30);
      g.quadraticCurveTo(110, -14, 20, 76);
    }
    g.fill();
    // auf Augenform zuschneiden
    g.globalCompositeOperation = "destination-in";
    g.beginPath();
    g.ellipse(128, 136, 96, 112, 0, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";
    if (kind === 1) {
      g.strokeStyle = "#1a1220";
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(36, 132);
      g.lineTo(220, 132);
      g.stroke();
    }
  });
}

function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x, y + s * 0.8);
  g.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.6, y - s * 1.2, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.6, y - s * 1.2, x + s * 1.4, y - s * 0.2, x, y + s * 0.8);
  g.fill();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  g.fillStyle = fill;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}

/** Mund: Laecheln mit Fangzahn, Katzenmund, staunend, frech mit Zunge */
function mouthTexture(kind: number, wide: boolean) {
  return canvasTex(`mouth-${kind}-${wide}`, (g) => {
    g.strokeStyle = "#1a1220";
    g.lineWidth = 14;
    g.lineCap = g.lineJoin = "round";
    if (wide) {
      g.fillStyle = "#3a1020";
      g.beginPath();
      g.moveTo(20, 90);
      g.quadraticCurveTo(128, 210, 236, 90);
      g.quadraticCurveTo(128, 140, 20, 90);
      g.fill();
      g.stroke();
      return;
    }
    if (kind === 2) {
      g.fillStyle = "#3a1020";
      g.beginPath();
      g.ellipse(128, 128, 34, 42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ff7a9a";
      g.beginPath();
      g.ellipse(128, 150, 22, 14, 0, 0, Math.PI * 2);
      g.fill();
      return;
    }
    g.beginPath();
    if (kind === 1) {
      g.moveTo(70, 110);
      g.quadraticCurveTo(99, 150, 128, 112);
      g.quadraticCurveTo(157, 150, 186, 110);
    } else {
      g.moveTo(66, 108);
      g.quadraticCurveTo(128, 170, 190, 108);
    }
    g.stroke();
    if (kind === 3) {
      g.fillStyle = "#ff7a9a";
      g.beginPath();
      g.ellipse(150, 150, 20, 22, 0.3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else if (kind === 0) {
      // Fangzahn
      g.fillStyle = "#ffffff";
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(150, 128);
      g.lineTo(162, 160);
      g.lineTo(172, 122);
      g.fill();
      g.stroke();
    }
  });
}

/** Leicht gewoelbte Flaeche, die der Kopfrundung folgt (fuer Augen/Mund) */
function decal(tex: THREE.Texture, w: number, h: number, bend: number) {
  const g = new THREE.PlaneGeometry(w, h, 8, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -bend * ((p.getX(i) / w) ** 2 + (p.getY(i) / h) ** 2));
  g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  m.userData.outlineParameters = { visible: false };
  return new THREE.Mesh(g, m);
}

// ------------------------------------------------------------------ Aufbau

export type Creature = { group: THREE.Group; update: (t: number) => void };

type Ctx = {
  look: Look;
  fur: Fur;
  rnd: () => number;
  body: THREE.MeshToonMaterial; // Fell mit Vertex-Farben
  plain: THREE.MeshToonMaterial; // Fell einfarbig
  light: THREE.MeshToonMaterial;
  dark: THREE.MeshToonMaterial;
  anims: ((t: number) => void)[];
};

/** Spezies-Index (wie on-chain): 0 Katze, 1 Fuchs, 2 Hase, 3 Baer, 4 Frosch, 5 Drache, 6 Giraffe, 7 Elefant,
 *  8 Nashorn, 9 Krokodil, 10 Pinguin, 11 Eule, 12 Schildkroete, 13 Loewe, 14 Wolf */
type Spec = {
  head: Vec3T;
  body: Vec3T;
  leg: number;
  snout: number; // 0 = Sonderform (Ruessel, Schnabel, Krokodilmaul) oder keine
  snoutLen: number;
  legR?: number;
  neck?: number; // Giraffe
  upright?: boolean; // Pinguin, Eule
  low?: boolean; // Krokodil
};
type Vec3T = [number, number, number];

const SPEC: Spec[] = [
  { head: [0.56, 0.44, 0.44], body: [0.34, 0.32, 0.46], leg: 0.18, snout: 0.09, snoutLen: 0.7 }, // Katze: rund, Stupsnase
  { head: [0.42, 0.4, 0.44], body: [0.32, 0.29, 0.52], leg: 0.22, snout: 0.14, snoutLen: 2.6, legR: 0.075 }, // Fuchs: schmal, spitze Schnauze
  { head: [0.5, 0.48, 0.46], body: [0.36, 0.36, 0.44], leg: 0.13, snout: 0.13, snoutLen: 0.8 }, // Hase
  { head: [0.55, 0.5, 0.5], body: [0.46, 0.42, 0.55], leg: 0.17, snout: 0.19, snoutLen: 1.1 }, // Baer
  { head: [0.62, 0.42, 0.5], body: [0.46, 0.32, 0.48], leg: 0.12, snout: 0, snoutLen: 0 }, // Frosch
  { head: [0.48, 0.44, 0.5], body: [0.38, 0.35, 0.55], leg: 0.2, snout: 0.17, snoutLen: 1.4 }, // Drache
  { head: [0.38, 0.36, 0.42], body: [0.34, 0.32, 0.46], leg: 0.42, snout: 0.15, snoutLen: 1.4, legR: 0.075, neck: 0.62 }, // Giraffe
  { head: [0.56, 0.5, 0.5], body: [0.52, 0.46, 0.6], leg: 0.24, snout: 0, snoutLen: 0, legR: 0.17 }, // Elefant
  { head: [0.46, 0.4, 0.5], body: [0.5, 0.42, 0.62], leg: 0.2, snout: 0.21, snoutLen: 1.5, legR: 0.16 }, // Nashorn
  { head: [0.4, 0.24, 0.4], body: [0.42, 0.24, 0.7], leg: 0.11, snout: 0, snoutLen: 0, legR: 0.1, low: true }, // Krokodil
  { head: [0.42, 0.4, 0.4], body: [0.42, 0.52, 0.38], leg: 0, snout: 0, snoutLen: 0, upright: true }, // Pinguin
  { head: [0.52, 0.46, 0.44], body: [0.44, 0.46, 0.4], leg: 0, snout: 0, snoutLen: 0, upright: true }, // Eule
  { head: [0.34, 0.31, 0.36], body: [0.5, 0.3, 0.58], leg: 0.12, snout: 0.1, snoutLen: 0.8, legR: 0.12 }, // Schildkroete
  { head: [0.5, 0.46, 0.46], body: [0.42, 0.36, 0.56], leg: 0.22, snout: 0.17, snoutLen: 1.0 }, // Loewe
  { head: [0.48, 0.44, 0.48], body: [0.42, 0.38, 0.62], leg: 0.27, snout: 0.17, snoutLen: 2.2, legR: 0.1 }, // Wolf: gross, lange breite Schnauze
];

/** Augen sitzen oben auf Huegeln (Frosch- und Krokodil-"Ohren"-Gen) */
const bumpEyes = (ears: number) => ears === 4 || ears === 9;

export function buildCreature(look: Look, dna: bigint, opts: { generation: number; item: number }): Creature {
  const rnd = rng(dna);
  const fur = FUR[look.palette];
  const group = new THREE.Group();
  const anims: ((t: number) => void)[] = [];
  const ctx: Ctx = {
    look,
    fur,
    rnd,
    body: toon("#ffffff", { vertexColors: true }),
    plain: toon(fur.base),
    light: toon(fur.light),
    dark: toon(fur.dark),
    anims,
  };
  if (look.palette === 8) for (const m of [ctx.body, ctx.plain]) Object.assign(m, { emissive: C("#2a1a7a"), emissiveIntensity: 0.6 });
  if (look.palette === 7) for (const m of [ctx.body, ctx.plain]) Object.assign(m, { emissive: C("#5a1a08"), emissiveIntensity: 0.5 });

  if (look.stage === 0) return buildEgg(ctx, group, dna, opts.generation);

  const S = look.species;
  const sp = SPEC[S];
  const baby = look.stage === 1;
  const frog = S === 4;
  const hs = baby ? 1.12 : 1; // Babys: relativ groesserer Kopf
  const H = sp.head.map((x) => x * hs) as Vec3T;
  const B = [...sp.body] as Vec3T;
  const legH = baby ? sp.leg * 0.7 : sp.leg;
  const neckLen = (sp.neck ?? 0) * (baby ? 0.6 : 1);

  const bellyLight = C(fur.light);
  const base = C(fur.base);
  const dark = C(fur.dark);
  const noise = (p: THREE.Vector3) => {
    const s = Math.sin(p.x * 31.7 + p.y * 17.3 + p.z * 23.1) * 4375.5;
    return s - Math.floor(s);
  };
  /** Giraffen-Flecken: grosse, unregelmaessige Platten */
  const giraffeSpot = (p: THREE.Vector3) => Math.sin(p.x * 13 + Math.sin(p.y * 9) * 2) * Math.sin(p.z * 11 + p.y * 7) > 0.15;

  // ---- Rumpf (z = vorne)
  const bodyY = sp.upright ? B[1] + 0.04 : legH + B[1] * 0.85;
  const torso = new THREE.Group();
  torso.position.set(0, bodyY, sp.upright ? 0 : -0.12);
  group.add(torso);
  const bodyGeo = paint(sphere(B), (p) => {
    if (S === 10 && p.z > -B[2] * 0.1 && Math.abs(p.x) < B[0] * 0.7) return bellyLight; // Pinguin: weisser Bauch
    if (S === 11 && p.z > 0 && Math.abs(p.x) < B[0] * 0.65 && p.y < B[1] * 0.5) {
      return Math.sin(p.y * 40) > 0.6 ? dark.clone().lerp(bellyLight, 0.5) : bellyLight; // Eule: Brustfedern
    }
    if (S === 6 && giraffeSpot(p)) return dark.clone().lerp(base, 0.25);
    if (!sp.upright && p.y < -B[1] * 0.25 && p.z > -B[2] * 0.6) return bellyLight; // Bauch
    if (look.pattern === 2 && Math.sin(p.x * 22) * Math.sin(p.z * 18) > 0.55 && p.y > 0) return dark; // Flecken
    if (look.pattern === 3 && p.y > B[1] * 0.2 && Math.sin(p.z * 26) > 0.4) return dark; // Streifen
    if (look.pattern === 4 && p.z > B[2] * 0.55 && p.y < B[1] * 0.4) return bellyLight; // Brustfleck
    return base;
  });
  mesh(torso, bodyGeo, ctx.body);
  anims.push((t) => torso.scale.set(1 + Math.sin(t * 2.2) * 0.02, 1 + Math.sin(t * 2.2) * 0.03, 1));

  // ---- Beine / Fuesse
  if (sp.upright) {
    const orange = toon("#f2a33a");
    for (const side of [-1, 1]) mesh(group, sphere([0.1, 0.035, 0.15], 20), orange, V(side * 0.14, 0.035, 0.12));
  } else {
    for (const [lz, back] of [
      [B[2] * 0.5, false],
      [-B[2] * 0.55, true],
    ] as const) {
      for (const side of [-1, 1]) {
        const leg = new THREE.Group();
        const spread = sp.low ? 0.95 : frog && back ? 0.95 : 0.55;
        leg.position.set(side * B[0] * spread, legH + 0.06, torso.position.z + lz);
        if (sp.low) leg.rotation.z = side * 0.5;
        group.add(leg);
        const r = frog && back ? 0.13 : sp.legR ?? B[0] * 0.32;
        const legGeo = paint(new THREE.CapsuleGeometry(r, legH, 6, 16), (p) => {
          if (S === 6 && giraffeSpot(p.clone().multiplyScalar(2))) return dark.clone().lerp(base, 0.25);
          if (S === 1 && p.y < 0) return C("#2a1c18"); // Fuchs: dunkle "Socken"
          return base;
        });
        mesh(leg, legGeo, ctx.body, V(0, -legH / 2, 0));
        const pawCol = S === 7 || S === 8 ? ctx.dark : S === 6 || S === 1 ? toon("#2a1c18") : ctx.light;
        const paw = mesh(leg, sphere([r * 1.15, r * 0.6, r * 1.35], 20), pawCol, V(0, -legH - 0.02, r * 0.35));
        paw.receiveShadow = true;
      }
    }
  }

  // ---- Panzer (Schildkroete)
  if (S === 12) {
    const shell = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    shell.scale(B[0] * 1.18, B[1] * 1.6, B[2] * 1.12);
    const shellBase = C(fur.dark).lerp(C("#5b7a3a"), 0.4);
    paint(shell, (p) => {
      const cell = Math.sin(p.x * 16) * Math.sin(p.z * 14) > 0.2;
      return cell ? shellBase.clone().offsetHSL(0, 0, 0.12) : shellBase;
    });
    mesh(torso, shell, toon("#ffffff", { vertexColors: true }), V(0, -B[1] * 0.15, 0));
    mesh(torso, new THREE.TorusGeometry(B[0] * 1.15, 0.035, 8, 48), toon(fur.light), V(0, -B[1] * 0.15, 0)).scale.set(1, (B[2] * 1.1) / (B[0] * 1.15), 1);
    torso.children.at(-1)!.rotation.x = Math.PI / 2;
  }

  // ---- Kopf (+ Hals)
  const head = new THREE.Group();
  let headY = bodyY + B[1] * 0.55 + H[1] * 0.75;
  let headZ = B[2] * 0.42;
  if (sp.upright) {
    headY = bodyY + B[1] * (S === 11 ? 0.55 : 0.72) + H[1] * 0.55;
    headZ = 0.03;
  } else if (sp.low) {
    headY = bodyY + 0.04;
    headZ = torso.position.z + B[2] * 0.82 + H[2] * 0.35;
  } else if (S === 12) {
    headY = bodyY + 0.02;
    headZ = torso.position.z + B[2] * 0.95 + H[2] * 0.3;
  } else if (neckLen) {
    headY = bodyY + B[1] * 0.4 + neckLen + H[1] * 0.4;
    headZ = B[2] * 0.62;
  }
  head.position.set(0, headY, headZ);
  group.add(head);
  if (neckLen) {
    // Giraffenhals mit Flecken + kurzer Maehne
    const from = V(0, bodyY + B[1] * 0.25, torso.position.z + B[2] * 0.55);
    const to = V(0, headY - H[1] * 0.3, headZ - 0.05);
    const curve = new THREE.LineCurve3(from, to);
    const neckGeo = paint(taperTube(curve, 0.15, 0.11, 8, 16), (p) => (giraffeSpot(p) ? dark.clone().lerp(base, 0.25) : base));
    mesh(group, neckGeo, ctx.body);
    const mane = taperTube(new THREE.LineCurve3(from.clone().add(V(0, 0.08, -0.12)), to.clone().add(V(0, 0.06, -0.1))), 0.035, 0.03, 4, 6);
    mesh(group, mane, toon("#5a3a22"));
  } else if (S === 12) {
    mesh(group, taperTube(new THREE.LineCurve3(V(0, bodyY, torso.position.z + B[2] * 0.7), V(0, headY - 0.02, headZ - 0.08)), 0.11, 0.1, 4, 12), ctx.plain);
  }
  const headGeo = paint(sphere(H, 40), (p) => {
    if (frog && p.y < -H[1] * 0.25 && p.z > 0) return bellyLight; // Froschkehle
    if (S === 1 && p.y < -H[1] * 0.05 && p.z > -H[2] * 0.2) return C("#fbf7ef"); // Fuchs: weisse Wangen + Kehle
    if (S === 14 && p.z > H[2] * 0.2 && (p.y < -H[1] * 0.1 || (p.y > H[1] * 0.12 && p.y < H[1] * 0.3 && Math.abs(p.x) > H[0] * 0.2 && Math.abs(p.x) < H[0] * 0.55)))
      return C("#f4f1ea"); // Wolf: weisse Maske + "Augenbrauen" wie ein Husky
    if (S === 0 && p.z > H[2] * 0.35 && p.y < -H[1] * 0.15) return bellyLight; // Katze: helle Schnauzenpartie
    if (S === 10 && (p.z < H[2] * 0.15 || p.y > H[1] * 0.45)) return dark.clone().lerp(C("#1c1c2a"), 0.6); // Pinguin-Kappe
    if (S === 6 && p.y > 0 && giraffeSpot(p.clone().multiplyScalar(1.6))) return dark.clone().lerp(base, 0.3);
    if (look.pattern === 3 && p.y > H[1] * 0.45 && Math.sin(p.x * 30) > 0.3) return dark; // Stirnstreifen
    return base;
  });
  mesh(head, headGeo, ctx.body);
  if (S === 1 || S === 14) {
    // Wangenbueschel (Fuchs weiss, Wolf in Fellfarbe)
    for (const side of [-1, 1]) {
      const tuft = new THREE.ConeGeometry(0.1, 0.24, 16);
      tuft.rotateZ((side * -Math.PI) / 2.2);
      mesh(head, tuft, toon("#fbf7ef"), V(side * H[0] * 0.98, -H[1] * 0.28, H[2] * 0.15));
    }
  }
  if (S === 14) {
    // Wolf: dichter weisser Brustpelz (Zotteln nach unten) + Nackenkragen
    const white = toon("#f4f1ea");
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 6 - row; i++) {
        const x = (i - (5 - row) / 2) * 0.1;
        const tuft = new THREE.ConeGeometry(0.075, 0.26, 10);
        tuft.rotateX(Math.PI + 0.35);
        mesh(group, tuft, white, V(x, headY - H[1] * (0.85 + row * 0.22), headZ + H[2] * 0.45 - Math.abs(x) * 0.6 - row * 0.05));
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (0.15 + (i / 7) * 0.7);
      const tuft = new THREE.ConeGeometry(0.1, 0.28, 10);
      const m = mesh(group, tuft, ctx.plain, V(Math.cos(a) * H[0] * 0.95, headY - H[1] * 0.45 + Math.sin(a) * 0.05, headZ - H[2] * 0.35));
      m.rotation.set(-0.5, 0, Math.cos(a) * -1.4);
    }
  }
  if (S === 0) {
    // Katze: Schnurrhaare
    const wh = toon("#2a1a22");
    for (const side of [-1, 1]) {
      for (const k of [-1, 0, 1]) {
        const w = new THREE.CylinderGeometry(0.006, 0.006, 0.34, 4);
        w.rotateZ(Math.PI / 2 + side * k * 0.18);
        mesh(head, w, wh, V(side * H[0] * 0.55, -H[1] * 0.3 + k * 0.04, H[2] * 0.75));
      }
    }
  }
  if (S === 13) {
    // Loewenmaehne: Kranz aus Zotteln hinter dem Kopf
    const maneMat = toon(C(fur.dark).lerp(C("#8a4a1c"), 0.5));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const tuft = new THREE.ConeGeometry(0.13, 0.32, 12);
      const m = mesh(head, tuft, maneMat, V(Math.cos(a) * H[0] * 0.92, Math.sin(a) * H[1] * 0.92, -H[2] * 0.25));
      m.rotation.z = a - Math.PI / 2;
      m.rotation.x = -0.35;
    }
    mesh(head, sphere([H[0] * 1.02, H[1] * 1.02, H[2] * 0.6], 32), maneMat, V(0, 0, -H[2] * 0.35));
  }
  if (S === 11) {
    // Eulen-Gesichtsscheibe
    for (const side of [-1, 1]) {
      const disc = mesh(head, sphere([0.2, 0.22, 0.05], 28), ctx.light, V(side * H[0] * 0.36, H[1] * 0.08, H[2] * 0.82));
      disc.rotation.y = side * 0.4;
    }
  }

  // ---- Schnauze / Sonderformen
  const faceZ = H[2] * 0.93;
  /** z-Koordinate der Kopfoberflaeche (Ellipsoid) an Stelle (x, y) -> Gesicht sitzt genau darauf */
  const surfZ = (x: number, y: number) => H[2] * Math.sqrt(Math.max(0, 1 - (x / H[0]) ** 2 - (y / H[1]) ** 2));
  let mouthY = -H[1] * 0.58;
  let mouthZ = surfZ(0, mouthY) + 0.01;
  let showMouth = true;
  if (S === 1 || S === 14) {
    // spitze Hundeschnauze (Fuchs schmal/lang, Wolf breiter)
    const sn = sp.snout;
    const len = sn * sp.snoutLen;
    const cone = new THREE.CylinderGeometry(sn * (S === 1 ? 0.35 : 0.6), sn * 1.15, len, 20, 1);
    cone.rotateX(Math.PI / 2);
    cone.scale(1, 0.8, 1);
    const muzzleMat = S === 1 ? toon("#fbf7ef") : ctx.light;
    const mz0 = faceZ - sn * 0.2 + len / 2;
    mesh(head, cone, muzzleMat, V(0, -H[1] * 0.3, mz0));
    mesh(head, sphere([sn * 0.32, sn * 0.25, sn * 0.25], 16), toon("#1a1216"), V(0, -H[1] * 0.3 + sn * 0.2, mz0 + len / 2));
    mouthY = -H[1] * 0.55;
    mouthZ = surfZ(0, mouthY) + 0.02;
  } else if (sp.snout > 0) {
    const sn = sp.snout;
    const g = sphere([sn * 1.15, sn * 0.8, sn * sp.snoutLen]);
    const lightSnout = S === 3 || S === 6 || S === 13 || S === 0;
    const snout = mesh(head, g, lightSnout ? ctx.light : ctx.plain, V(0, -H[1] * 0.28, faceZ - sn * 0.35));
    const nose = mesh(head, sphere([sn * 0.32, sn * 0.22, sn * 0.22], 16), toon(S === 0 ? "#e98a9e" : "#2a1a22"));
    nose.position.set(0, snout.position.y + sn * 0.5, snout.position.z + sn * sp.snoutLen * 0.95);
    mouthZ = Math.max(mouthZ, faceZ - sn * 0.35 + sn * 0.55);
    if (S === 8) {
      // Nashorn: grosses + kleines Horn
      const ivory = toon("#efe6d0");
      const horn = new THREE.ConeGeometry(0.1, 0.34, 20);
      const h1 = mesh(head, horn, ivory, snout.position.clone().add(V(0, sn * 0.75 + 0.12, sn * sp.snoutLen * 0.55)));
      h1.rotation.x = -0.35;
      const h2 = mesh(head, new THREE.ConeGeometry(0.06, 0.16, 16), ivory, snout.position.clone().add(V(0, sn * 0.7 + 0.05, -0.02)));
      h2.rotation.x = -0.3;
    }
  } else if (S === 7) {
    // Elefant: Ruessel + Stosszaehne
    const trunk = new THREE.CatmullRomCurve3([V(0, -H[1] * 0.2, faceZ - 0.05), V(0, -H[1] * 0.55, faceZ + 0.12), V(0, -H[1] * 0.95, faceZ + 0.18), V(0, -H[1] * 1.05, faceZ + 0.32)]);
    mesh(head, taperTube(trunk, 0.13, 0.07, 24, 16), ctx.plain);
    for (const side of [-1, 1]) {
      const tusk = new THREE.ConeGeometry(0.035, 0.22, 12);
      const tm = mesh(head, tusk, toon("#fbf6e8"), V(side * 0.14, -H[1] * 0.55, faceZ - 0.02));
      tm.rotation.set(1.9, 0, side * -0.25);
    }
    mouthY = -H[1] * 0.62;
    mouthZ = surfZ(0.12, mouthY);
    showMouth = false;
  } else if (S === 9) {
    // Krokodil: langes flaches Maul mit Zaehnen
    const jaw = sphere([0.26, 0.11, 0.42], 32);
    const jm = mesh(head, jaw, ctx.plain, V(0, -H[1] * 0.35, H[2] * 0.85));
    const teeth = toon("#ffffff");
    for (let i = 0; i < 6; i++) {
      for (const side of [-1, 1]) {
        const tooth = new THREE.ConeGeometry(0.02, 0.06, 6);
        tooth.rotateX(Math.PI);
        mesh(head, tooth, teeth, V(side * 0.22 * Math.sqrt(1 - ((i - 2.5) / 3.2) ** 2), jm.position.y - 0.08, jm.position.z - 0.25 + i * 0.1));
      }
    }
    for (const side of [-1, 1]) mesh(head, sphere([0.025, 0.02, 0.02], 10), toon("#2a1a22"), V(side * 0.07, jm.position.y + 0.1, jm.position.z + 0.38));
    showMouth = false;
  } else if (S === 10 || S === 11) {
    // Schnabel
    const beak = new THREE.ConeGeometry(S === 10 ? 0.08 : 0.06, S === 10 ? 0.2 : 0.14, 16);
    beak.rotateX(S === 10 ? Math.PI / 2 : Math.PI * 0.7);
    mesh(head, beak, toon(S === 10 ? "#f2a33a" : "#e3b23c"), V(0, S === 10 ? -H[1] * 0.12 : -H[1] * 0.12, faceZ + 0.06));
    showMouth = false;
  }
  if (showMouth) {
    const mouth = decal(mouthTexture(look.mouth, frog), frog ? 0.62 : 0.2, frog ? 0.3 : 0.17, 0.05);
    const my = frog ? -H[1] * 0.22 : mouthY;
    mouth.position.set(0, my, frog ? surfZ(0, my) + 0.012 : mouthZ);
    mouth.rotation.x = frog ? -0.35 : -0.55;
    head.add(mouth);
  }

  // ---- Augen (bei Frosch-/Krokodil-Ohren-Gen oben auf Huegeln)
  const frogEyes = bumpEyes(look.ears);
  const eyeAnchors: THREE.Object3D[] = [];
  const eyeScale = S === 11 ? 1.25 : 1;
  for (const side of [-1, 1]) {
    const closed = look.eyes === 2 && side === 1;
    const eye = decal(eyeTexture(look.eyes, closed, side === 1), 0.27 * eyeScale, 0.31 * eyeScale, 0.05);
    if (frogEyes) {
      const bump = look.ears === 9 ? 0.12 : 0.17;
      mesh(head, sphere([bump, bump, bump], 24), ctx.plain, V(side * H[0] * 0.5, H[1] * 0.85, H[2] * 0.25));
      eye.scale.setScalar(bump / 0.17);
      eye.position.set(side * H[0] * 0.5, H[1] * 0.85 + bump * 0.3, H[2] * 0.25 + bump * 0.94);
    } else {
      const ex = side * H[0] * 0.36;
      const ey = H[1] * 0.1;
      eye.position.set(ex, ey, surfZ(ex, ey) + (S === 11 ? 0.06 : 0.012));
      eye.rotation.set(-0.08, side * 0.4, 0);
    }
    head.add(eye);
    eyeAnchors.push(eye);
    const blink = eye.scale;
    const by = blink.y;
    if (!closed) anims.push((t) => (blink.y = Math.sin(t * 0.8 + 2) > 0.985 ? by * 0.12 : by));
  }
  // Wangenroete
  if (!sp.low) {
    for (const side of [-1, 1]) {
      const blush = mesh(head, sphere([0.08, 0.045, 0.02], 16), glow("#ff7a9a", 0.55));
      blush.position.set(side * H[0] * 0.62, -H[1] * 0.3, H[2] * 0.72);
      blush.rotation.y = side * 0.6;
    }
  }

  // ---- Fluegel/Flossen der aufrechten Arten
  if (sp.upright) {
    for (const side of [-1, 1]) {
      const fl = new THREE.Group();
      fl.position.set(side * B[0] * 0.92, B[1] * 0.35, 0);
      torso.add(fl);
      const g = S === 10 ? sphere([0.06, 0.32, 0.16], 24) : sphere([0.1, 0.36, 0.24], 24);
      mesh(fl, g, S === 10 ? toon(C(fur.dark).lerp(C("#1c1c2a"), 0.6)) : ctx.dark, V(0, -0.22, 0));
      fl.rotation.z = side * 0.18;
      anims.push((t) => (fl.rotation.z = side * (0.18 + Math.max(0, Math.sin(t * 1.3 + side)) * (S === 10 ? 0.25 : 0.06))));
    }
  }

  buildEars(ctx, head, H);
  anims.push((t) => {
    head.rotation.y = Math.sin(t * 0.6) * 0.16;
    head.rotation.z = Math.sin(t * 0.9) * 0.05;
    head.position.y = headY + Math.sin(t * 2.2) * 0.012;
  });

  // ---- Schwanz
  const tailRoot = new THREE.Group();
  if (sp.upright) tailRoot.position.set(0, 0.14, -B[2] * 0.9);
  else tailRoot.position.set(0, bodyY + (sp.low ? 0 : B[1] * 0.2), torso.position.z - B[2] * 0.9);
  group.add(tailRoot);
  buildTail(ctx, tailRoot, look.tail, Math.max(0.8, B[1] / 0.33));

  // ---- Krokodil-Rueckenplatten
  if (S === 9) {
    for (let i = 0; i < 6; i++) {
      for (const side of [-1, 1]) {
        const sc = new THREE.ConeGeometry(0.035, 0.07, 4);
        mesh(torso, sc, ctx.dark, V(side * 0.09, B[1] * 0.95, B[2] * (0.55 - i * 0.2)));
      }
    }
  }

  // ---- Element-Merkmale + Extras
  buildElement(ctx, { head, H, torso, B, tailRoot, baby });
  if (S === 5 && opts.item !== 5) buildWings(ctx, torso, B, "bat");
  if (opts.generation > 1) {
    const gem = mesh(head, new THREE.OctahedronGeometry(0.06, 0), toon("#7df9ff", { emissive: C("#2fd6ff"), emissiveIntensity: 0.7 }));
    gem.position.set(0, H[1] * 0.55, H[2] * 0.82);
    gem.scale.set(0.7, 1.1, 0.5);
  }
  addCosmetic(ctx, opts.item, { head, H, torso, B, group, eyes: eyeAnchors, frogEyes });

  if (baby) group.scale.setScalar(0.8);
  return { group, update: (t) => anims.forEach((a) => a(t)) };
}

// ------------------------------------------------------------------ Ohren

function buildEars(ctx: Ctx, head: THREE.Group, H: Vec3T) {
  const { look, fur } = ctx;
  const inner = toon(C(fur.light).lerp(C("#ff9fb5"), 0.45));
  const sp = look.ears;
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    head.add(ear);
    if (sp === 0 || sp === 1 || sp === 8 || sp === 14) {
      // spitze Ohren: Katze (klein), Fuchs (riesig, dunkle Rueckseite), Nashorn (schmal), Wolf (aufrecht)
      const big = sp === 1 ? 1.55 : sp === 8 ? 0.75 : sp === 14 ? 1.1 : 0.85;
      ear.position.set(side * H[0] * 0.55, H[1] * 0.7, -H[2] * 0.05);
      ear.rotation.set(-0.15, side * -0.25, side * -0.35);
      const outer = new THREE.ConeGeometry(0.17 * big * (sp === 8 ? 0.7 : sp === 1 ? 0.8 : 1), 0.38 * big, 20);
      outer.scale(1, 1, 0.55);
      const backDark = sp === 1 || sp === 14;
      paint(outer, (p) => (backDark && (p.z < -0.01 || p.y > 0.1 * big) ? C(sp === 1 ? "#2a1c18" : fur.dark) : C(fur.base)));
      mesh(ear, outer, toon("#ffffff", { vertexColors: true }), V(0, 0.17 * big, 0));
      const inn = new THREE.ConeGeometry(0.1 * big * (sp === 8 ? 0.7 : 1), 0.26 * big, 20);
      inn.scale(1, 1, 0.3);
      mesh(ear, inn, inner, V(0, 0.13 * big, 0.06));

      ctx.anims.push((t) => (ear.rotation.z = side * (-0.35 - Math.max(0, Math.sin(t * 0.7 + side * 2) - 0.93) * 4)));
    } else if (sp === 2) {
      ear.position.set(side * H[0] * 0.32, H[1] * 0.8, -H[2] * 0.1);
      ear.rotation.set(-0.2, 0, side * -0.18);
      const outer = new THREE.CapsuleGeometry(0.085, 0.5, 8, 16);
      outer.scale(1, 1, 0.55);
      mesh(ear, outer, ctx.plain, V(0, 0.32, 0));
      const inn = new THREE.CapsuleGeometry(0.05, 0.4, 8, 16);
      inn.scale(1, 1, 0.4);
      mesh(ear, inn, inner, V(0, 0.32, 0.035));
      ctx.anims.push((t) => (ear.rotation.x = -0.2 + Math.sin(t * 1.2 + side) * 0.07));
    } else if (sp === 3 || sp === 13) {
      const r = sp === 13 ? 0.1 : 0.13;
      ear.position.set(side * H[0] * 0.66, H[1] * 0.72, -H[2] * 0.05);
      mesh(ear, sphere([r, r, r * 0.55], 24), ctx.plain);
      mesh(ear, sphere([r * 0.58, r * 0.58, r * 0.3], 20), inner, V(0, 0, r * 0.3));
    } else if (sp === 5) {
      // Drachenhoerner
      const curve = new THREE.QuadraticBezierCurve3(V(0, 0, 0), V(side * 0.05, 0.22, -0.08), V(side * 0.12, 0.34, -0.26));
      ear.position.set(side * H[0] * 0.42, H[1] * 0.78, -H[2] * 0.05);
      mesh(ear, taperTube(curve, 0.075, 0.012, 16, 12), toon("#f3e6c8"));
    } else if (sp === 6) {
      // Giraffe: Hoernchen (Ossikone) + seitliche Ohren
      ear.position.set(side * H[0] * 0.3, H[1] * 0.85, -H[2] * 0.1);
      mesh(ear, new THREE.CylinderGeometry(0.03, 0.04, 0.2, 12), ctx.plain, V(0, 0.1, 0));
      mesh(ear, sphere([0.05, 0.05, 0.05], 16), toon("#3a2a22"), V(0, 0.21, 0));
      const side_ = new THREE.ConeGeometry(0.07, 0.22, 16);
      side_.scale(1, 1, 0.4);
      side_.rotateZ(side * -1.3);
      mesh(head, side_, ctx.plain, V(side * H[0] * 0.95, H[1] * 0.35, -H[2] * 0.05));
    } else if (sp === 7) {
      // Elefant: grosse Schlappohren, wedeln
      ear.position.set(side * H[0] * 0.88, H[1] * 0.05, -H[2] * 0.15);
      const flap = mesh(ear, sphere([0.07, 0.38, 0.32], 32), ctx.plain, V(side * 0.08, 0, 0));
      mesh(flap, sphere([0.03, 0.3, 0.24], 24), inner, V(side * -0.045, 0, 0.02));
      ear.rotation.y = side * 0.35;
      ctx.anims.push((t) => (ear.rotation.y = side * (0.35 + Math.sin(t * 2) * 0.12)));
    } else if (sp === 11) {
      // Eule: Federohren
      const tuft = new THREE.ConeGeometry(0.08, 0.26, 12);
      tuft.scale(1, 1, 0.4);
      const m = mesh(ear, tuft, ctx.dark, V(0, 0.12, 0));
      ear.position.set(side * H[0] * 0.55, H[1] * 0.78, 0);
      m.rotation.z = side * -0.45;
    }
    // 4/9 (Frosch/Krokodil): Augenhuegel bei den Augen; 10/12: keine Ohren
  }
}

// ------------------------------------------------------------------ Schwanz

function buildTail(ctx: Ctx, root: THREE.Group, sp: number, s: number) {
  const { fur } = ctx;
  if (sp === 4) return;
  let tip: THREE.Vector3 | null = null;
  const tuftMat = toon(C(fur.dark).lerp(C("#2a1a12"), 0.4));
  if (sp === 2 || sp === 3 || sp === 12) {
    const r = sp === 2 ? 0.13 : sp === 3 ? 0.09 : 0.06;
    mesh(root, sphere([r, r, r * (sp === 12 ? 1.6 : 1)], 24), sp === 2 ? toon("#fbf7ef") : ctx.plain, V(0, 0, -r * 0.4));
    ctx.anims.push((t) => (root.rotation.y = Math.sin(t * 3) * 0.2));
    root.userData.tip = V(0, r * 0.6, -r * 0.4);
    return;
  }
  if (sp === 0) {
    const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 0.12, -0.25), V(0, 0.45, -0.38), V(0, 0.72, -0.22)].map((p) => p.multiplyScalar(s)));
    mesh(root, taperTube(curve, 0.065 * s, 0.045 * s), ctx.plain);
    mesh(root, sphere([0.05 * s, 0.05 * s, 0.05 * s], 16), ctx.plain, curve.getPointAt(1));
    tip = curve.getPointAt(1);
  } else if (sp === 1) {
    // Fuchs: riesige Rute, nach oben geschwungen, weisse Spitze
    const g = paint(sphere([0.22 * s, 0.24 * s, 0.5 * s], 32), (p) => (p.z < -0.3 * s ? C("#fbf7ef") : C(fur.base)));
    const m = mesh(root, g, toon("#ffffff", { vertexColors: true }), V(0, 0.22 * s, -0.4 * s));
    m.rotation.x = -0.85;
    tip = V(0, 0.6 * s, -0.7 * s);
  } else if (sp === 14) {
    // Wolf: buschig, haengt nach unten, dunkle Spitze
    const g = paint(sphere([0.15 * s, 0.17 * s, 0.42 * s], 32), (p) => (p.z < -0.3 * s ? C(fur.dark) : C(fur.base)));
    const m = mesh(root, g, toon("#ffffff", { vertexColors: true }), V(0, -0.2 * s, -0.25 * s));
    m.rotation.x = 0.9;
    tip = V(0, -0.5 * s, -0.4 * s);
  } else if (sp === 5 || sp === 9) {
    // Drache / Krokodil: langer Schwanz mit Zacken (Krokodil liegt flach)
    const croc = sp === 9;
    const pts = croc ? [V(0, 0, 0), V(0.05, -0.08, -0.35), V(-0.05, -0.12, -0.7), V(0.08, -0.12, -1.0)] : [V(0, 0, 0), V(0, -0.05, -0.3), V(0, 0.05, -0.6), V(0, 0.25, -0.8)];
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.multiplyScalar(s)));
    mesh(root, taperTube(curve, (croc ? 0.16 : 0.11) * s, 0.03 * s), ctx.plain);
    for (let i = 1; i <= (croc ? 6 : 4); i++) {
      const p = curve.getPointAt(i / (croc ? 7 : 5));
      mesh(root, new THREE.ConeGeometry(0.04 * s, 0.1 * s, croc ? 4 : 12), ctx.dark, p.clone().add(V(0, (croc ? 0.1 : 0.08) * s * (1 - i / 8), 0)));
    }
    tip = curve.getPointAt(1);
    if (!croc) {
      const spade = new THREE.ConeGeometry(0.09 * s, 0.2 * s, 4);
      spade.scale(1, 1, 0.3);
      mesh(root, spade, ctx.dark, tip.clone().add(V(0, 0.08 * s, -0.04 * s))).rotation.x = -0.6;
    }
  } else if (sp === 6 || sp === 7 || sp === 8 || sp === 13) {
    // duenner Schwanz mit Quaste (Giraffe, Elefant, Nashorn, Loewe)
    const lion = sp === 13;
    const pts = lion ? [V(0, 0, 0), V(0, 0.05, -0.3), V(0, 0.35, -0.5), V(0, 0.6, -0.4)] : [V(0, 0, 0), V(0, -0.12, -0.12), V(0, -0.35, -0.18)];
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.multiplyScalar(s)));
    mesh(root, taperTube(curve, 0.035 * s, 0.025 * s, 16, 10), ctx.plain);
    tip = curve.getPointAt(1);
    mesh(root, sphere([0.07 * s, 0.1 * s, 0.07 * s], 16), tuftMat, tip.clone());
  } else if (sp === 10) {
    const t = new THREE.ConeGeometry(0.1, 0.16, 4);
    t.scale(1, 1, 0.3);
    t.rotateX(-2.2);
    mesh(root, t, ctx.dark, V(0, 0, -0.05));
    tip = V(0, -0.05, -0.12);
  } else if (sp === 11) {
    for (const a of [-0.35, 0, 0.35]) {
      const f = mesh(root, sphere([0.06, 0.03, 0.2], 16), ctx.dark, V(Math.sin(a) * 0.1, 0.02, -0.15));
      f.rotation.y = a;
    }
    tip = V(0, 0.05, -0.3);
  }
  root.userData.tip = tip;
  ctx.anims.push((t) => (root.rotation.y = Math.sin(t * 1.8) * 0.22));
}

// ------------------------------------------------------------------ Element-Merkmale

function buildElement(
  ctx: Ctx,
  a: { head: THREE.Group; H: Vec3T; torso: THREE.Group; B: Vec3T; tailRoot: THREE.Group; baby: boolean },
) {
  const { look, fur, anims } = ctx;
  const el = look.palette;
  const tip: THREE.Vector3 = a.tailRoot.userData.tip ?? V(0, 0.15, -0.15);
  const k = a.baby ? 0.7 : 1;

  if (el === 2 || el === 7) {
    // Feuer/Magma: lodernde Flamme an der Schwanzspitze
    const flame = new THREE.Group();
    flame.position.copy(tip);
    a.tailRoot.add(flame);
    const big = el === 7 ? 1.4 : 1;
    const layers: [string, number, number][] = [
      ["#ff4d1a", 0.13, 0.36],
      ["#ff9a1f", 0.09, 0.28],
      ["#ffe066", 0.05, 0.18],
    ];
    layers.forEach(([c, r, h], i) => {
      const f = mesh(flame, new THREE.ConeGeometry(r * k * big, h * k * big, 16), glow(c, 0.95));
      f.position.y = h * 0.4 * k * big;
      anims.push((t) => f.scale.set(1 + Math.sin(t * 9 + i) * 0.12, 1 + Math.sin(t * 11 + i * 2) * 0.18, 1));
    });
  } else if (el === 3) {
    // Pflanze: Blattspross auf dem Kopf
    const sprout = new THREE.Group();
    sprout.position.set(0, a.H[1] * 0.95, 0);
    a.head.add(sprout);
    const leafMat = toon("#5cc45a");
    for (const side of [-1, 1]) {
      const l = mesh(sprout, sphere([0.16 * k, 0.03, 0.08 * k], 20), leafMat, V(side * 0.12 * k, 0.12 * k, 0));
      l.rotation.z = side * 0.5;
    }
    mesh(sprout, new THREE.CylinderGeometry(0.015, 0.02, 0.14 * k, 8), toon("#3e8a3c"), V(0, 0.06 * k, 0));
    anims.push((t) => (sprout.rotation.z = Math.sin(t * 1.5) * 0.12));
  } else if (el === 6) {
    // Wasser: Flossenkamm auf Kopf und Ruecken
    const finMat = toon(fur.accent);
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.quadraticCurveTo(0.05, 0.3, -0.25, 0.32);
    fin.quadraticCurveTo(-0.12, 0.12, -0.3, 0);
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.02, bevelEnabled: false, curveSegments: 12 });
    g.rotateY(Math.PI / 2);
    g.scale(k, k, k);
    mesh(a.head, g, finMat, V(0, a.H[1] * 0.82, 0.15 * k));
    mesh(a.torso, g.clone(), finMat, V(0, a.B[1] * 0.85, 0.1));
  } else if (el === 5) {
    // Eis: Kristalle auf dem Ruecken
    const ice = toon("#d6f6ff", { emissive: C("#5fd3ff"), emissiveIntensity: 0.35 });
    for (let i = 0; i < 4; i++) {
      const c = mesh(a.torso, new THREE.OctahedronGeometry(0.07 * k * (1.3 - i * 0.15), 0), ice);
      c.position.set(i % 2 ? 0.05 : -0.05, a.B[1] * 0.92, a.B[2] * (0.3 - i * 0.25));
      c.scale.set(0.6, 1.8, 0.6);
      c.rotation.z = (i % 2 ? 1 : -1) * 0.3;
    }
  } else if (el === 9) {
    // Elektro: Blitz an der Schwanzspitze + rote Wangen
    const bolt = new THREE.Shape();
    [[0, 0], [0.12, 0.14], [0.05, 0.16], [0.16, 0.34], [-0.02, 0.15], [0.05, 0.13], [-0.06, 0]].forEach(([x, y], i) =>
      i ? bolt.lineTo(x * k * 1.4, y * k * 1.4) : bolt.moveTo(x, y),
    );
    const g = new THREE.ExtrudeGeometry(bolt, { depth: 0.03, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    const b = mesh(a.tailRoot, g, toon("#ffe14d", { emissive: C("#ffb800"), emissiveIntensity: 0.4 }), tip.clone());
    anims.push((t) => (b.rotation.x = Math.sin(t * 12) * 0.08));
    for (const side of [-1, 1]) {
      const cheek = mesh(a.head, sphere([0.075, 0.075, 0.03], 16), glow("#ff4d4d", 0.85));
      cheek.position.set(side * a.H[0] * 0.66, -a.H[1] * 0.28, a.H[2] * 0.7);
      cheek.rotation.y = side * 0.6;
    }
  } else if (el === 1) {
    // Gestein: Felsplatten auf dem Ruecken
    const rock = toon("#a8987a");
    for (let i = 0; i < 3; i++) {
      const r = mesh(a.torso, new THREE.DodecahedronGeometry(0.1 * k * (1.2 - i * 0.2), 0), rock);
      r.position.set(0, a.B[1] * 0.88, a.B[2] * (0.25 - i * 0.32));
      r.scale.set(1.2, 0.7, 1);
    }
  } else if (el === 4) {
    // Psycho: leuchtendes Stirnjuwel + schwebender Orb
    mesh(a.head, new THREE.SphereGeometry(0.07 * k, 20, 16), glow(fur.accent), V(0, a.H[1] * 0.45, a.H[2] * 0.85));
    const orb = mesh(a.head, new THREE.SphereGeometry(0.06, 20, 16), glow("#ffb3ec", 0.9));
    anims.push((t) => orb.position.set(Math.cos(t * 1.5) * 0.7, a.H[1] * 0.9 + Math.sin(t * 3) * 0.06, Math.sin(t * 1.5) * 0.7));
  } else if (el === 0) {
    // Normal: flauschiger Fellkragen
    const ruff = toon(fur.accent);
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 1.6 - Math.PI * 0.8;
      mesh(a.torso, sphere([0.11 * k, 0.09 * k, 0.11 * k], 16), ruff, V(Math.sin(ang) * a.B[0] * 0.75, a.B[1] * 0.55, a.B[2] * 0.62 + Math.cos(ang) * 0.06 - 0.05));
    }
  } else if (el === 8) {
    // Kosmos: Sternenring um den Kopf
    const ring = mesh(a.head, new THREE.TorusGeometry(0.62, 0.012, 8, 48), glow("#ffe27a", 0.8));
    ring.rotation.x = Math.PI / 2.4;
    anims.push((t) => (ring.rotation.z = t * 0.6));
  }
}

// ------------------------------------------------------------------ Fluegel

function buildWings(ctx: Ctx, torso: THREE.Group, B: Vec3T, kind: "bat" | "feather", scale = 1) {
  const { fur } = ctx;
  const bat = kind === "bat";
  const mat = toon(bat ? C(fur.dark).lerp(C(fur.base), 0.4) : C("#fbfaf6"), { side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * B[0] * 0.55, B[1] * 0.7, -B[2] * 0.1);
    wing.scale.setScalar(scale);
    torso.add(wing);
    const s = new THREE.Shape();
    if (bat) {
      s.moveTo(0, 0);
      s.lineTo(0.15, 0.42);
      s.lineTo(0.55, 0.5);
      s.quadraticCurveTo(0.45, 0.32, 0.55, 0.22);
      s.quadraticCurveTo(0.36, 0.2, 0.42, 0.04);
      s.quadraticCurveTo(0.22, 0.12, 0, 0);
    } else {
      s.moveTo(0, 0);
      s.quadraticCurveTo(0.05, 0.5, 0.35, 0.62);
      s.quadraticCurveTo(0.62, 0.62, 0.66, 0.45);
      s.quadraticCurveTo(0.55, 0.4, 0.6, 0.3);
      s.quadraticCurveTo(0.45, 0.26, 0.5, 0.15);
      s.quadraticCurveTo(0.3, 0.12, 0, 0);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false, curveSegments: 10 });
    if (side < 0) g.scale(-1, 1, 1);
    g.rotateY(side * -0.9);
    const m = mesh(wing, g, mat);
    m.position.z = -0.05;
    ctx.anims.push((t) => (wing.rotation.z = side * (Math.sin(t * (bat ? 2.4 : 3)) * 0.22 - 0.05)));
  }
}

// ------------------------------------------------------------------ Ei

/** Ei-Stufe: aufgebrochene Schale, das Baby schaut heraus -> Spezies schon erkennbar */
function buildEgg(ctx: Ctx, group: THREE.Group, dna: bigint, generation: number): Creature {
  const { fur, look } = ctx;
  const shellMat = toon("#ffffff", { vertexColors: true, side: THREE.DoubleSide });
  const spots = (q: THREE.Vector3) =>
    Math.sin(q.x * 14) * Math.sin(q.y * 12) * Math.sin(q.z * 14) > 0.25 ? C(fur.base) : C("#fbf6ec");
  // untere Schalenhaelfte (offen nach oben)
  const shell = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  shell.scale(0.58, 0.62, 0.58);
  paint(shell, spots);
  const pivot = new THREE.Group();
  group.add(pivot);
  const shellM = mesh(pivot, shell, shellMat, V(0, 0.62, 0));
  const rimY = 0.62 + Math.cos(Math.PI * 0.42) * 0.62;
  const rimR = Math.sin(Math.PI * 0.42) * 0.58;
  // gezackter Rand aus Schalensplittern
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const shard = new THREE.ConeGeometry(0.075, 0.13 + (i % 3) * 0.04, 3);
    const m = mesh(pivot, paint(shard, () => C("#fbf6ec")), toon("#ffffff", { vertexColors: true }));
    m.position.set(Math.cos(ang) * rimR * 0.98, rimY + 0.05, Math.sin(ang) * rimR * 0.98);
    m.rotation.set(Math.sin(ang) * 0.25, -ang, -Math.cos(ang) * 0.25);
  }
  // Schalendeckel liegt daneben
  const cap = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.32);
  cap.scale(0.45, 0.5, 0.45);
  paint(cap, spots);
  const capM = mesh(group, cap, shellMat, V(0.78, 0.02, 0.25));
  capM.rotation.set(2.6, 0.4, 0.3);

  // Baby (gleiche DNA, Stufe Baby) sitzt in der Schale, Kopf schaut heraus
  const babyLook = { ...look, stage: 1 };
  const baby = buildCreature(babyLook, dna, { generation, item: 0 });
  const bb = new THREE.Box3().setFromObject(baby.group);
  const h = bb.getSize(V()).y;
  const k = 1.05 / h;
  baby.group.scale.multiplyScalar(k);
  baby.group.position.set(0, rimY - 0.4, -0.02); // Augen knapp ueber dem Schalenrand
  pivot.add(baby.group);
  void shellM;
  return {
    group,
    update: (t) => {
      baby.update(t);
      const wob = Math.sin(t * 0.8) > 0.3 ? 1 : 0.15;
      pivot.rotation.z = Math.sin(t * 7) * 0.05 * wob;
    },
  };
}

// ------------------------------------------------------------------ Cosmetics

type CosmeticAnchors = {
  head: THREE.Group;
  H: Vec3T;
  torso: THREE.Group;
  B: Vec3T;
  group: THREE.Group;
  eyes: THREE.Object3D[];
  frogEyes: boolean;
};

/** Cosmetics an echten Ankern (Augen, Kopfoberseite, Hals) ausgerichtet */
function addCosmetic(ctx: Ctx, item: number, a: CosmeticAnchors) {
  const { H } = a;
  const top = new THREE.Group(); // Kopfoberseite, leicht schraeg wie aufgesetzt
  top.position.set(0.03, H[1] * 0.9, -0.02);
  top.rotation.z = -0.14;
  if (item === 1) {
    a.head.add(top);
    const black = toon("#24222c");
    mesh(top, new THREE.CylinderGeometry(0.34, 0.34, 0.035, 40), black);
    mesh(top, new THREE.CylinderGeometry(0.2, 0.22, 0.36, 40), black, V(0, 0.19, 0));
    mesh(top, new THREE.CylinderGeometry(0.225, 0.225, 0.07, 40), toon("#d23642"), V(0, 0.06, 0));
  } else if (item === 2) {
    // Sonnenbrille: Glaeser exakt auf den Augen, Steg dazwischen, Buegel nach hinten
    const frame = toon("#15131c");
    const glass = toon("#2a2440");
    const centers: THREE.Vector3[] = [];
    for (const eye of a.eyes) {
      const lens = new THREE.Group();
      lens.position.copy(eye.position);
      lens.rotation.copy(eye.rotation);
      lens.translateZ(0.03);
      a.head.add(lens);
      const disc = new THREE.CylinderGeometry(0.165, 0.165, 0.035, 32);
      disc.rotateX(Math.PI / 2);
      disc.scale(1.05, 0.88, 1);
      mesh(lens, disc, glass);
      const shine = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), glow("#ffffff", 0.55));
      shine.position.set(0.02, 0.06, 0.02);
      shine.rotation.z = 0.5;
      lens.add(shine);
      centers.push(lens.position.clone());
    }
    if (centers.length === 2) {
      const mid = centers[0].clone().lerp(centers[1], 0.5).add(V(0, 0.07, 0.01));
      const bridge = new THREE.CatmullRomCurve3([centers[0].clone().add(V(0.14, 0.06, 0)), mid, centers[1].clone().add(V(-0.14, 0.06, 0))]);
      mesh(a.head, new THREE.TubeGeometry(bridge, 8, 0.016, 6), frame);
    }
  } else if (item === 3) {
    a.head.add(top);
    const gold = toon("#ffcf3a", { emissive: C("#6a4600"), emissiveIntensity: 0.25 });
    mesh(top, new THREE.CylinderGeometry(0.25, 0.27, 0.11, 40, 1, true), toon("#ffcf3a", { side: THREE.DoubleSide }), V(0, 0.04, 0));
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      mesh(top, new THREE.ConeGeometry(0.055, 0.17, 12), gold, V(Math.cos(ang) * 0.25, 0.17, Math.sin(ang) * 0.25));
      mesh(top, new THREE.SphereGeometry(0.03, 12, 10), glow(i % 2 ? "#ff3d5a" : "#3dd6ff"), V(Math.cos(ang) * 0.27, 0.04, Math.sin(ang) * 0.27));
    }
  } else if (item === 4) {
    // Schal: Ring direkt unter dem Kopf + herabhaengendes Ende
    const red = toon("#d23642");
    const neck = new THREE.Group();
    neck.position.set(0, a.head.position.y - H[1] * 0.8, a.head.position.z - 0.06);
    a.group.add(neck);
    const ring = mesh(neck, new THREE.TorusGeometry(H[0] * 0.62, 0.075, 14, 40), red);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1, 0.85, 1);
    const end = mesh(neck, new THREE.CapsuleGeometry(0.06, 0.22, 6, 12), red, V(H[0] * 0.3, -0.16, H[0] * 0.5));
    end.rotation.z = 0.35;
    end.scale.set(1.2, 1, 0.5);
    const stripe = toon("#fff3e6");
    for (const y of [-0.05, -0.17]) mesh(end, new THREE.TorusGeometry(0.065, 0.012, 6, 16), stripe, V(0, y, 0)).rotation.x = Math.PI / 2;
  } else if (item === 5) {
    buildWings(ctx, a.torso, a.B, "feather", 1.5);
  }
}

