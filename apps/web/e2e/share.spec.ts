import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Verifies the PUBLIC /share/:token page (no login) and the client-side
// (fflate) zip build for "Download Semua". Needs `session_e2e_01` /
// `share-token-e2e-01` seeded with 2 non-final photos (scratchpad/
// seed-t43.sql) and PUBLIC_CDN_URL pointed at the throwaway CORS-enabled
// static file server serving those 2 fake photos (see final report).
test("share page displays photos and \"Download Semua\" builds a real zip", async ({ page }) => {
  await page.goto("/share/share-token-e2e-01");

  await expect(page.getByText("Foto Kamu Sudah Siap!")).toBeVisible();
  // Both seeded photos rendered as individual downloads (isFinal: false for
  // both -> no composite button, just the "Foto 1"/"Foto 2" thumbnails).
  await expect(page.getByText("Foto 1")).toBeVisible();
  await expect(page.getByText("Foto 2")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/12-share-page.png", fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Semua (.zip)" }).click(),
  ]);

  const zipPath = "e2e/screenshots/session_e2e_01-download.zip";
  await download.saveAs(zipPath);

  const buf = readFileSync(zipPath);
  // Minimal structural check without a zip library: a real, non-empty zip
  // starts with the local-file-header signature "PK\x03\x04". The
  // exhaustive check ("does it really contain both photos") is done outside
  // Playwright with `unzip -l` — see the final report for that output.
  expect(buf.length).toBeGreaterThan(0);
  expect(buf.subarray(0, 4).toString("hex")).toBe("504b0304");
});
