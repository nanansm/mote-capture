import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { frameUpdateSchema } from "@/lib/validations/frame";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db
    .select()
    .from(schema.frames)
    .where(eq(schema.frames.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Frame tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ data: row });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = frameUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const updates: Partial<typeof schema.frames.$inferInsert> = {
    ...d,
    seasonStart: d.seasonStart ? new Date(d.seasonStart) : d.seasonStart === null ? null : undefined,
    seasonEnd: d.seasonEnd ? new Date(d.seasonEnd) : d.seasonEnd === null ? null : undefined,
    updatedAt: new Date(),
  };

  const [updated] = await db
    .update(schema.frames)
    .set(updates)
    .where(eq(schema.frames.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Frame tidak ditemukan" }, { status: 404 });
  logger.info("frame_updated", { id });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [deleted] = await db
    .delete(schema.frames)
    .where(eq(schema.frames.id, id))
    .returning();
  if (!deleted) return NextResponse.json({ error: "Frame tidak ditemukan" }, { status: 404 });
  logger.info("frame_deleted", { id });
  return NextResponse.json({ ok: true });
}
