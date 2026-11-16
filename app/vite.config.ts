import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
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
