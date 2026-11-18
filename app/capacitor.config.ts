import type { CapacitorConfig } from "@capacitor/cli";

// Handy-App (Companion): dieselbe Web-App, im nativen WebView. Nur Pflegen/Fuettern, alles Wichtige bleibt am PC.
const config: CapacitorConfig = {
  appId: "ch.zhaw.bdl.pets",
  appName: "BDL Pets",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Kurs-RPC ist nur ueber http erreichbar (Pflege-Transaktionen gehen direkt dorthin)
    cleartext: true,
  },
  plugins: {
    // fetch/XHR laufen nativ: kein CORS, kein Mixed-Content-Block fuer die http-RPC
    CapacitorHttp: { enabled: true },
  },
};

export default config;
