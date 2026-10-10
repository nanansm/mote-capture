import { isLayoutV2 } from "@capture/shared";
// Ported from apps/cloud/app/api/booths/route.ts + booths/[id]/route.ts
// (Next.js route handlers -> Hono sub-router). Booths have no `*Url`/`*Key`
// asset columns, so unlike frames there's no key<->URL mapping needed here.
//
// Auth: the old routes called `getCurrentSession()` inline in every
// handler; this router instead mounts `requireAdmin` once at the router
// level (see bottom of file) since every route here is admin-only.
import { Hono } from "hono";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getPublicUrl } from "@/lib/storage";
import type { Bindings } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import { boothInputSchema, boothUpdateSchema } from "@/lib/validations/booth";
import { generateBoothId, generateBridgeToken } from "@/lib/id";
import { logger } from "@/lib/logger";

const booths = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

// Akun harus ada; provider booth disalin dari akun supaya daftar booth/sesi
// tetap menampilkan provider tanpa join.
async function accountFields(db: ReturnType<typeof getDb>, accountId: string | null | undefined) {
  if (accountId === undefined) return { ok: true as const, fields: {} };
  if (accountId === null || accountId === "") return { ok: true as const, fields: { paymentAccountId: null } };
  const [acc] = await db
    .select({ id: schema.paymentAccounts.id, provider: schema.paymentAccounts.provider })
    .from(schema.paymentAccounts)
    .where(eq(schema.paymentAccounts.id, accountId))
    .limit(1);
  if (!acc) return { ok: false as const, error: "Akun pembayaran tidak ditemukan" };
  return { ok: true as const, fields: { paymentAccountId: acc.id, paymentProvider: acc.provider } };
}

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
  const acc = await accountFields(db, data.paymentAccountId ?? null);
  if (!acc.ok) return c.json({ error: acc.error }, 400);

  const [created] = await db
    .insert(schema.booths)
    .values({
      id,
      name: data.name,
      location: data.location,
      defaultPrice: data.defaultPrice,
      bridgeToken,
      isActive: data.isActive,
      ...acc.fields,
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
  const { regenerateBridgeToken, paymentAccountId, ...rest } = parsed.data;
  const db = getDb(c.env.DB);
  const acc = await accountFields(db, paymentAccountId);
  if (!acc.ok) return c.json({ error: acc.error }, 400);

  const updates: Partial<typeof schema.booths.$inferInsert> = {
    ...rest,
    ...acc.fields,
    updatedAt: new Date(),
  };
  if (regenerateBridgeToken) {
    updates.bridgeToken = generateBridgeToken();
  }

  const [updated] = await db
    .update(schema.booths)
    .set(updates)
    .where(eq(schema.booths.id, id))
    .returning();

  if (!updated) return c.json({ error: "Booth tidak ditemukan" }, 404);
  logger.info("booth_updated", {
    id,
    paymentAccountId: updates.paymentAccountId,
    regen: !!regenerateBridgeToken,
  });
  return c.json({ data: updated });
});

// ---------------------------------------------------------------------------
// Frame per booth (0004). Booth -> frame: tiap pasangan punya harga, status
// tampil, frame utama, dan urutan sendiri. Frame di library tidak tersentuh.
// ---------------------------------------------------------------------------

const priceSchema = z
  .number({ invalid_type_error: "Harga harus berupa angka" })
  .int("Harga harus bilangan bulat")
  .min(1000, "Harga minimal Rp1.000")
  .max(10_000_000, "Harga terlalu besar");

const boothFrameSchema = z.object({
  price: priceSchema.optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const reorderSchema = z.object({ frameIds: z.array(z.string().min(1)).max(500) });

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return { ok: true as const, json: await c.req.json() };
  } catch {
    return { ok: false as const };
  }
}

booths.get("/:id/frames", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const cdn = getEnv(c.env).PUBLIC_CDN_URL;
  const [booth] = await db.select({ id: schema.booths.id }).from(schema.booths).where(eq(schema.booths.id, id)).limit(1);
  if (!booth) return c.json({ error: "Booth tidak ditemukan" }, 404);
  const rows = await db
    .select({ bf: schema.boothFrames, f: schema.frames })
    .from(schema.boothFrames)
    .innerJoin(schema.frames, eq(schema.frames.id, schema.boothFrames.frameId))
    .where(eq(schema.boothFrames.boothId, id))
    .orderBy(asc(schema.boothFrames.sortOrder), asc(schema.boothFrames.createdAt));
  return c.json({
    data: rows.map(({ bf, f }) => ({
      frameId: bf.frameId,
      price: bf.price,
      isActive: bf.isActive,
      isDefault: bf.isDefault,
      sortOrder: bf.sortOrder,
      frame: {
        id: f.id,
        name: f.name,
        tier: f.tier,
        isActive: f.isActive,
        seasonStart: f.seasonStart,
        seasonEnd: f.seasonEnd,
        // Kiosk hanya menampilkan layout v2 (lihat routes/kiosk.ts).
        layoutOk: isLayoutV2(f.layoutJson),
        previewUrl: f.previewKey ? getPublicUrl(cdn, f.previewKey) : f.backgroundKey ? getPublicUrl(cdn, f.backgroundKey) : null,
      },
    })),
  });
});

// Urutan dipetakan dari array id. Didaftarkan sebelum "/:id/frames/:frameId".
booths.post("/:id/frames/reorder", async (c) => {
  const id = c.req.param("id");
  const body = await readJson(c);
  if (!body.ok) return c.json({ error: "Body tidak valid" }, 400);
  const parsed = reorderSchema.safeParse(body.json);
  if (!parsed.success) return c.json({ error: "Daftar frame tidak valid" }, 400);
  const ids = parsed.data.frameIds;
  if (new Set(ids).size !== ids.length) return c.json({ error: "Daftar frame dobel" }, 400);
  const db = getDb(c.env.DB);
  const linked = await db
    .select({ frameId: schema.boothFrames.frameId })
    .from(schema.boothFrames)
    .where(eq(schema.boothFrames.boothId, id));
  const have = new Set(linked.map((r) => r.frameId));
  if (ids.some((f) => !have.has(f))) return c.json({ error: "Ada frame yang tidak terpasang di booth ini" }, 400);
  if (ids.length) {
    const now = new Date();
    await db.batch(
      ids.map((frameId, i) =>
        db
          .update(schema.boothFrames)
          .set({ sortOrder: i, updatedAt: now })
          .where(and(eq(schema.boothFrames.boothId, id), eq(schema.boothFrames.frameId, frameId))),
      ) as [never, ...never[]],
    );
  }
  return c.json({ ok: true });
});

booths.put("/:id/frames/:frameId", async (c) => {
  const id = c.req.param("id");
  const frameId = c.req.param("frameId");
  const body = await readJson(c);
  if (!body.ok) return c.json({ error: "Body tidak valid" }, 400);
  const parsed = boothFrameSchema.safeParse(body.json ?? {});
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  const db = getDb(c.env.DB);
  const result = await linkFrameToBooth(db, id, frameId, parsed.data);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  logger.info("booth_frame_saved", { boothId: id, frameId, price: result.price });
  return c.json({ ok: true });
});

booths.delete("/:id/frames/:frameId", async (c) => {
  const id = c.req.param("id");
  const frameId = c.req.param("frameId");
  const db = getDb(c.env.DB);
  const [deleted] = await db
    .delete(schema.boothFrames)
    .where(and(eq(schema.boothFrames.boothId, id), eq(schema.boothFrames.frameId, frameId)))
    .returning();
  if (!deleted) return c.json({ error: "Frame tidak terpasang di booth ini" }, 404);
  logger.info("booth_frame_removed", { boothId: id, frameId });
  return c.json({ ok: true });
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

// Pasang / ubah frame di booth. Dipakai PUT di atas dan POST /api/frames
// (buat frame langsung dari halaman booth). Satu batch supaya "frame utama"
// tidak pernah dua.
export async function linkFrameToBooth(
  db: ReturnType<typeof getDb>,
  boothId: string,
  frameId: string,
  input: { price?: number; isActive?: boolean; isDefault?: boolean },
): Promise<{ ok: true; price: number } | { ok: false; error: string; status: 404 }> {
  const [booth] = await db.select().from(schema.booths).where(eq(schema.booths.id, boothId)).limit(1);
  if (!booth) return { ok: false, error: "Booth tidak ditemukan", status: 404 };
  const [frame] = await db.select({ id: schema.frames.id }).from(schema.frames).where(eq(schema.frames.id, frameId)).limit(1);
  if (!frame) return { ok: false, error: "Frame tidak ditemukan", status: 404 };

  const links = await db
    .select({ frameId: schema.boothFrames.frameId, price: schema.boothFrames.price, sortOrder: schema.boothFrames.sortOrder })
    .from(schema.boothFrames)
    .where(eq(schema.boothFrames.boothId, boothId));
  const existing = links.find((l) => l.frameId === frameId);
  const now = new Date();
  const price = input.price ?? existing?.price ?? Math.max(booth.defaultPrice, 1000);
  // Frame pertama di booth otomatis jadi utama.
  const isDefault = input.isDefault ?? (existing ? undefined : links.length === 0);

  const write = existing
    ? db
        .update(schema.boothFrames)
        .set({
          price,
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(isDefault === undefined ? {} : { isDefault }),
          updatedAt: now,
        })
        .where(and(eq(schema.boothFrames.boothId, boothId), eq(schema.boothFrames.frameId, frameId)))
    : db.insert(schema.boothFrames).values({
        boothId,
        frameId,
        price,
        isActive: input.isActive ?? true,
        isDefault: isDefault ?? false,
        sortOrder: links.reduce((m, l) => Math.max(m, l.sortOrder + 1), 0),
      });

  if (isDefault) {
    await db.batch([
      db
        .update(schema.boothFrames)
        .set({ isDefault: false, updatedAt: now })
        .where(and(eq(schema.boothFrames.boothId, boothId), ne(schema.boothFrames.frameId, frameId))),
      write,
    ]);
  } else {
    await write;
  }
  return { ok: true, price };
}

