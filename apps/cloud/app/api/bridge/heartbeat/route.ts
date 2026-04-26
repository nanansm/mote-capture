import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getAllSettings } from "@/lib/settings/store";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  boothId: z.string().min(1),
  version: z.string().optional(),
  camera: z.record(z.unknown()).optional(),
  printer: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Bridge token diperlukan" }, { status: 401 });
  }

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

  const { boothId, ...rest } = parsed.data;
  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
  if (booth.bridgeToken !== token) {
    logger.warn("bridge_invalid_token", { boothId });
    return NextResponse.json({ error: "Token bridge tidak valid" }, { status: 401 });
  }

  const metadata = {
    ...((booth.metadata as object) ?? {}),
    ...rest,
    lastHeartbeat: new Date().toISOString(),
  };

  await db
    .update(schema.booths)
    .set({ lastSeenAt: new Date(), metadata })
    .where(eq(schema.booths.id, boothId));

  const settings = await getAllSettings();
  return NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    settings: { general: settings.general },
  });
}
