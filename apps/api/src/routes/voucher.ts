import { Hono } from "hono";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Bindings } from "@/lib/env";
import { getDb, schema } from "@/db";
import { logger } from "@/lib/logger";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { markPaid } from "@/do/rpc";

// Ported from apps/cloud/app/api/admin/voucher/{generate,list,export,[id]}/route.ts
// and apps/cloud/app/api/voucher/redeem/route.ts.
//
// Two changes from the old (Postgres) implementation, both required by D1:
//
//   1. `db.transaction()` is not supported by drizzle-d1 (no interactive
//      transactions over HTTP). The redeem endpoint instead uses a single
//      conditional UPDATE as the atomicity guard (WHERE status = 'active' AND
//      quota not exhausted AND not expired) and inspects `meta.changes` to
//      decide whether THIS request won the race. Only the winner proceeds to
//      write the redemption ledger row and call markPaid.
//
//   2. This route never touches `sessions` (or `photos`) — BoothDO is the
//      sole writer for those tables in the new architecture. Marking a
//      session paid after a successful voucher redemption goes through the
//      `markPaid` RPC stub (`@/do/rpc`) instead of `db.update(schema.sessions)`.
//      `sessions` is only ever *read* here (to fetch amount/boothId/status).

// ---------------------------------------------------------------------------
// ID / code generation (Web Crypto only — no node:crypto, unlike
// apps/cloud/lib/id.ts, to keep this route runtime-portable).
// ---------------------------------------------------------------------------

const VOUCHER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateVoucherCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = "";
  for (let i = 0; i < length; i++) {
    s += VOUCHER_CODE_ALPHABET[bytes[i]! % VOUCHER_CODE_ALPHABET.length];
  }
  return s;
}

function generateVoucherId(): string {
  return `VCH-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function generateBatchId(): string {
  return `BATCH-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

// Dedupe within a single generate() call — astronomically unlikely to ever
// loop more than once (32^8 combinations), but `code` is UNIQUE so it's cheap
// insurance against a same-batch collision.
function generateUniqueCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateVoucherCode());
  }
  return Array.from(codes);
}

// ---------------------------------------------------------------------------
// Admin router — mounted by the caller at /api/admin/voucher
// ---------------------------------------------------------------------------

export const adminVoucherRoutes = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

const generateInputSchema = z
  .object({
    type: z.enum(["payment", "discount"]),
    value: z.number().int().min(1),
    limit: z.number().int().min(0).max(1_000_000).default(1),
    count: z.number().int().min(1).max(1000).default(1),
    customerName: z.string().trim().max(255).optional(),
    customerEmail: z.string().email().optional().or(z.literal("")),
    customerWhatsapp: z.string().trim().max(50).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "discount" && (val.value < 1 || val.value > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Diskon harus 1-100%",
      });
    }
    if (val.type === "payment" && val.value < 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Nominal pembayaran minimal Rp 1.000",
      });
    }
  });

adminVoucherRoutes.post("/generate", requireAdmin, async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "BAD_BODY", message: "Body tidak valid" }, 400);
  }

  const parsed = generateInputSchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      {
        error: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Validasi gagal",
        issues: parsed.error.issues,
      },
      400,
    );
  }

  const input = parsed.data;
  const createdBy = c.get("adminEmail");
  const db = getDb(c.env.DB);
  const batchId = generateBatchId();
  const isSingle = input.count === 1;

  const buildRows = () => {
    const codes = generateUniqueCodes(input.count);
    return Array.from({ length: input.count }, (_, i) => ({
      id: generateVoucherId(),
      code: codes[i]!,
      type: input.type,
      value: input.value,
      limit: input.limit,
      usedCount: 0,
      status: "active" as const,
      customerName: isSingle ? (input.customerName ?? null) : null,
      customerEmail: isSingle ? input.customerEmail || null : null,
      customerWhatsapp: isSingle ? (input.customerWhatsapp ?? null) : null,
      batchId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdBy,
    }));
  };

  // Retry on the off chance a generated code collides with an existing row
  // (UNIQUE constraint on vouchers.code).
  const maxAttempts = 5;
  let rows: ReturnType<typeof buildRows> | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = buildRows();
    try {
      await db.insert(schema.vouchers).values(candidate);
      rows = candidate;
      break;
    } catch (err) {
      lastErr = err;
      logger.warn("voucher_code_collision_retry", { attempt });
    }
  }

  if (!rows) {
    logger.error("voucher_generate_failed", { error: String(lastErr) });
    return c.json({ error: "GENERATE_FAILED", message: "Gagal membuat voucher" }, 500);
  }

  logger.info("vouchers_generated", {
    count: input.count,
    type: input.type,
    value: input.value,
    batchId,
    createdBy,
  });

  return c.json({
    ok: true,
    count: input.count,
    batchId,
    vouchers: rows.map((r) => ({ id: r.id, code: r.code })),
  });
});

// GET /list — no filter/paging in the source route either (apps/cloud/app/api/
// admin/voucher/list/route.ts): just everything, split into payment/discount.
adminVoucherRoutes.get("/list", requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const all = await db.select().from(schema.vouchers).orderBy(desc(schema.vouchers.createdAt));

  return c.json({
    payment: all.filter((v) => v.type === "payment"),
    discount: all.filter((v) => v.type === "discount"),
  });
});

const CSV_HEADERS = [
  "Code",
  "Type",
  "Value",
  "Limit",
  "Used Count",
  "Status",
  "Customer Name",
  "Customer Email",
  "Customer WhatsApp",
  "Batch ID",
  "Created By",
  "Created At",
  "Expires At",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

adminVoucherRoutes.get("/export", requireAdmin, async (c) => {
  const type = c.req.query("type");
  if (type !== "payment" && type !== "discount") {
    return c.json({ error: "BAD_TYPE", message: "type harus 'payment' atau 'discount'" }, 400);
  }

  const db = getDb(c.env.DB);
  const rows = await db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.type, type))
    .orderBy(desc(schema.vouchers.createdAt));

  const lines = [CSV_HEADERS.join(",")];
  for (const v of rows) {
    lines.push(
      [
        v.code,
        v.type,
        v.value,
        v.limit,
        v.usedCount,
        v.status,
        v.customerName,
        v.customerEmail,
        v.customerWhatsapp,
        v.batchId,
        v.createdBy,
        v.createdAt,
        v.expiresAt,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vouchers-${type}-${today}.csv"`,
    },
  });
});

// Soft delete: flips status to "disabled" so the redemption audit trail stays
// intact. The redeem endpoint rejects any non-active status. Ported from
// apps/cloud/app/api/admin/voucher/[id]/route.ts — that file only exports
// DELETE, so PATCH is intentionally not implemented here.
adminVoucherRoutes.delete("/:id", requireAdmin, async (c) => {
  // Cast needed because chaining a middleware before the handler on this
  // Hono version widens the inferred path-param type to `string | undefined`
  // (see booths.ts/frames.ts ":id" routes for the no-middleware case, where
  // it infers as plain `string`). The route pattern guarantees a value here.
  const id = c.req.param("id") as string;
  const db = getDb(c.env.DB);

  const result = await db
    .update(schema.vouchers)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(schema.vouchers.id, id));

  if (result.meta.changes === 0) {
    return c.json({ error: "NOT_FOUND", message: "Voucher tidak ditemukan" }, 404);
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public router — mounted by the caller at /api/voucher (no auth: the kiosk
// knows sessionId/code/boothId from its own context, same trust model as the
// QRIS happy path).
// ---------------------------------------------------------------------------

export const publicVoucherRoutes = new Hono<{ Bindings: Bindings }>();

publicVoucherRoutes.post("/redeem", async (c) => {
  let body: { code?: unknown; sessionId?: unknown; boothId?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "BAD_BODY", message: "Body tidak valid" }, 400);
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const boothIdHint = typeof body.boothId === "string" ? body.boothId : undefined;

  if (!code || !sessionId) {
    return c.json({ error: "MISSING_FIELDS", message: "Kode voucher atau sesi kosong" }, 400);
  }

  const db = getDb(c.env.DB);

  const [voucher] = await db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.code, code))
    .limit(1);

  if (!voucher) {
    return c.json({ error: "NOT_FOUND", message: "Kode voucher tidak ditemukan" }, 404);
  }

  // Check expiry first — best-effort status flip (idempotent; harmless if
  // raced by a concurrent request) and inform the user.
  if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
    if (voucher.status !== "expired") {
      await db
        .update(schema.vouchers)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(schema.vouchers.id, voucher.id));
    }
    return c.json({ error: "EXPIRED", message: "Voucher sudah kadaluarsa" }, 400);
  }

  if (voucher.status !== "active") {
    const message =
      voucher.status === "used"
        ? "Voucher sudah habis dipakai"
        : voucher.status === "disabled"
          ? "Voucher dinonaktifkan"
          : `Voucher tidak aktif (${voucher.status})`;
    return c.json({ error: "INACTIVE", message, currentStatus: voucher.status }, 400);
  }

  if (voucher.limit > 0 && voucher.usedCount >= voucher.limit) {
    // Repair drift: status should already be "used" but self-heal just in case.
    await db
      .update(schema.vouchers)
      .set({ status: "used", updatedAt: new Date() })
      .where(eq(schema.vouchers.id, voucher.id));
    return c.json({ error: "QUOTA_EXHAUSTED", message: "Voucher sudah habis dipakai" }, 400);
  }

  // sessions is READ-ONLY here — BoothDO is the sole writer.
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return c.json({ error: "SESSION_NOT_FOUND", message: "Sesi tidak ditemukan" }, 404);
  }

  if (session.status !== "payment" && session.status !== "idle") {
    return c.json(
      {
        error: "SESSION_NOT_PAYABLE",
        message: `Sesi tidak dapat dibayar (status: ${session.status})`,
        currentStatus: session.status,
      },
      400,
    );
  }

  let finalAmount: number;
  let discountApplied: number;

  if (voucher.type === "payment") {
    if (voucher.value >= session.amount) {
      finalAmount = 0;
      discountApplied = session.amount;
    } else {
      finalAmount = session.amount - voucher.value;
      discountApplied = voucher.value;
    }
  } else if (voucher.type === "discount") {
    const pct = Math.max(0, Math.min(100, voucher.value));
    discountApplied = Math.round((session.amount * pct) / 100);
    finalAmount = session.amount - discountApplied;
  } else {
    return c.json(
      { error: "BAD_VOUCHER_TYPE", message: `Jenis voucher tidak valid (${voucher.type})` },
      500,
    );
  }

  // --- Atomic redemption guard -----------------------------------------
  // No db.transaction() on D1: this single conditional UPDATE IS the
  // atomicity boundary. Two parallel requests for a limit=1 voucher both
  // read `voucher` above with usedCount=0/status=active, but only one of
  // them can match this WHERE clause and actually flip the row — SQLite
  // (and D1) serialise writes to a single row. The loser sees
  // meta.changes === 0 and bails out before writing anything else.
  const boothId = boothIdHint || session.boothId;
  const nowDate = new Date();

  const updateResult = await db
    .update(schema.vouchers)
    .set({
      usedCount: sql`${schema.vouchers.usedCount} + 1`,
      status: sql`CASE WHEN ${schema.vouchers.limit} > 0 AND ${schema.vouchers.usedCount} + 1 >= ${schema.vouchers.limit} THEN 'used' ELSE 'active' END`,
      updatedAt: nowDate,
    })
    .where(
      and(
        eq(schema.vouchers.id, voucher.id),
        eq(schema.vouchers.status, "active"),
        or(eq(schema.vouchers.limit, 0), lt(schema.vouchers.usedCount, schema.vouchers.limit)),
        or(isNull(schema.vouchers.expiresAt), gte(schema.vouchers.expiresAt, nowDate)),
      ),
    );

  if (updateResult.meta.changes === 0) {
    logger.warn("voucher_redeem_lost_race", { voucherId: voucher.id, code, sessionId });
    return c.json(
      { error: "QUOTA_EXHAUSTED", message: "Voucher sudah habis dipakai" },
      409,
    );
  }

  const redemptionId = crypto.randomUUID();

  // Won the race — write the append-only ledger rows. Neither table is
  // `sessions`/`photos`, so this is fine for the Worker to write directly
  // (see @/do/rpc.ts header comment).
  await db.batch([
    db.insert(schema.voucherRedemptions).values({
      voucherId: voucher.id,
      sessionId,
      boothId,
      originalAmount: session.amount,
      finalAmount,
      discountApplied,
    }),
    db.insert(schema.paymentLogs).values({
      sessionId,
      provider: "voucher",
      eventType: "voucher_redeemed",
      payload: {
        voucherId: voucher.id,
        code,
        type: voucher.type,
        value: voucher.value,
        originalAmount: session.amount,
        finalAmount,
        discountApplied,
        redemptionId,
      },
    }),
  ]);

  // BoothDO is the sole writer of `sessions` — ask it to transition the
  // session to paid instead of updating the row here.
  await markPaid(c.env, boothId, sessionId, {
    method: "voucher",
    voucherId: voucher.id,
    code,
    finalAmount,
    discountApplied,
  });

  logger.info("voucher_redeemed", {
    sessionId,
    boothId,
    voucherId: voucher.id,
    code,
    type: voucher.type,
    originalAmount: session.amount,
    finalAmount,
    discountApplied,
  });

  return c.json({
    ok: true,
    voucher: {
      code,
      type: voucher.type,
      value: voucher.value,
    },
    session: {
      id: sessionId,
      status: "paid",
      originalAmount: session.amount,
      finalAmount,
      discountApplied,
    },
  });
});
