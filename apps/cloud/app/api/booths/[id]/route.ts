import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { boothUpdateSchema } from "@/lib/validations/booth";
import { generateBridgeToken } from "@/lib/id";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
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
  const parsed = boothUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }
  const { regenerateBridgeToken, useMockBridge, ...rest } = parsed.data;

  const updates: Partial<typeof schema.booths.$inferInsert> = {
    ...rest,
    updatedAt: new Date(),
  };
  if (regenerateBridgeToken) {
    updates.bridgeToken = generateBridgeToken();
  }

  // useMockBridge is stored inside the booth metadata jsonb. We only patch the
  // single key so other heartbeat-derived fields (camera/printer status) stay.
  if (typeof useMockBridge === "boolean") {
    const [existing] = await db
      .select({ metadata: schema.booths.metadata })
      .from(schema.booths)
      .where(eq(schema.booths.id, id))
      .limit(1);
    const merged = {
      ...(((existing?.metadata as Record<string, unknown> | null) ?? {})),
      use_mock_bridge: useMockBridge,
    };
    updates.metadata = merged;
  }

  const [updated] = await db
    .update(schema.booths)
    .set(updates)
    .where(eq(schema.booths.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
  logger.info("booth_updated", {
    id,
    regen: !!regenerateBridgeToken,
    useMockBridge: typeof useMockBridge === "boolean" ? useMockBridge : undefined,
  });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [deleted] = await db
    .delete(schema.booths)
    .where(eq(schema.booths.id, id))
    .returning();
  if (!deleted) return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
  logger.info("booth_deleted", { id });
  return NextResponse.json({ ok: true });
}
