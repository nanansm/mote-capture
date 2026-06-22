import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer/config"),
  base: "./",
  plugins: [
    react(),
    // Electron loads the built renderer over file://, where the `crossorigin`
    // attribute Vite adds to module scripts triggers a CORS check that fails
    // and leaves the window blank. Strip it so the script loads from disk.
    {
      name: "strip-crossorigin",
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin/g, "");
      },
    },
  ],
  resolve: {
    alias: {
      "@capture/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome120",
  },
});
