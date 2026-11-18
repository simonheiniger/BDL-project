import { useQuery } from "@tanstack/react-query";

// Vorgerendert von contracts/scripts/prerender-gallery.ts: der PetRenderer (gleicher Code wie on-chain) erzeugt
// jedes Bild einmal -> die Seite laedt sofort statt 33 teure tokenURI-Aufrufe auf dem Kurs-Node.
type Manifest = { title: string; items: { label: string; file: string }[] }[];

export default function Galerie() {
  const { data } = useQuery({
    queryKey: ["galerie-manifest"],
    queryFn: async () => (await fetch("/gallery/manifest.json")).json() as Promise<Manifest>,
    staleTime: Infinity,
  });

  return (
    <>
      <h2>Galerie</h2>
      <p className="muted">Pixel-Art aus dem on-chain Renderer – jedes Bild entsteht aus derselben DNA-Logik wie deine Pets.</p>
      {data?.map(({ title, items }) => (
        <section key={title}>
          <h3>{title}</h3>
          <div className="gal3d">
            {items.map((it) => (
              <figure key={it.label}>
                <img className="pixel" src={`/gallery/${it.file}`} alt={it.label} loading="lazy" />
                <figcaption>{it.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
