// Ported from apps/cloud/app/api/kiosk/boot/route.ts (Next.js route handler
// -> Hono sub-router). PUBLIC — no auth guard; the kiosk hits this at boot
// time to fetch its booth + frame catalog before any session exists.
//
// Key difference from the old code: `frames.backgroundUrl/previewUrl/logoUrl`
// no longer exist as columns — the D1 schema stores R2 object *keys*
// (`backgroundKey`/`previewKey`/`logoKey`, see src/db/schema.ts). The
// response shape must stay identical to the old `KioskBootData` contract
// (packages/shared/src/types/socket-events.ts) though, since the kiosk page
// is being built in parallel against it — so each key is resolved to a full
// CDN URL via `getPublicUrl(env.PUBLIC_CDN_URL, key)` here, at the response
// boundary, while D1 keeps storing the bare key.
import { Hono } from "hono";
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { isLayoutV2, type KioskBootData } from "@capture/shared";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/db";
import { getPublicUrl } from "@/lib/storage";
import { logger } from "@/lib/logger";

const kiosk = new Hono<{ Bindings: Bindings }>();

kiosk.get("/boot", async (c) => {
  const boothId = c.req.query("boothId");
  if (!boothId) {
    return c.json({ error: "boothId wajib" }, 400);
  }

  const db = getDb(c.env.DB);
  const env = getEnv(c.env);

  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  if (!booth) {
    return c.json({ error: "Booth tidak ditemukan" }, 404);
  }
  if (!booth.isActive) {
    return c.json({ error: "Booth sedang nonaktif" }, 403);
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

  // Hanya frame layout v2 (PRD bagian 8 #14). Frame v1 (strip 2×3) tidak
  // bisa dicompose agent, jadi disaring di sini, bukan dibiarkan gagal di booth.
  const v2Frames = frameRows.filter((f) => isLayoutV2(f.layoutJson));
  if (v2Frames.length !== frameRows.length) {
    logger.warn("kiosk_boot_skip_v1_frames", {
      boothId,
      skipped: frameRows.filter((f) => !isLayoutV2(f.layoutJson)).map((f) => f.id),
    });
  }

  const data: KioskBootData = {
    booth: {
      id: booth.id,
      name: booth.name,
      location: booth.location,
      defaultPrice: booth.defaultPrice,
      paymentProvider: booth.paymentProvider,
      isActive: booth.isActive,
    },
    frames: v2Frames.map((f) => ({
      id: f.id,
      name: f.name,
      tier: (f.tier as "regular" | "premium") ?? "regular",
      price: f.price,
      backgroundUrl: f.backgroundKey ? getPublicUrl(env.PUBLIC_CDN_URL, f.backgroundKey) : null,
      previewUrl: f.previewKey ? getPublicUrl(env.PUBLIC_CDN_URL, f.previewKey) : null,
      logoUrl: f.logoKey ? getPublicUrl(env.PUBLIC_CDN_URL, f.logoKey) : null,
      boothId: f.boothId,
      isDefault: f.isDefault,
      sortOrder: f.sortOrder,
      layoutJson: f.layoutJson as KioskBootData["frames"][number]["layoutJson"],
    })),
    settings: {
      defaultCurrency: "IDR",
      languageDefault: "id",
      availableLanguages: ["id", "en"],
    },
  };

  return c.json({ data });
});

export default kiosk;
