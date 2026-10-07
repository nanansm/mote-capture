import { env } from "cloudflare:test";
import { DEFAULT_LAYOUT_V2 } from "@capture/shared";

// Seed helpers. Raw SQL ke D1 lokal (Miniflare), skema dari migrations/.
// Tiap test file dapat D1 terisolasi, jadi id tetap aman dipakai ulang.

export const BOOTH_ID = "BTH-TEST";
export const BRIDGE_TOKEN = "bridge-token-test";

let seq = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export async function seedBooth(over: Partial<{ id: string; isActive: boolean; token: string }> = {}) {
  const id = over.id ?? BOOTH_ID;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO booths (id, name, default_price, payment_provider, bridge_token, is_active, metadata)
     VALUES (?, ?, 30000, 'xendit', ?, ?, '{}')`,
  )
    .bind(id, `Booth ${id}`, over.token ?? `${BRIDGE_TOKEN}-${id}`, over.isActive === false ? 0 : 1)
    .run();
  return id;
}

export async function seedFrame(
  over: Partial<{ id: string; boothId: string | null; layout: unknown; price: number; isActive: boolean }> = {},
) {
  const id = over.id ?? uid("FRM");
  await env.DB.prepare(
    `INSERT INTO frames (id, name, tier, price, background_key, layout_json, booth_id, is_active)
     VALUES (?, ?, 'regular', ?, 'backgrounds/test.png', ?, ?, ?)`,
  )
    .bind(
      id,
      `Frame ${id}`,
      over.price ?? 30000,
      JSON.stringify(over.layout ?? DEFAULT_LAYOUT_V2),
      over.boothId === undefined ? null : over.boothId,
      over.isActive === false ? 0 : 1,
    )
    .run();
  return id;
}

export async function seedSession(
  over: Partial<{
    id: string;
    boothId: string;
    status: string;
    amount: number;
    paymentRef: string | null;
    paidAt: number | null;
    createdAt: number;
    metadata: Record<string, unknown>;
    downloadToken: string | null;
  }> = {},
) {
  const id = over.id ?? uid("SES");
  await env.DB.prepare(
    `INSERT INTO sessions (id, booth_id, status, amount, payment_provider, payment_ref, paid_at, metadata, created_at, download_token)
     VALUES (?, ?, ?, ?, 'xendit', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      over.boothId ?? BOOTH_ID,
      over.status ?? "payment",
      over.amount ?? 30000,
      over.paymentRef === undefined ? `ref-${id}` : over.paymentRef,
      over.paidAt ?? null,
      JSON.stringify(over.metadata ?? {}),
      over.createdAt ?? Date.now(),
      over.downloadToken ?? null,
    )
    .run();
  return id;
}

export async function getSessionRow(id: string) {
  return env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<Record<string, unknown>>();
}
