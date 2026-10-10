// Siapkan D1 lokal terisolasi untuk e2e kiosk: hapus state lama, jalankan
// migrasi, seed booth + frame v2 + voucher. Dipanggil oleh webServer wrangler
// di playwright.kiosk.config.ts SEBELUM `wrangler dev` start.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "../../../api");
export const PERSIST = path.resolve(apiDir, ".wrangler/e2e-kiosk");

export const SEED = {
  boothId: "BOOTH-E2E",
  bridgeToken: "e2e-bridge-token",
  frameId: "FRAME-E2E-V2",
  frame2Id: "FRAME-E2E-V2B",
  voucherFull: "E2EFULL1",
  price: 30000,
};

const layout = JSON.stringify({
  version: 2,
  canvasWidth: 1200,
  canvasHeight: 1800,
  slots: [
    { x: 60, y: 120, w: 525, h: 350 },
    { x: 615, y: 120, w: 525, h: 350 },
    { x: 60, y: 500, w: 525, h: 350 },
    { x: 615, y: 500, w: 525, h: 350 },
  ],
  artworkKey: null,
}).replace(/'/g, "''");

const sql = `
INSERT INTO booths (id, name, location, default_price, payment_provider, bridge_token, is_active)
  VALUES ('${SEED.boothId}', 'Booth E2E', 'Lab', ${SEED.price}, 'xendit', '${SEED.bridgeToken}', 1);
INSERT INTO frames (id, name, tier, price, layout_json, booth_id, is_active, is_default, sort_order)
  VALUES ('${SEED.frameId}', 'Frame E2E Oranye', 'regular', ${SEED.price}, '${layout}', NULL, 1, 1, 0);
INSERT INTO frames (id, name, tier, price, layout_json, booth_id, is_active, is_default, sort_order)
  VALUES ('${SEED.frame2Id}', 'Frame E2E Hijau', 'regular', ${SEED.price}, '${layout}', NULL, 1, 0, 1);
INSERT INTO booth_frames (booth_id, frame_id, price, is_active, is_default, sort_order)
  VALUES ('${SEED.boothId}', '${SEED.frameId}', ${SEED.price}, 1, 1, 0),
         ('${SEED.boothId}', '${SEED.frame2Id}', ${SEED.price}, 1, 0, 1);
INSERT INTO vouchers (id, code, type, value, "limit", used_count, status)
  VALUES ('VCH-E2E-FULL', '${SEED.voucherFull}', 'payment', ${SEED.price}, 1000, 0, 'active');
`;

function wrangler(args) {
  execFileSync("npx", ["wrangler", ...args], { cwd: apiDir, stdio: ["ignore", "ignore", "inherit"] });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.rmSync(PERSIST, { recursive: true, force: true });
  wrangler(["d1", "migrations", "apply", "mote-capture", "--local", "--persist-to", PERSIST]);
  const f = path.join(PERSIST, "seed.sql");
  fs.writeFileSync(f, sql);
  wrangler(["d1", "execute", "mote-capture", "--local", "--persist-to", PERSIST, "--file", f]);
  console.log("e2e D1 siap:", PERSIST);
}
