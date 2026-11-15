import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildPetScene, configureRenderer, type PetInput } from "./scene";

/** Live-3D-Ansicht eines Pets: drehbar, animiert (Atmen, Schwanz, Ohren, Blinzeln) */
export default function PetCanvas({ input, awake = false }: { input: PetInput; awake?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `${input.dna}-${input.level}-${input.generation}-${input.item}`;

  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    configureRenderer(renderer);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const s = buildPetScene(input, 1);
    const controls = new OrbitControls(s.camera, renderer.domElement);
    controls.target.set(0, 0.72, 0);
    controls.enablePan = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.enableDamping = true;

    const resize = () => {
      const w = el.clientWidth;
      renderer.setSize(w, w);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const baseY = s.holder.position.y;
    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      const t = clock.getElapsedTime();
      // "Aufwecken" (NFC): kurzer Sprung
      if (awake && t < 1.5) s.holder.position.y = baseY + Math.abs(Math.sin(t * 6)) * 0.25 * (1.5 - t);
      s.update(t);
      controls.update();
      renderer.render(s.scene, s.camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      s.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={ref} className="pet3d" title="Ziehen zum Drehen, Scrollen zum Zoomen" />;
}
