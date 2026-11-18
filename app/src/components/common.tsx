import { useRef } from "react";
import { Link } from "react-router-dom";
import { HOUSE_TIERS, STAT_NAMES, type Pet } from "../contracts";
import { xpToNext, MAX_LEVEL } from "../gamemath";
import type { PetView } from "../hooks";

const tierClass = (v: PetView) => `tier-${String(v.attrs.Seltenheit ?? "Common").toLowerCase()}`;

/**
 * Sammelkarte: on-chain Pixel-Art (tokenURI) + Seltenheits-Rahmen + Holo-Glanz, der dem Zeiger folgt.
 * Das Bild (inkl. angezogenem Cosmetic, Evolution, Animation) kommt komplett aus dem Contract.
 */
export function NftCard({
  view,
  size = "md",
  awake = false,
  link = true,
  art,
  children,
}: {
  /** ersetzt das Bild (optional) */
  art?: React.ReactNode;
  view: PetView;
  size?: "sm" | "md" | "lg";
  awake?: boolean;
  link?: boolean;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

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
      <div className={`art ${awake ? "awake" : ""}`}>{art ?? <img src={view.image} alt={view.name} />}</div>
      <div className="nft-info">
        <div className="row between">
          <strong className="nft-name">{view.name}</strong>
          <span className="lv">Lv {Number(view.pet.level)}</span>
        </div>
        <div className="row between small">
          <span className="tier-label">{String(view.attrs.Seltenheit)}</span>
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

/** Zufriedenheit 0..100 (unter 50 gibt es nur noch 50-100 % XP) */
export function MoodBar({ mood }: { mood: number }) {
  const face = mood >= 75 ? "😊" : mood >= 50 ? "🙂" : mood >= 25 ? "😕" : "😢";
  return (
    <div className="stat" title="Unter 50 Zufriedenheit gibt Pflege weniger XP. Bessere Häuser halten länger zufrieden.">
      <span className="label">{face}</span>
      <div className={`bar mood ${mood < 50 ? "low" : ""}`}>
        <div style={{ width: `${mood}%` }} />
      </div>
      <span className="val">{mood}</span>
    </div>
  );
}

export const tierInfo = (tier: number) => HOUSE_TIERS[Math.min(tier, HOUSE_TIERS.length - 1)];
