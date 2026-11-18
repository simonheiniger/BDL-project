import { useLocation } from "react-router-dom";
import { hasWallet, isMobile } from "../nfc";
import { isNative } from "../native";

/** Name der APK unter /public (wird von `npm run native:apk` dorthin kopiert) */
export const APK_URL = "/bdl-pets.apk";

/**
 * Handy-Browser: statt der Web-App muss die Handy-App (APK) heruntergeladen werden.
 * Ausnahmen: die Handy-App selbst, Wallet-Browser (MetaMask: volle Web-App mit Wallet) und /nfc (Chip programmieren).
 */
export function AppGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  if (isNative || !isMobile() || hasWallet() || pathname.startsWith("/nfc")) return <>{children}</>;
  const android = /Android/i.test(navigator.userAgent);
  return (
    <div className="app">
      <main>
        <section className="card hero">
          <h1>🥚 BDL Pets – Handy-App</h1>
          {android ? (
            <>
              <p>Auf dem Handy brauchst du die App. Damit scannst du den NFC-Chip und pflegst deine Tiere.</p>
              <a className="btn" href={APK_URL} download="bdl-pets.apk">
                ⬇️ App herunterladen (APK)
              </a>
              <ol className="small">
                <li>APK herunterladen und öffnen.</li>
                <li>Android fragt, ob dieser Quelle die Installation erlaubt ist: erlauben („Aus dieser Quelle zulassen“).</li>
                <li>Installieren, App öffnen. Danach am PC „Handy koppeln“ und den QR-Code scannen.</li>
              </ol>
              <p className="muted small">
                Schon installiert? Den NFC-Chip des Hauses oder den Kopplungs-QR erneut scannen, dann öffnet sich die App.
              </p>
            </>
          ) : (
            <p>
              Die Handy-App gibt es nur für Android. Auf diesem Gerät bitte die Seite am PC öffnen und dort die App-Funktionen
              nutzen.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
