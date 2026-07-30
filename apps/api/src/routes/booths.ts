// Ported from apps/cloud/app/api/booths/route.ts + booths/[id]/route.ts
// (Next.js route handlers -> Hono sub-router). Booths have no `*Url`/`*Key`
// asset columns, so unlike frames there's no key<->URL mapping needed here.
//
// Auth: the old routes called `getCurrentSession()` inline in every
// handler; this router instead mounts `requireAdmin` once at the router
// level (see bottom of file) since every route here is admin-only.
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { Bindings } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import { boothInputSchema, boothUpdateSchema } from "@/lib/validations/booth";
import { generateBoothId, generateBridgeToken } from "@/lib/id";
import { logger } from "@/lib/logger";

const booths = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

booths.use("*", requireAdmin);

booths.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(schema.booths).orderBy(desc(schema.booths.createdAt));
  return c.json({ data: rows });
});

booths.post("/", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = boothInputSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }

  const id = generateBoothId();
  const bridgeToken = generateBridgeToken();
  const data = parsed.data;
  const db = getDb(c.env.DB);

  const [created] = await db
    .insert(schema.booths)
    .values({
      id,
      name: data.name,
      location: data.location,
      defaultPrice: data.defaultPrice,
      paymentProvider: data.paymentProvider,
      bridgeToken,
      isActive: data.isActive,
    })
    .returning();

  logger.info("booth_created", { id });
  return c.json({ data: created }, 201);
});

booths.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const [row] = await db.select().from(schema.booths).where(eq(schema.booths.id, id)).limit(1);
  if (!row) return c.json({ error: "Booth tidak ditemukan" }, 404);
  return c.json({ data: row });
});

booths.patch("/:id", async (c) => {
  const id = c.req.param("id");
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = boothUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }
  const { regenerateBridgeToken, useMockBridge, ...rest } = parsed.data;
  const db = getDb(c.env.DB);

  const updates: Partial<typeof schema.booths.$inferInsert> = {
    ...rest,
    updatedAt: new Date(),
  };
  if (regenerateBridgeToken) {
    updates.bridgeToken = generateBridgeToken();
  }

  // useMockBridge is stored inside the booth metadata json. We only patch the
  // single key so other heartbeat-derived fields (camera/printer status) stay.
  if (typeof useMockBridge === "boolean") {
    const [existing] = await db
      .select({ metadata: schema.booths.metadata })
      .from(schema.booths)
      .where(eq(schema.booths.id, id))
      .limit(1);
    const merged = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      use_mock_bridge: useMockBridge,
    };
    updates.metadata = merged;
  }

  const [updated] = await db
    .update(schema.booths)
    .set(updates)
    .where(eq(schema.booths.id, id))
    .returning();

  if (!updated) return c.json({ error: "Booth tidak ditemukan" }, 404);
  logger.info("booth_updated", {
    id,
    regen: !!regenerateBridgeToken,
    useMockBridge: typeof useMockBridge === "boolean" ? useMockBridge : undefined,
  });
  return c.json({ data: updated });
});

booths.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const [deleted] = await db.delete(schema.booths).where(eq(schema.booths.id, id)).returning();
  if (!deleted) return c.json({ error: "Booth tidak ditemukan" }, 404);
  logger.info("booth_deleted", { id });
  return c.json({ ok: true });
});

export default booths;
