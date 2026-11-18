// Handy-App bauen: Web-App im Modus "native" bauen, Android-Projekt anlegen/synchronisieren, App-Link eintragen.
//   APP_URL=https://meine-app.vercel.app npm run native:build        (APP_URL = Vercel-Domain der PC-App)
// Danach: npm run native:apk  (debug-APK)  oder  npx cap open android  (Android Studio)
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

const envFile = readFileSync(".env.native", "utf8");
const fromFile = /^VITE_API_BASE=(.+)$/m.exec(envFile)?.[1]?.trim();
const appUrl = (process.env.APP_URL ?? fromFile ?? "").replace(/\/$/, "");
if (!/^https:\/\/[^/\s]+$/.test(appUrl)) throw new Error(`APP_URL muss https://<host> sein, ist: "${appUrl}"`);
const host = new URL(appUrl).host;

run("npx tsc -b");
run("npx vite build --mode native", { VITE_API_BASE: appUrl });
// Die heruntergeladene APK (public/bdl-pets.apk) gehoert nicht in die APK selbst
rmSync("dist/bdl-pets.apk", { force: true });
if (!existsSync("android")) run("npx cap add android");
run("npx cap sync android");

// App-Link: NFC-Chip-URLs (https://<host>/house/...) und Kopplungs-QR (https://<host>/phone) oeffnen die App
const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = readFileSync(manifestPath, "utf8");
const block = `<!-- bdl-applink -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${host}" android:pathPrefix="/house/" />
                <data android:scheme="https" android:host="${host}" android:path="/phone" />
            </intent-filter>
            <!-- /bdl-applink -->`;
if (manifest.includes("<!-- bdl-applink -->")) {
  manifest = manifest.replace(/<!-- bdl-applink -->[\s\S]*?<!-- \/bdl-applink -->/, block);
} else {
  const marker = "</activity>";
  if (!manifest.includes(marker)) throw new Error("AndroidManifest.xml: <activity> nicht gefunden");
  manifest = manifest.replace(marker, `    ${block}\n        ${marker}`);
}
if (!/usesCleartextTraffic="true"/.test(manifest)) {
  manifest = manifest.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
}
// Der Caretaker-Schluessel liegt im App-Speicher: nicht in Cloud-Backups
manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
writeFileSync(manifestPath, manifest);
console.log(`\nApp-Link fuer https://${host} eingetragen. Weiter: npm run native:apk`);
