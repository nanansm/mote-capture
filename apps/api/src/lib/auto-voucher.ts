// Voucher otomatis (PRD bagian 6): uang sudah masuk tapi sesi tidak berjalan.
// Sumber: auto-late-payment (webhook PAID setelah expired), auto-abandoned
// (alarm paid/capturing), staff-cancel (staf membatalkan sesi berbayar).
//
// Idempoten per (sessionId, source) lewat unique index parsial di migrasi
// 0002: webhook yang diulang Xendit atau alarm yang jalan dua kali tidak
// menerbitkan voucher kedua; pemanggil menerima voucher yang sudah ada.
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { schema } from "@/db";

export type AutoVoucherSource = "auto-late-payment" | "auto-abandoned" | "staff-cancel";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa 0/O/1/I

export function generateVoucherCode(length = 8): string {
  // Tolak byte >= 256 - (256 % 32) = 256 (32 membagi 256), jadi modulo tanpa bias.
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return s;
}

export type AutoVoucher = { id: string; code: string; created: boolean };

export async function issueAutoVoucher(
  db: Database,
  input: { sessionId: string; source: AutoVoucherSource; amount: number; reason?: string },
): Promise<AutoVoucher> {
  const existing = await findAutoVoucher(db, input.sessionId, input.source);
  if (existing) return { ...existing, created: false };

  // Kode UNIQUE; 32^8 kombinasi, jadi tabrakan nyaris mustahil, tapi tetap
  // dicoba ulang beberapa kali sebelum menyerah.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `VCH-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const code = generateVoucherCode();
    try {
      await db.insert(schema.vouchers).values({
        id,
        code,
        type: "payment",
        value: input.amount,
        limit: 1,
        status: "active",
        expiresAt: null,
        batchId: null,
        createdBy: `system:${input.source}`,
        source: input.source,
        sourceSessionId: input.sessionId,
        metadata: input.reason ? { reason: input.reason } : {},
      });
      return { id, code, created: true };
    } catch (err) {
      // Pemanggil lain menang duluan untuk (sessionId, source): pakai miliknya.
      const raced = await findAutoVoucher(db, input.sessionId, input.source);
      if (raced) return { ...raced, created: false };
      const msg = err instanceof Error ? err.message : String(err);
      if (!/UNIQUE/i.test(msg)) throw err;
      // tabrakan kode: ulangi dengan kode baru
    }
  }
  throw new Error("auto_voucher_code_exhausted");
}

// Sesi yang berakhir tanpa pernah dibayar. PAID yang datang untuk status ini =
// uang masuk terlambat (PRD bagian 8 #5). `paidAt` ikut diperiksa supaya sesi
// berbayar yang kemudian di-reset admin (failed) tidak dianggap terlambat.
export const UNPAID_CLOSED_STATUSES: ReadonlySet<string> = new Set(["expired", "failed", "cancelled"]);

export function isLatePayment(session: { status: string; paidAt: Date | null }): boolean {
  return UNPAID_CLOSED_STATUSES.has(session.status) && !session.paidAt;
}

// Satu jalur untuk webhook Xendit asli dan mock-pay dev (uji A5).
export async function recordLatePayment(
  db: Database,
  session: { id: string; amount: number },
  input: { provider: string; rawPayload?: Record<string, unknown> | null; paidAmount?: number | null },
): Promise<AutoVoucher> {
  const voucher = await issueAutoVoucher(db, {
    sessionId: session.id,
    source: "auto-late-payment",
    amount: session.amount,
    reason: "EXPIRED_PAID",
  });
  await db.insert(schema.paymentLogs).values({
    sessionId: session.id,
    provider: input.provider,
    eventType: voucher.created ? "late_payment_voucher" : "late_payment_duplicate",
    payload: { ...(input.rawPayload ?? {}), voucherId: voucher.id, paidAmount: input.paidAmount ?? null },
  });
  return voucher;
}

export async function findAutoVoucher(db: Database, sessionId: string, source: AutoVoucherSource) {
  const [row] = await db
    .select({ id: schema.vouchers.id, code: schema.vouchers.code })
    .from(schema.vouchers)
    .where(and(eq(schema.vouchers.sourceSessionId, sessionId), eq(schema.vouchers.source, source)))
    .limit(1);
  return row ?? null;
}
