import { NextResponse } from "next/server";
import { and, asc, desc, eq, isNull, lte, gte, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { KioskBootData } from "@capture/shared";

export const dynamic = "force-dynamic";

// PUBLIC — kiosk fetches booth + frame catalog at boot time.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const boothId = searchParams.get("boothId");
  if (!boothId) {
    return NextResponse.json({ error: "boothId wajib" }, { status: 400 });
  }

  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  if (!booth) {
    return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
  }
  if (!booth.isActive) {
    return NextResponse.json({ error: "Booth sedang nonaktif" }, { status: 403 });
  }

  const now = new Date();
  const frameRows = await db
    .select()
    .from(schema.frames)
    .where(
      and(
        eq(schema.frames.isActive, true),
        or(isNull(schema.frames.boothId), eq(schema.frames.boothId, boothId)),
        or(isNull(schema.frames.seasonStart), lte(schema.frames.seasonStart, now)),
        or(isNull(schema.frames.seasonEnd), gte(schema.frames.seasonEnd, now)),
      ),
    )
    .orderBy(asc(schema.frames.sortOrder), desc(schema.frames.createdAt));

  const useMockBridge =
    ((booth.metadata as Record<string, unknown> | null)?.use_mock_bridge as boolean | undefined) ??
    true;

  const data: KioskBootData = {
    booth: {
      id: booth.id,
      name: booth.name,
      location: booth.location,
      defaultPrice: booth.defaultPrice,
      paymentProvider: booth.paymentProvider,
      isActive: booth.isActive,
      useMockBridge,
    },
    frames: frameRows.map((f) => ({
      id: f.id,
      name: f.name,
      tier: (f.tier as "regular" | "premium") ?? "regular",
      price: f.price,
      backgroundUrl: f.backgroundUrl,
      previewUrl: f.previewUrl,
      logoUrl: f.logoUrl,
      boothId: f.boothId,
      isDefault: f.isDefault,
      sortOrder: f.sortOrder,
    })),
    settings: {
      defaultCurrency: "IDR",
      languageDefault: "id",
      availableLanguages: ["id", "en"],
    },
  };
  return NextResponse.json({ data });
}
