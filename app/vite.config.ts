import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Dev: /api/relay und /api/game lokal bedienen. Auf Vercel uebernehmen api/relay.ts und api/game.ts.
const devRelay = {
  name: "dev-relay",
  configureServer(server: import("vite").ViteDevServer) {
    for (const name of ["relay", "game"]) {
      server.middlewares.use(`/api/${name}`, async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const { POST } = await server.ssrLoadModule(`/api/${name}.ts`);
        const r: Response = await POST(new Request(`http://localhost/api/${name}`, { method: "POST", body: Buffer.concat(chunks).toString() }));
        res.statusCode = r.status;
        res.setHeader("content-type", "application/json");
        res.end(await r.text());
      });
    }
  },
};

export default defineConfig({
  plugins: [
    react(),
    devRelay,
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "BDL Pets",
        short_name: "BDL Pets",
        description: "Phygitales Web3-Tamagotchi (ZHAW BDL HS26)",
        theme_color: "#1f1d2e",
        background_color: "#1f1d2e",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
});
