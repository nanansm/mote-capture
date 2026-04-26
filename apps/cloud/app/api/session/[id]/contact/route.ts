import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { notifySession } from "@/lib/notify";
import { formatPhoneNumber } from "@/lib/wa/evolution";
import { logger } from "@/lib/logger";

// Indonesian phone format: 08xxxx, 8xxxx, +62xxxx, 62xxxx — converted to 62xxxx.
const phoneSchema = z
  .string()
  .min(8, "Nomor terlalu pendek")
  .max(20, "Nomor terlalu panjang")
  .refine(
    (v) => /^(\+?62|0|8)[\d\s\-]{6,}$/.test(v.trim()),
    "Format nomor WhatsApp Indonesia tidak valid",
  );

const bodySchema = z.object({
  phone: phoneSchema,
  email: z
    .string()
    .email("Email tidak valid")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  const phone = formatPhoneNumber(parsed.data.phone);
  await db
    .update(schema.sessions)
    .set({ customerPhone: phone, customerEmail: parsed.data.email ?? null })
    .where(eq(schema.sessions.id, id));

  let waSent = false;
  let emailSent = false;
  try {
    const result = await notifySession(id);
    waSent = Boolean(result.whatsapp?.ok);
    emailSent = Boolean(result.email?.ok);
  } catch (err) {
    logger.warn("contact_notify_failed", {
      sessionId: id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    ok: true,
    sent: { wa: waSent, email: emailSent },
  });
}
