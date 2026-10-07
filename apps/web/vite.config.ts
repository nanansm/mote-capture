import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// apps/web — SPA served by Cloudflare Workers Static Assets (see
// apps/api/wrangler.jsonc). `pnpm dev` here talks to a locally running
// `wrangler dev` (apps/api) via the proxy below; `pnpm build` outputs to
// ../api's configured assets directory (apps/web/dist).
// Rig e2e kiosk mengarahkan proxy ke wrangler dev terisolasi (port lain).
const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
      "/ws": {
        target: API_TARGET,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
