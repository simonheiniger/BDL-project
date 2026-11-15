// Szene um die Kreatur: Toon-Licht, Arena-Plattform, Umgebung (Hintergrund-Gen), Effekte fuer Legendaer.
// Konturlinien: Inverted-Hull pro Teil (creature.ts), wie bei Anime-/Monster-Spielen.
import * as THREE from "three";
import { buildCreature, rng, toonGradient as sharedGradient, outlineMaterial } from "./creature";
import { decode, type Look } from "./dna";

type Env = { top: string; bottom: string; ground: string; rim: string; sun: string; night?: boolean };
/** Hintergrund-Gen -> Umgebung (Index wie on-chain) */
const ENVS: Env[] = [
  { top: "#ff9a6b", bottom: "#ffe0b3", ground: "#e9b48a", rim: "#c98760", sun: "#fff1dc" }, // Sonnenuntergang
  { top: "#6fd3a8", bottom: "#e4fbe9", ground: "#8fd17c", rim: "#5aa65a", sun: "#ffffff" }, // Wiese
  { top: "#141a4a", bottom: "#4a3a8a", ground: "#5a4f9a", rim: "#3a3270", sun: "#cfd8ff", night: true }, // Sternennacht
  { top: "#f3a6d8", bottom: "#fff0fa", ground: "#f6c8e6", rim: "#d79ac4", sun: "#ffffff" }, // Zuckerwatte
  { top: "#3fa8e0", bottom: "#d9f4ff", ground: "#9ad8f0", rim: "#5aaed4", sun: "#ffffff" }, // Ozean
  { top: "#d9c3a0", bottom: "#fbf5ea", ground: "#eadcc2", rim: "#c7b08a", sun: "#ffffff" }, // Creme
];

export type PetInput = { dna: bigint; level: number; generation: number; item: number };

export type PetScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (t: number) => void;
  look: Look;
  holder: THREE.Group;
  dispose: () => void;
};

function skyTexture(env: Env) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, env.top);
  grad.addColorStop(1, env.bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  // weicher Lichtfleck hinter dem Tier
  const rad = g.createRadialGradient(256, 230, 10, 256, 230, 260);
  rad.addColorStop(0, "rgba(255,255,255,0.55)");
  rad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rad;
  g.fillRect(0, 0, 512, 512);
  if (env.night) {
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = 0.3 + ((i * 37) % 70) / 100;
      g.fillRect((i * 97) % 512, (i * 53) % 330, 2, 2);
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const toonMat = (color: string) => {
  const gm = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1);
  gm.minFilter = gm.magFilter = THREE.NearestFilter;
  gm.needsUpdate = true;
  return new THREE.MeshToonMaterial({ color, gradientMap: gm });
};

export function buildPetScene(input: PetInput, aspect = 1): PetScene {
  const look = decode(input.dna, input.level);
  const env = ENVS[look.bg];
  const rnd = rng(input.dna ^ 0x5eedn);
  const scene = new THREE.Scene();
  scene.background = skyTexture(env);

  scene.add(new THREE.HemisphereLight("#ffffff", env.ground, env.night ? 1.6 : 1.9));
  const sun = new THREE.DirectionalLight(env.sun, env.night ? 1.6 : 2.2);
  sun.position.set(2.5, 5, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2.5;
  sun.shadow.camera.right = sun.shadow.camera.top = 2.5;
  sun.shadow.bias = -0.001;
  sun.shadow.radius = 4;
  scene.add(sun);

  // Arena-Plattform
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.42, 0.16, 64), toonMat(env.ground));
  plat.position.y = -0.08;
  plat.receiveShadow = true;
  scene.add(plat);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.035, 8, 64), toonMat(env.rim));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.005;
  scene.add(rim);
  // Deko: kleine Bueschel/Kiesel am Rand
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1.05 + rnd() * 0.2;
    const s = 0.05 + rnd() * 0.05;
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), toonMat(env.rim));
    m.position.set(Math.cos(a) * r, s * 0.5, Math.sin(a) * r);
    m.scale.y = 0.7;
    scene.add(m);
  }

  const anims: ((t: number) => void)[] = [];

  // Kreatur, auf gleiche Bildgroesse normiert (nach Drehung gemessen)
  const creature = buildCreature(look, input.dna, { generation: input.generation, item: input.item });
  const holder = new THREE.Group();
  holder.add(creature.group);
  holder.rotation.y = 0.62; // 3/4-Ansicht: Gesicht + Schwanz sichtbar
  let box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const k = (look.stage === 1 ? 1.25 : look.stage === 0 ? 1.45 : 1.6) / Math.max(size.x * 0.9, size.y, size.z * 0.7);
  holder.scale.setScalar(k);
  box = new THREE.Box3().setFromObject(holder);
  const center = box.getCenter(new THREE.Vector3());
  holder.position.set(-center.x, -box.min.y, -center.z);
  scene.add(holder);

  // Legendaer: Lichtsaeule + schwebende Kristalle
  if (look.stage === 3) {
    const crystals = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: "#fff2b0" }));
      c.material.userData.outlineParameters = { visible: false };
      const a = (i / 6) * Math.PI * 2;
      c.position.set(Math.cos(a) * 1.15, 1, Math.sin(a) * 1.15);
      c.scale.set(0.6, 1.5, 0.6);
      crystals.add(c);
    }
    scene.add(crystals);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.22, 64),
      new THREE.MeshBasicMaterial({ color: "#ffe17a", transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    ring.material.userData.outlineParameters = { visible: false };
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    scene.add(ring);
    anims.push((t) => {
      crystals.rotation.y = t * 0.4;
      crystals.children.forEach((c, i) => (c.position.y = 1 + Math.sin(t * 1.5 + i) * 0.1));
      ring.material.opacity = 0.35 + Math.sin(t * 2) * 0.25;
    });
  }
  // Funken/Sterne um Elektro, Magma, Kosmos
  if (look.palette === 7 || look.palette === 8 || look.palette === 9) {
    const n = 36;
    const pos = new Float32Array(n * 3);
    const seeds = Array.from({ length: n }, () => [rnd() * 2.2 - 1.1, rnd() * 1.8, rnd() * 2.2 - 1.1, rnd()]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const color = look.palette === 7 ? "#ff7a2f" : look.palette === 8 ? "#d8ccff" : "#fff07a";
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.045, transparent: true, opacity: 0.9 })));
    anims.push((t) => {
      seeds.forEach(([x, y, z, s], i) => pos.set([x, (y + t * (0.15 + s * 0.25)) % 1.9, z], i * 3));
      g.attributes.position.needsUpdate = true;
    });
  }

  const camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 50);
  camera.position.set(0.9, 1.5, 4.0);
  camera.lookAt(0, 0.72, 0);

  return {
    scene,
    camera,
    look,
    holder,
    update: (t) => {
      creature.update(t);
      anims.forEach((a) => a(t));
    },
    dispose: () => {
      (scene.background as THREE.Texture).dispose();
      scene.traverse((o) => {
        // Schattenkarten der Lichter sind eigene Render-Targets -> sonst Speicherleck pro Snapshot
        (o as THREE.DirectionalLight).shadow?.map?.dispose();
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = ([] as THREE.Material[]).concat((m.material as THREE.Material | THREE.Material[]) ?? []);
        for (const x of mats) {
          const gm = (x as THREE.MeshToonMaterial).gradientMap;
          if (gm && gm !== sharedGradient()) gm.dispose();
          if (x !== outlineMaterial()) x.dispose(); // geteiltes Kontur-Material bleibt
        }
      });
    },
  };
}

export function configureRenderer(r: THREE.WebGLRenderer) {
  r.toneMapping = THREE.NoToneMapping; // Toon-Farben unverfaelscht
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
}

// ------------------------------------------------------------------ Snapshots fuer Karten

let shared: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

/** Standbild (PNG data-URL) mit einem geteilten Renderer -> keine 20 WebGL-Kontexte fuer 20 Karten */
export function snapshot(input: PetInput, size = 512): string | null {
  const key = `${input.dna}-${input.level}-${input.generation}-${input.item}-${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (!shared) {
      shared = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      configureRenderer(shared);
    }
    shared.setPixelRatio(1);
    shared.setSize(size, size, false);
    const s = buildPetScene(input, 1);
    s.update(0.8);
    shared.render(s.scene, s.camera);
    const url = shared.domElement.toDataURL("image/png");
    s.dispose();
    shared.renderLists.dispose();
    cache.set(key, url);
    return url;
  } catch {
    return null; // kein WebGL -> Karte zeigt on-chain SVG
  }
}
