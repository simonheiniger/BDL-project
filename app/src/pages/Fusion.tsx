import { useState } from "react";
import { useContracts } from "../contracts";
import { fusePreview } from "../gamemath";
import { loadPet, useChainQuery, useInventory, useMyPets, useTx } from "../hooks";
import { NftCard, StatBars, TxStatus } from "../components/common";

const MIN_LEVEL = 5;

export default function Fusion() {
  const c = useContracts();
  const { data: ids } = useMyPets();
  const { data: views } = useChainQuery(
    ["fusionViews", ids?.join(",")],
    async (pc, c) => (await Promise.all(ids!.map((id) => loadPet(pc, c, id)))).filter((v) => v !== null),
    !!ids,
  );
  const [keepId, setKeepId] = useState<string>("");
  const [burnId, setBurnId] = useState<string>("");
  const tx = useTx();

  const eligible = views?.filter((v) => Number(v.pet.level) >= MIN_LEVEL) ?? [];
  const keep = eligible.find((v) => v.id.toString() === keepId);
  const burn = eligible.find((v) => v.id.toString() === burnId);
  const { data: burnInv } = useInventory(burn?.account);
  const preview =
    keep && burn && keep.id !== burn.id
      ? fusePreview(
          { ...keep.pet, level: Number(keep.pet.level), xp: Number(keep.pet.xp), fusionCount: Number(keep.pet.fusionCount), stats: keep.pet.stats.map(Number) },
          { ...burn.pet, level: Number(burn.pet.level), xp: Number(burn.pet.xp), fusionCount: Number(burn.pet.fusionCount), stats: burn.pet.stats.map(Number) },
        )
      : null;

  const select = (value: string, set: (s: string) => void, label: string) => (
    <label className="grow">
      {label}
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">– wählen –</option>
        {eligible.map((v) => (
          <option key={v.id.toString()} value={v.id.toString()}>
            Pet #{v.id.toString()} (Lv {Number(v.pet.level)})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <h2>Fusion 2 → 1</h2>
      <p className="muted">
        Zwei eigene Pets ab Level {MIN_LEVEL} verschmelzen. Das zweite Pet wird <strong>verbrannt</strong>; sein ganzes
        Inventar (Cosmetics, Trophäen, ETH) wandert automatisch in die Wallet des ersten.
      </p>
      <TxStatus {...tx} />
      {eligible.length < 2 && <p className="card warn">Du brauchst mindestens zwei Pets mit Level ≥ {MIN_LEVEL}.</p>}
      <div className="row">
        {select(keepId, setKeepId, "Bleibt bestehen")}
        {select(burnId, setBurnId, "Wird verbrannt 🔥")}
      </div>

      {keep && burn && keep.id === burn.id && <p className="card warn">Zwei verschiedene Pets wählen.</p>}

      {preview && keep && burn && (
        <section className="card">
          <div className="row fusionrow">
            <NftCard view={keep} size="sm" link={false} />
            <span className="big">+</span>
            <NftCard view={burn} size="sm" link={false} />
            <span className="big">→</span>
            <div>
              <strong>Pet #{keep.id.toString()}</strong>
              <div>
                Level {Number(keep.pet.level)} → <strong>{preview.level}</strong> ({preview.xp} XP)
              </div>
              <div className="muted small">Fusion #{preview.fusionCount} · {preview.burnedPct}% XP-Wert vernichtet (Token-Sink)</div>
            </div>
          </div>
          <StatBars stats={preview.stats} compare={keep.pet.stats.map(Number)} />
          <p className="muted small">
            Vererbung: Stat = max + 30% × min / (1 + bisherige Fusionen) · XP = XP₁ + 50% × XP₂
          </p>
          <p className="small">
            🧬 Aussehen: Jedes der 7 Gene (Farbe, Form, Kopf, Augen, Mund, Muster, Hintergrund) kommt zufällig von einem
            der beiden Eltern – mit 1/16 Chance pro Gen auf eine <strong>Mutation</strong>. Mit Glück entsteht ein
            seltenerer Look. Das Fusions-Juwel zeigt, dass das Pet aus einer Fusion stammt.
          </p>
          {burnInv && (
            <p className="small">
              Migration aus Pet #{burn.id.toString()}: {burnInv.cosmetics.reduce((a, c) => a + Number(c.amount), 0)} Cosmetics,{" "}
              {burnInv.trophies.length} Trophäen, {(Number(burnInv.eth) / 1e18).toFixed(4)} ETH
            </p>
          )}
          <button
            className="btn danger"
            disabled={!!tx.pending || !c}
            onClick={async () => {
              if (!confirm(`Pet #${burn.id} wird unwiderruflich verbrannt. Fortfahren?`)) return;
              const ok = await tx.send("Fusion", { ...c!.PetNFT, functionName: "fuse", args: [keep.id, burn.id] });
              if (ok) setBurnId("");
            }}
          >
            🔥 Verschmelzen
          </button>
        </section>
      )}
    </>
  );
}
