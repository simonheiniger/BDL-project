import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

/** Laeuft die Web-App gerade in der Handy-App (Capacitor)? */
export const isNative = Capacitor.isNativePlatform();

/** Basis-URL der Vercel-Functions (/api/relay, /api/rpc). Im Browser leer = gleiche Origin. */
export const API_BASE: string = ((import.meta.env?.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");

/**
 * Links, die die App oeffnen: NFC-Chip (https://<app>/house/<id>#k=...) und Kopplungs-QR (https://<app>/phone#p=...).
 * Liefert auch den Link, mit dem die App gestartet wurde.
 */
let launchHandled = false; // Startlink nur einmal pro App-Prozess auswerten (nicht bei jedem Re-Render)

export function onOpenUrl(cb: (url: URL) => void): () => void {
  const handle = (raw: string) => {
    try {
      cb(new URL(raw));
    } catch {
      /* kein gueltiger Link */
    }
  };
  if (!launchHandled) {
    launchHandled = true;
    CapApp.getLaunchUrl().then((l) => l?.url && handle(l.url)).catch(() => {});
  }
  const sub = CapApp.addListener("appUrlOpen", (e) => handle(e.url));
  return () => {
    sub.then((s) => s.remove()).catch(() => {});
  };
}
