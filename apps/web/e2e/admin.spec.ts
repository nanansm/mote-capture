import { test, expect } from "@playwright/test";

// T4.3 verification flow. Run against a locally seeded backend (see the
// final report for exact setup) — booth_e2e_01 / frame_e2e_01 /
// session_e2e_01 must exist (scratchpad/seed-t43.sql).
//
// Everything runs as a single `test()` with `test.step()` phases sharing one
// `page` (and therefore one cookie jar) — Playwright's `describe.serial`
// only orders separate tests, it does not share browser context/cookies
// between them, so a multi-test version would re-hit the login guard on
// every step after the first.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "devpassword123";

test("admin flow: guard -> login -> dashboard -> booths -> create booth -> frames -> sessions -> detail -> voucher", async ({
  page,
}) => {
  await test.step("guard redirects an unauthenticated visitor to /login", async () => {
    await page.goto("/admin/booths");
    await expect(page).toHaveURL(/\/login\?from=%2Fadmin%2Fbooths/);
    await page.screenshot({
      path: "e2e/screenshots/01-guard-redirect-to-login.png",
      fullPage: true,
    });
  });

  await test.step("login redirects back to the originally requested page", async () => {
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();

    await expect(page).toHaveURL(/\/admin\/booths$/);
    await expect(page.getByText("Booth E2E Test")).toBeVisible();
    await page.screenshot({
      path: "e2e/screenshots/02-login-redirected-back-to-booths.png",
      fullPage: true,
    });
  });

  await test.step("dashboard shows live aggregate stats", async () => {
    await page.goto("/admin/dashboard");
    await expect(page.getByText("Booth Aktif")).toBeVisible();
    await expect(page.getByText("Pendapatan Bulan Ini")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/03-dashboard.png", fullPage: true });
  });

  await test.step("booth list renders the seeded booth", async () => {
    await page.goto("/admin/booths");
    await expect(page.getByText("Booth E2E Test")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/04-booths-list.png", fullPage: true });
  });

  await test.step("create a new booth end-to-end", async () => {
    // Unique name per run — the API has no test-reset endpoint, so a fixed
    // name would collide (ambiguous locator) on a second local re-run.
    const boothName = `Booth Playwright ${Date.now()}`;
    await page.goto("/admin/booths/new");
    await page.getByLabel("Name").fill(boothName);
    await page.getByLabel("Location").fill("Jakarta Selatan");
    await page.getByLabel(/Default Price/).fill("35000");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL(/\/admin\/booths$/);
    await expect(page.getByText(boothName)).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/05-booth-created.png", fullPage: true });
  });

  await test.step("frame list renders the seeded frame", async () => {
    await page.goto("/admin/frames");
    await expect(page.getByText("Frame E2E Test")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/06-frames-list.png", fullPage: true });
  });

  await test.step("sessions list renders the seeded session and links to its detail page", async () => {
    await page.goto("/admin/sessions");
    await expect(page.getByText("session_e2e_01")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/07-sessions-list.png", fullPage: true });

    // Target the row for the specific seeded session by id — the table is
    // sorted by createdAt desc, and other sessions may have been seeded
    // separately (e.g. for the 425 "not ready" manual check), so `.first()`
    // is not reliable.
    await page
      .getByRole("row", { name: /session_e2e_01/ })
      .getByRole("link", { name: "Detail" })
      .click();
    await expect(page).toHaveURL(/\/admin\/sessions\/session_e2e_01$/);
    await expect(page.getByText("Booth E2E Test")).toBeVisible();
    await expect(page.getByText("Foto (2)")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/08-session-detail.png", fullPage: true });
  });

  await test.step("voucher page renders the generator and the seeded voucher", async () => {
    await page.goto("/admin/voucher");
    await expect(page.getByRole("heading", { name: "Voucher", exact: true })).toBeVisible();
    await expect(page.getByText("E2ETEST1")).toBeVisible();
    await page.screenshot({ path: "e2e/screenshots/09-voucher.png", fullPage: true });
  });
});
