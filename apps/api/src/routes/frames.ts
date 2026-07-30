// Ported from apps/cloud/app/api/frames/route.ts + frames/[id]/route.ts.
//
// Key difference from the old code: `frames.background_key` / `logo_key` /
// `preview_key` store R2 object *keys* now (see apps/api/src/db/schema.ts),
// not absolute URLs. The frontend still expects `backgroundUrl` /
// `logoUrl` / `previewUrl` (see packages/shared/src/types/frame.ts), so
// every response here is passed through `toFrameResponse()`, which resolves
// each key to a full CDN URL via `getPublicUrl(env.PUBLIC_CDN_URL, key)`
// while what's written to D1 stays the bare key.
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import type { FrameRow } from "@/db";
import { getPublicUrl } from "@/lib/storage";
import { DEFAULT_LAYOUT_B, frameInputSchema, frameUpdateSchema } from "@/lib/validations/frame";
import { generateFrameId } from "@/lib/id";
import { logger } from "@/lib/logger";

const frames = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

frames.use("*", requireAdmin);

function toFrameResponse(row: FrameRow, cdnBase: string) {
  const { backgroundKey, logoKey, previewKey, ...rest } = row;
  return {
    ...rest,
    backgroundUrl: backgroundKey ? getPublicUrl(cdnBase, backgroundKey) : null,
    logoUrl: logoKey ? getPublicUrl(cdnBase, logoKey) : null,
    previewUrl: previewKey ? getPublicUrl(cdnBase, previewKey) : null,
  };
}

frames.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const env = getEnv(c.env);
  const rows = await db.select().from(schema.frames).orderBy(desc(schema.frames.createdAt));
  return c.json({ data: rows.map((r) => toFrameResponse(r, env.PUBLIC_CDN_URL)) });
});

frames.post("/", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = frameInputSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }
  const data = parsed.data;
  const id = generateFrameId();
  const db = getDb(c.env.DB);
  const env = getEnv(c.env);

  const [created] = await db
    .insert(schema.frames)
    .values({
      id,
      name: data.name,
      tier: data.tier,
      price: data.price,
      backgroundKey: data.backgroundKey,
      logoKey: data.logoKey,
      previewKey: data.previewKey ?? data.backgroundKey,
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
  return c.json({ data: toFrameResponse(created!, env.PUBLIC_CDN_URL) }, 201);
});

frames.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const env = getEnv(c.env);
  const [row] = await db.select().from(schema.frames).where(eq(schema.frames.id, id)).limit(1);
  if (!row) return c.json({ error: "Frame tidak ditemukan" }, 404);
  return c.json({ data: toFrameResponse(row, env.PUBLIC_CDN_URL) });
});

frames.patch("/:id", async (c) => {
  const id = c.req.param("id");
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = frameUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }
  const d = parsed.data;
  const db = getDb(c.env.DB);
  const env = getEnv(c.env);

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
  if (!updated) return c.json({ error: "Frame tidak ditemukan" }, 404);
  logger.info("frame_updated", { id });
  return c.json({ data: toFrameResponse(updated, env.PUBLIC_CDN_URL) });
});

frames.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const [deleted] = await db.delete(schema.frames).where(eq(schema.frames.id, id)).returning();
  if (!deleted) return c.json({ error: "Frame tidak ditemukan" }, 404);
  logger.info("frame_deleted", { id });
  return c.json({ ok: true });
});

export default frames;
