import { defineConfig, devices } from "@playwright/test";

// T4.3 verification config. Servers (wrangler dev on :8788 + `vite --config
// vite.config.e2e.ts` on :5173, proxying to :8788 instead of the shared
// :8787) are started manually before `playwright test` runs — see the final
// report for the exact commands — so no `webServer` block here.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    // Port 5173 was already taken by the concurrent worker's own `vite dev`
    // (proxying to the shared :8787 instance); this task's `vite --config
    // vite.config.e2e.ts` picked 5174 instead. Update if the dev server logs
    // a different port.
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
