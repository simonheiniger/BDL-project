import { Link } from "react-router-dom";
import { ITEM_EMOJI, STAT_NAMES, type Pet } from "../contracts";
import { xpToNext, MAX_LEVEL } from "../gamemath";
import type { PetView } from "../hooks";

/** Ausgeruestetes Cosmetic ist rein visuell und lokal (localStorage) – beeinflusst nie Stats. */
export const equippedKey = (chainId: number, id: bigint) => `equip-${chainId}-${id}`;
export function getEquipped(chainId: number, id: bigint): string | null {
  try {
    return localStorage.getItem(equippedKey(chainId, id));
  } catch {
    return null;
  }
}

export function PetImage({ image, equipped, size = 160, awake = false }: { image: string; equipped?: string | null; size?: number; awake?: boolean }) {
  return (
    <div className={`petimg ${awake ? "awake" : ""}`} style={{ width: size, height: size }}>
      <img src={image} width={size} height={size} alt="Pet" />
      {equipped && <span className="equip" style={{ fontSize: size / 4 }}>{ITEM_EMOJI[equipped] ?? "✨"}</span>}
    </div>
  );
}

export function StatBars({ stats, compare }: { stats: readonly number[]; compare?: readonly number[] }) {
  const max = Math.max(60, ...stats);
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
  return (
    <div className="xp">
      <div className="bar">
        <div style={{ width: `${(Number(pet.xp) / need) * 100}%` }} />
      </div>
      <span className="muted">
        {Number(pet.xp)} / {need} XP bis Level {level + 1}
      </span>
    </div>
  );
}

export function PetCard({ view, chainId, extra }: { view: PetView; chainId: number; extra?: React.ReactNode }) {
  return (
    <Link to={`/pet/${view.id}`} className="card petcard">
      <PetImage image={view.image} equipped={getEquipped(chainId, view.id)} size={96} />
      <div>
        <strong>Pet #{view.id.toString()}</strong>
        <div className="muted">
          Lv {Number(view.pet.level)} · Gen {Number(view.pet.generation)}
        </div>
        <div className="muted small">{STAT_NAMES.map((n, i) => `${n} ${view.pet.stats[i]}`).join(" · ")}</div>
        {extra}
      </div>
    </Link>
  );
}

export function TxStatus({ pending, error }: { pending: string | null; error: string | null }) {
  if (pending) return <div className="toast">⏳ {pending} …</div>;
  if (error) return <div className="toast error">⚠️ {error}</div>;
  return null;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
