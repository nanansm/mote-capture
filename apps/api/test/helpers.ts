import { env } from "cloudflare:test";
import { DEFAULT_LAYOUT_V2 } from "@capture/shared";
import { encryptSecret } from "@/lib/secret-box";

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

// Akun pembayaran terenkripsi (format sama dengan lib/payment-accounts.ts).
export async function seedPaymentAccount(over: {
  id?: string;
  provider: "xendit" | "ipaymu" | "doku";
  mode?: "production" | "sandbox";
  secrets: Record<string, string>;
}) {
  const id = over.id ?? uid("PAY");
  const sealed = await encryptSecret(JSON.stringify(over.secrets), env.SETTINGS_ENC_KEY as string);
  await env.DB.prepare(
    `INSERT INTO payment_accounts (id, name, provider, mode, credentials) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, `Akun ${id}`, over.provider, over.mode ?? "production", sealed)
    .run();
  return id;
}

export async function useAccount(boothId: string, accountId: string | null, provider = "xendit") {
  await env.DB.prepare("UPDATE booths SET payment_account_id = ?, payment_provider = ? WHERE id = ?")
    .bind(accountId, provider, boothId)
    .run();
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
  // 0004: frame tampil di booth hanya lewat booth_frames.
  if (over.boothId) await linkFrame(over.boothId, id, { price: over.price ?? 30000 });
  return id;
}

export async function linkFrame(
  boothId: string,
  frameId: string,
  over: Partial<{ price: number; isActive: boolean; isDefault: boolean; sortOrder: number }> = {},
) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO booth_frames (booth_id, frame_id, price, is_active, is_default, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      boothId,
      frameId,
      over.price ?? 30000,
      over.isActive === false ? 0 : 1,
      over.isDefault ? 1 : 0,
      over.sortOrder ?? 0,
    )
    .run();
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
    provider: string;
    accountId: string | null;
  }> = {},
) {
  const id = over.id ?? uid("SES");
  await env.DB.prepare(
    `INSERT INTO sessions (id, booth_id, status, amount, payment_provider, payment_account_id, payment_ref, paid_at, metadata, created_at, download_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      over.boothId ?? BOOTH_ID,
      over.status ?? "payment",
      over.amount ?? 30000,
      over.provider ?? "xendit",
      over.accountId ?? null,
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
