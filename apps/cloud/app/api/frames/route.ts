import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { DEFAULT_LAYOUT_B, frameInputSchema } from "@/lib/validations/frame";
import { generateFrameId } from "@/lib/id";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(schema.frames)
    .orderBy(desc(schema.frames.createdAt));
  return NextResponse.json({ data: rows });
}

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = frameInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const id = generateFrameId();

  const [created] = await db
    .insert(schema.frames)
    .values({
      id,
      name: data.name,
      tier: data.tier,
      price: data.price,
      backgroundUrl: data.backgroundUrl,
      logoUrl: data.logoUrl,
      previewUrl: data.previewUrl ?? data.backgroundUrl,
      boothId: data.boothId,
      isActive: data.isActive,
      isDefault: data.isDefault,
      seasonStart: data.seasonStart ? new Date(data.seasonStart) : null,
      seasonEnd: data.seasonEnd ? new Date(data.seasonEnd) : null,
      sortOrder: data.sortOrder,
      layoutJson: data.layoutJson ?? DEFAULT_LAYOUT_B,
    })
    .returning();

  logger.info("frame_created", { id });
  return NextResponse.json({ data: created }, { status: 201 });
}
