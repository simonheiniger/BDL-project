import { useEffect, useRef, useState } from "react";
import { snapshot } from "../three/scene";
import { ITEM_IDS, decode } from "../three/dna";
import { ELEMENTS } from "../three/creature";

const ELEMENT_ICON = ["⭐", "🪨", "🔥", "🌿", "🔮", "❄️", "💧", "🌋", "🌌", "⚡"];
/** Element-Typ (aus dem Farb-Gen abgeleitet, wie im 3D-Generator) */
export const elementOf = (v: PetView) => {
  const i = decode(BigInt(v.pet.dna), Number(v.pet.level)).palette;
  return `${ELEMENT_ICON[i]} ${ELEMENTS[i]}`;
};
import { Link } from "react-router-dom";
import { STAT_NAMES, type Pet } from "../contracts";
import { xpToNext, MAX_LEVEL } from "../gamemath";
import type { PetView } from "../hooks";

/** 3D-Eingabe aus on-chain Daten (Cosmetic nur, wenn es laut tokenURI sichtbar ist) */
export const petInput = (v: PetView) => ({
  dna: BigInt(v.pet.dna),
  level: Number(v.pet.level),
  generation: Number(v.pet.generation),
  item: ITEM_IDS[String(v.attrs.Cosmetic)] ?? 0,
});

/** Low-Poly-Snapshot (lazy, nach dem ersten Paint); faellt auf das on-chain SVG zurueck */
function usePetImage(v: PetView) {
  const [img, setImg] = useState<string | null>(null);
  const input = petInput(v);
  const key = `${input.dna}-${input.level}-${input.generation}-${input.item}`;
  useEffect(() => {
    const id = setTimeout(() => setImg(snapshot(input, 480)), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return img ?? v.image;
}

const tierClass = (v: PetView) => `tier-${String(v.attrs.Seltenheit ?? "Common").toLowerCase()}`;

/**
 * Sammelkarte: on-chain Bild + Seltenheits-Rahmen + Holo-Glanz, der dem Zeiger folgt.
 * Alles Visuelle (inkl. angezogenes Cosmetic) kommt aus tokenURI – die Karte rahmt es nur.
 */
export function NftCard({
  view,
  size = "md",
  awake = false,
  link = true,
  art,
  children,
}: {
  /** ersetzt das Bild, z.B. durch die Live-3D-Ansicht */
  art?: React.ReactNode;
  view: PetView;
  size?: "sm" | "md" | "lg";
  awake?: boolean;
  link?: boolean;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const img = usePetImage(view);

  function onMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el || art) return; // bei Live-3D dreht man das Modell, nicht die Karte
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    el.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
  }
  function onLeave() {
    ref.current?.style.setProperty("--rx", "0deg");
    ref.current?.style.setProperty("--ry", "0deg");
  }

  const body = (
    <div ref={ref} className={`nft ${size} ${tierClass(view)}`} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className={`art ${awake ? "awake" : ""}`}>{art ?? <img src={img} alt={view.name} />}</div>
      <div className="nft-info">
        <div className="row between">
          <strong className="nft-name">{view.name}</strong>
          <span className="lv">Lv {Number(view.pet.level)}</span>
        </div>
        <div className="row between small">
          <span className="tier-label">
            {String(view.attrs.Seltenheit)} <span className="elem">{elementOf(view)}</span>
          </span>
          <span className="muted">
            {String(view.attrs.Stufe)} · Gen {Number(view.pet.generation)}
          </span>
        </div>
        {children}
      </div>
      <div className="holo" />
    </div>
  );
  return link ? (
    <Link to={`/pet/${view.id}`} className="nft-link">
      {body}
    </Link>
  ) : (
    body
  );
}

const TRAIT_KEYS = ["Spezies", "Rasse", "Ohren", "Schwanz", "Farbe", "Augen", "Mund", "Muster", "Hintergrund", "Cosmetic"];

export function Traits({ view }: { view: PetView }) {
  return (
    <div className="traits">
      <div className="trait">
        <span className="muted small">Typ</span>
        <span>{elementOf(view)}</span>
      </div>
      {TRAIT_KEYS.map((k) => (
        <div key={k} className="trait">
          <span className="muted small">{k}</span>
          <span>{String(view.attrs[k] ?? "–")}</span>
        </div>
      ))}
    </div>
  );
}

export function StatBars({ stats, compare }: { stats: readonly number[]; compare?: readonly number[] }) {
  const max = Math.max(60, ...stats.map(Number));
  return (
    <div className="stats">
      {STAT_NAMES.map((n, i) => (
        <div key={n} className="stat">
          <span className="label">{n}</span>
          <div className="bar">
            <div style={{ width: `${(Number(stats[i]) / max) * 100}%` }} />
          </div>
          <span className="val">
            {Number(stats[i])}
            {compare && Number(stats[i]) !== Number(compare[i]) && (
              <span className="up"> (+{Number(stats[i]) - Number(compare[i])})</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function XpBar({ pet }: { pet: Pet }) {
  const level = Number(pet.level);
  if (level >= MAX_LEVEL) return <div className="muted">Max-Level erreicht</div>;
  const need = xpToNext(level);
  const next = level === 1 ? "Schlüpfen bei Level 2" : level === 4 ? "Erwachsen bei Level 5" : level === 14 ? "Legendär bei Level 15" : null;
  return (
    <div className="xp">
      <div className="bar">
        <div style={{ width: `${(Number(pet.xp) / need) * 100}%` }} />
      </div>
      <span className="muted small">
        {Number(pet.xp)} / {need} XP bis Level {level + 1}
        {next && <strong className="evo"> · ✨ {next}</strong>}
      </span>
    </div>
  );
}

export function TxStatus({ pending, error }: { pending: string | null; error: string | null }) {
  if (pending) return <div className="toast">⏳ {pending} …</div>;
  if (error) return <div className="toast error">⚠️ {error}</div>;
  return null;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
