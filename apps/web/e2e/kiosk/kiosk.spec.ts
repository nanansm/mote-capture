import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// E2E kiosk M2 melawan rig nyata: wrangler dev (DO + D1 lokal) + mock agent.
// Konstanta harus sama dengan e2e/kiosk/setup-db.mjs.
const BOOTH = "BOOTH-E2E";
const VOUCHER_FULL = "E2EFULL1";
const AGENT = "http://127.0.0.1:9877";
const API = "http://127.0.0.1:8790";

const kiosk = (page: Page) => page.getByTestId("kiosk");
const expectState = (page: Page, state: string, timeout = 15_000) =>
  expect(kiosk(page)).toHaveAttribute("data-state", state, { timeout });

async function resetRig(request: APIRequestContext) {
  await request.post(`${AGENT}/__mock/reset`);
}

async function openKiosk(page: Page) {
  await page.goto(`/kiosk/${BOOTH}`);
  await expectState(page, "IDLE", 30_000);
}

/** IDLE -> PILIH_FRAME -> KONFIRMASI. */
async function pickFrame(page: Page) {
  await page.getByTestId("idle-start").click();
  await expectState(page, "PILIH_FRAME");
  await page.getByTestId("frame-option").first().click();
  await expectState(page, "KONFIRMASI");
}

async function sessionIdOf(page: Page): Promise<string> {
  await expect(kiosk(page)).not.toHaveAttribute("data-session-id", "", { timeout: 15_000 });
  return (await kiosk(page).getAttribute("data-session-id"))!;
}

/** Bayar QRIS via endpoint dev mock-pay (jalur markPaid yang sama dengan webhook Xendit). */
async function payQris(page: Page, request: APIRequestContext): Promise<string> {
  await page.getByTestId("method-qris").click();
  await expectState(page, "PAYMENT");
  await expect(page.getByTestId("payment-qr")).toBeVisible();
  const sid = await sessionIdOf(page);
  const r = await request.post(`${API}/api/dev/mock-pay/${sid}`);
  expect(r.status()).toBe(200);
  await expectState(page, "PEMBAYARAN_OK");
  return sid;
}

/** Jalankan 4 foto. `retakeSlot` = slot yang di-retake sekali. */
async function shootFour(page: Page, retakeSlot?: number) {
  await page.getByTestId("start-capture").click();
  for (let slot = 1; slot <= 4; slot++) {
    // GET_READY 10s (foto 1) + countdown 5s + shutter.
    await expect(page.getByTestId("state-review")).toHaveAttribute("data-slot", String(slot), { timeout: 30_000 });
    if (retakeSlot === slot) {
      await page.getByTestId("retake").click();
      await expect(page.getByTestId("state-review")).toHaveAttribute("data-slot", String(slot), { timeout: 30_000 });
      // Retake hanya 1x per foto.
      await expect(page.getByTestId("retake")).toHaveCount(0);
    }
    await page.getByTestId("review-next").click();
  }
}

test.beforeEach(async ({ request }) => {
  await resetRig(request);
});

test("QRIS happy path: frame, bayar, 4 foto + 1 retake, compose, done", async ({ page, request }) => {
  await openKiosk(page);
  await pickFrame(page);
  const sid = await payQris(page, request);
  await shootFour(page, 2);
  await expectState(page, "DONE", 20_000);
  await expect(page.getByTestId("done-composite")).toBeVisible();
  await expect(page.getByTestId("done-qr")).toBeVisible();

  const log = (await (await request.get(`${AGENT}/__mock/log`)).json()) as { method: string; path: string; status?: number }[];
  const paths = log.map((l) => `${l.method} ${l.path}`);
  expect(paths).toContain("POST /session/start");
  expect(paths.filter((p) => /\/capture$/.test(p))).toHaveLength(4);
  expect(paths.filter((p) => /\/retake$/.test(p))).toHaveLength(1);
  expect(log.find((l) => l.path === "done")?.status).toBe(200);
  expect(sid).toMatch(/^SES-/);

  await page.getByTestId("done-finish").click();
  await expectState(page, "IDLE");
});

test("voucher: 1 kode salah dihitung, kode full-cover lolos ke PEMBAYARAN_OK", async ({ page }) => {
  await openKiosk(page);
  await pickFrame(page);
  await page.getByTestId("method-voucher").click();
  await expectState(page, "VOUCHER_INPUT");
  await sessionIdOf(page);

  await page.keyboard.type("SALAH99");
  await page.getByTestId("voucher-submit").click();
  await expect(page.getByTestId("voucher-error")).toBeVisible();
  await expectState(page, "VOUCHER_INPUT");

  await page.keyboard.press("Escape");
  await page.keyboard.type(VOUCHER_FULL);
  await page.getByTestId("voucher-submit").click();
  await expectState(page, "PEMBAYARAN_OK", 15_000);
});

test("kamera putus saat sesi: CALL_STAFF, staf PIN + reset kamera, lanjut ke slot yang sama", async ({ page, request }) => {
  await openKiosk(page);
  await pickFrame(page);
  await payQris(page, request);
  await request.post(`${AGENT}/__mock/fail-next-capture`);
  await page.getByTestId("start-capture").click();
  await expectState(page, "CALL_STAFF", 30_000);

  await page.getByTestId("call-staff-open").click();
  await expect(page.getByTestId("staff-panel")).toBeVisible();
  // PIN salah dulu: sisa percobaan tampil.
  for (const d of "9999") await page.getByTestId(`pin-${d}`).click();
  await expect(page.getByTestId("pin-message")).toContainText("4");
  for (const d of "1234") await page.getByTestId(`pin-${d}`).click();
  await page.getByTestId("staff-camera-reset").click();
  await expect(page.getByTestId("staff-panel")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("state-review")).toHaveAttribute("data-slot", "1", { timeout: 30_000 });
});

test("staf batalkan sesi berbayar: voucher pengganti terbit, kiosk kembali IDLE", async ({ page, request }) => {
  await openKiosk(page);
  await pickFrame(page);
  await payQris(page, request);
  await request.post(`${AGENT}/__mock/camera`, { data: { connected: false } });
  await page.getByTestId("start-capture").click();
  await expectState(page, "CALL_STAFF", 30_000);

  await page.getByTestId("call-staff-open").click();
  for (const d of "1234") await page.getByTestId(`pin-${d}`).click();
  await page.getByTestId("staff-cancel-voucher").click();
  await expect(page.getByTestId("staff-message")).toContainText(/[A-Z0-9]{6,}/, { timeout: 10_000 });
  const log = (await (await request.get(`${AGENT}/__mock/log`)).json()) as { path: string; status?: number }[];
  expect(log.find((l) => l.path === "cancel-voucher")?.status).toBe(200);
  await page.getByTestId("staff-exit").click();
  await expectState(page, "IDLE");
});

test("tab kedua di booth sibuk: BOOTH_BUSY, tidak bisa curi sesi", async ({ page, browser, request }) => {
  await openKiosk(page);
  await pickFrame(page);
  await payQris(page, request);

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const p2 = await ctx2.newPage();
  await p2.goto(`/kiosk/${BOOTH}`);
  // Tab kedua melihat sesi aktif -> tidak boleh mulai sesi baru.
  await expect(p2.getByTestId("kiosk")).toHaveAttribute("data-state", /BOOTH_BUSY|IDLE/, { timeout: 30_000 });
  if ((await p2.getByTestId("kiosk").getAttribute("data-state")) === "IDLE") {
    await pickFrame(p2);
    await p2.getByTestId("method-qris").click();
    await expect(p2.getByTestId("kiosk")).toHaveAttribute("data-state", "BOOTH_BUSY", { timeout: 15_000 });
  }
  await expect(p2.getByTestId("busy-time")).toBeVisible();
  await ctx2.close();
  // Tab pertama tidak terganggu.
  await expectState(page, "PEMBAYARAN_OK");
});

test("QR kedaluwarsa tanpa bayar: kembali ke IDLE", async ({ page }) => {
  test.setTimeout(120_000);
  await openKiosk(page);
  await pickFrame(page);
  await page.getByTestId("method-qris").click();
  await expectState(page, "PAYMENT");
  await sessionIdOf(page);
  // QR 1 menit (SESSION_TIMING.QR_EXPIRY_MS).
  await expect(kiosk(page)).not.toHaveAttribute("data-state", "PAYMENT", { timeout: 75_000 });
  await expectState(page, "IDLE", 10_000);
});
