import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  generateBatchId,
  generateVoucherCode,
  generateVoucherId,
} from "@/lib/id";

const inputSchema = z
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

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "BAD_BODY", message: "Body tidak valid" },
      { status: 400 },
    );
  }

  const parsed = inputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Validasi gagal",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const batchId = generateBatchId();
  const isSingle = input.count === 1;

  // Customer fields are only sensible to attach when generating one voucher.
  // For a batch they belong on the redemption record, not the voucher row.
  const rows = Array.from({ length: input.count }, () => ({
    id: generateVoucherId(),
    code: generateVoucherCode(),
    type: input.type,
    value: input.value,
    limit: input.limit,
    usedCount: 0,
    status: "active" as const,
    customerName: isSingle ? input.customerName ?? null : null,
    customerEmail: isSingle ? input.customerEmail || null : null,
    customerWhatsapp: isSingle ? input.customerWhatsapp ?? null : null,
    batchId,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    createdBy: session.email,
  }));

  await db.insert(schema.vouchers).values(rows);

  logger.info("vouchers_generated", {
    count: input.count,
    type: input.type,
    value: input.value,
    batchId,
    createdBy: session.email,
  });

  return NextResponse.json({
    ok: true,
    count: input.count,
    batchId,
    vouchers: rows.map((r) => ({ id: r.id, code: r.code })),
  });
}
