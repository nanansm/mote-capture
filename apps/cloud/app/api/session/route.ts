import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { generateSessionId } from "@/lib/utils/token";
import { generateDownloadToken } from "@/lib/utils/token";
import { getPaymentProvider } from "@/lib/payment";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { resolvePrice } from "@/lib/session-helpers";

const bodySchema = z.object({
  boothId: z.string().min(1),
  frameId: z.string().min(1).optional(),
});

// PUBLIC endpoint — kiosk creates the session.
export async function POST(req: Request) {
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
  const { boothId, frameId } = parsed.data;

  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
  if (!booth.isActive) {
    return NextResponse.json({ error: "Booth sedang nonaktif" }, { status: 400 });
  }

  let frame: typeof schema.frames.$inferSelect | undefined;
  if (frameId) {
    const [row] = await db
      .select()
      .from(schema.frames)
      .where(and(eq(schema.frames.id, frameId), eq(schema.frames.isActive, true)))
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: "Frame tidak tersedia" }, { status: 404 });
    }
    if (row.boothId && row.boothId !== boothId) {
      return NextResponse.json(
        { error: "Frame ini tidak dipasang untuk booth ini" },
        { status: 400 },
      );
    }
    frame = row;
  }

  const amount = resolvePrice({
    frame: frame
      ? { tier: (frame.tier as "regular" | "premium") ?? "regular", price: frame.price }
      : null,
    boothDefaultPrice: booth.defaultPrice,
  });

  const id = generateSessionId();
  const downloadToken = generateDownloadToken();
  const downloadExpiresAt = new Date(
    Date.now() + env.DOWNLOAD_LINK_EXPIRY_DAYS * 86400 * 1000,
  );

  const provider = getPaymentProvider(booth.paymentProvider);
  let qr;
  try {
    qr = await provider.createQR({ sessionId: id, amount, expiresInMinutes: 15 });
  } catch (err) {
    logger.error("session_create_qr_failed", {
      sessionId: id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Gagal membuat QR pembayaran. Coba lagi nanti." },
      { status: 502 },
    );
  }

  const [created] = await db
    .insert(schema.sessions)
    .values({
      id,
      boothId,
      frameId: frame?.id ?? null,
      status: "payment",
      amount,
      paymentProvider: booth.paymentProvider,
      paymentRef: qr.providerRef,
      qrString: qr.qrString,
      downloadToken,
      downloadExpiresAt,
      expiredAt: qr.expiresAt,
    })
    .returning();

  await db.insert(schema.paymentLogs).values({
    sessionId: id,
    provider: booth.paymentProvider,
    eventType: "qr_created",
    payload: { providerRef: qr.providerRef, amount, mock: qr.mockMode ?? false },
  });

  logger.info("session_created", {
    sessionId: id,
    boothId,
    amount,
    mock: qr.mockMode ?? false,
  });

  return NextResponse.json({
    data: {
      sessionId: id,
      qrString: qr.qrString,
      amount,
      expiresAt: qr.expiresAt.toISOString(),
      downloadToken,
      mockMode: qr.mockMode ?? false,
    },
    session: created,
  });
}
