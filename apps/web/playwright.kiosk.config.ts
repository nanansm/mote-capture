import { defineConfig, devices } from "@playwright/test";

// E2E kiosk M2. Rig lengkap dinyalakan otomatis:
//   1. wrangler dev (apps/api) :8790 dengan D1 lokal terisolasi (.wrangler/e2e-kiosk)
//      yang di-reset + di-seed oleh e2e/kiosk/setup-db.mjs. Xendit tanpa key =
//      QR mock; pembayaran disimulasikan lewat POST /api/dev/mock-pay/:id.
//   2. mock booth-agent :9877 (e2e/kiosk/mock-agent.mjs) yang memanggil bridge
//      cloud SUNGGUHAN di :8790.
//   3. vite :5190 proxy /api + /ws ke :8790, VITE_AGENT_URL ke mock agent.
// Jalankan: pnpm --filter web exec playwright test -c playwright.kiosk.config.ts
const API_PORT = 8790;
const WEB_PORT = 5190;
const AGENT_PORT = 9877;

export default defineConfig({
  testDir: "./e2e/kiosk",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // satu booth, satu DO: tes berurutan
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-kiosk" }]],
  outputDir: "test-results-kiosk",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 }, // PM161QT 15.6" landscape, skala
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command:
        `node e2e/kiosk/setup-db.mjs && cd ../api && npx wrangler dev --port ${API_PORT} --ip 127.0.0.1 ` +
        `--persist-to .wrangler/e2e-kiosk --inspector-port 9239 --var APP_URL:http://localhost:${WEB_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "node e2e/kiosk/mock-agent.mjs",
      url: `http://127.0.0.1:${AGENT_PORT}/health`,
      env: { MOCK_AGENT_PORT: String(AGENT_PORT), MOCK_CLOUD_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://localhost:${WEB_PORT}`,
      env: {
        API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
        VITE_AGENT_URL: `http://127.0.0.1:${AGENT_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
