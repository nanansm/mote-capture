// HTTP endpoints for the Electron "bridge" app running on each booth PC.
//
// Auth model: every route here trusts a bearer token that must match
// `booths.bridge_token` — there is no admin session involved. Ported from
// apps/cloud/app/api/bridge/{heartbeat,resolve}/route.ts,
// apps/cloud/app/api/session/[id]/{photos,composite}/route.ts and
// apps/cloud/app/api/download/bridge/route.ts, with changes mandated for
// T2.5:
//  - Uploads are streamed PUT bodies (raw binary, `Content-Type` header,
//    metadata via query string), never buffered — Workers Free has a 10ms
//    CPU budget per request, and `await request.arrayBuffer()` on a
//    multi-MB photo burns that buffering a copy that R2 doesn't need.
//    `c.req.raw.body` (a ReadableStream) is passed straight through to
//    `uploadObject`.
//  - Neither upload route touches `sessions`/`photos` in D1. BoothDO (via
//    `@/do/rpc`) is the sole writer for those tables; this file only writes
//    R2 and then calls the RPC stub so BoothDO can update DB state + notify
//    the kiosk screen. The old routes' read-modify-write
//    `photoCount: session.photoCount + 1` (race-prone under concurrent
//    uploads) is dropped entirely, not ported.
//  - `photos.r2Key` (renamed from the old `photos.url`) always holds a bare
//    R2 object key — the DO builds the CDN URL at read time via
//    `getPublicUrl`.
//  - `/download/bridge` is a plain 302 to the public CDN; the old
//    presigned-URL-via-@aws-sdk approach is gone (no S3 SDK in this app).
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/db";
import type { SessionRow } from "@/db";
import { getAllSettings } from "@/lib/settings";
import { downloadKey, getPublicUrl, sessionAssetKey, uploadObject, validateUpload } from "@/lib/storage";
import { onCompositeUploaded, onPhotoUploaded } from "@/do/rpc";
import { logger } from "@/lib/logger";

type BridgeContext = Context<{ Bindings: Bindings }>;

// ---------------------------------------------------------------------------
// Shared bearer-token helpers
// ---------------------------------------------------------------------------

function bearerToken(c: BridgeContext): string | null {
  const auth = c.req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Looks up the session + its owning booth and checks the bearer token
 * matches `booth.bridge_token`. Read-only — never writes `sessions`.
 */
async function authorizeSessionUpload(
  c: BridgeContext,
  sessionId: string,
): Promise<{ session: SessionRow } | { errorResponse: Response }> {
  const token = bearerToken(c);
  if (!token) {
    return { errorResponse: c.json({ error: "Bridge token diperlukan" }, 401) };
  }

  const db = getDb(c.env.DB);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) {
    return { errorResponse: c.json({ error: "Session tidak ditemukan" }, 404) };
  }

  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, session.boothId))
    .limit(1);
  if (!booth || booth.bridgeToken !== token) {
    logger.warn("bridge_invalid_token", { sessionId, boothId: session.boothId });
    return { errorResponse: c.json({ error: "Token bridge tidak valid" }, 401) };
  }

  return { session };
}

/**
 * MIME + size validation from `Content-Type` / `Content-Length` headers
 * only — never reads the body. Returns an error Response or `null`.
 */
function validateUploadHeaders(c: BridgeContext): { contentType: string } | { errorResponse: Response } {
  const contentType = c.req.header("content-type") ?? "";
  const sizeHeader = c.req.header("content-length");
  const size = sizeHeader ? Number(sizeHeader) : NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return { errorResponse: c.json({ error: "Content-Length diperlukan" }, 400) };
  }
  const validationError = validateUpload({ type: contentType, size });
  if (validationError === "invalid_mime") {
    return { errorResponse: c.json({ error: "Hanya file PNG yang diperbolehkan" }, 400) };
  }
  if (validationError === "too_large") {
    return { errorResponse: c.json({ error: "Ukuran file melebihi 5MB" }, 400) };
  }
  return { contentType };
}

// ---------------------------------------------------------------------------
// bridgeRoutes — mounted at /api/bridge (no basePath of its own)
// ---------------------------------------------------------------------------

export const bridgeRoutes = new Hono<{ Bindings: Bindings }>();

const heartbeatBodySchema = z.object({
  boothId: z.string().min(1),
  version: z.string().optional(),
  camera: z.record(z.unknown()).optional(),
  printer: z.record(z.unknown()).optional(),
});

bridgeRoutes.post("/heartbeat", async (c) => {
  const token = bearerToken(c);
  if (!token) return c.json({ error: "Bridge token diperlukan" }, 401);

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = heartbeatBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }

  const { boothId, ...rest } = parsed.data;
  const db = getDb(c.env.DB);
  const [booth] = await db.select().from(schema.booths).where(eq(schema.booths.id, boothId)).limit(1);
  if (!booth) return c.json({ error: "Booth tidak ditemukan" }, 404);
  if (booth.bridgeToken !== token) {
    logger.warn("bridge_invalid_token", { boothId });
    return c.json({ error: "Token bridge tidak valid" }, 401);
  }

  // Merge onto existing metadata so unrelated keys (e.g. admin-set
  // `use_mock_bridge`, see src/routes/booths.ts) survive every heartbeat.
  const metadata = {
    ...((booth.metadata as Record<string, unknown> | null) ?? {}),
    ...rest,
    lastHeartbeat: new Date().toISOString(),
  };

  await db
    .update(schema.booths)
    .set({ lastSeenAt: new Date(), metadata })
    .where(eq(schema.booths.id, boothId));

  const settings = await getAllSettings(db);
  return c.json({
    ok: true,
    serverTime: new Date().toISOString(),
    settings: { general: settings.general },
  });
});

bridgeRoutes.get("/resolve", async (c) => {
  const token = bearerToken(c);
  if (!token) return c.json({ error: "Bridge token diperlukan" }, 401);

  const db = getDb(c.env.DB);
  const [booth] = await db
    .select({ id: schema.booths.id, name: schema.booths.name })
    .from(schema.booths)
    .where(eq(schema.booths.bridgeToken, token))
    .limit(1);
  if (!booth) {
    return c.json({ error: "Token tidak dikenal" }, 401);
  }
  return c.json({ data: { boothId: booth.id, name: booth.name } });
});

// ---------------------------------------------------------------------------
// sessionUploadRoutes — mounted at /api/session (no basePath of its own)
// ---------------------------------------------------------------------------

export const sessionUploadRoutes = new Hono<{ Bindings: Bindings }>();

sessionUploadRoutes.put("/:id/photos", async (c) => {
  const id = c.req.param("id");
  const auth = await authorizeSessionUpload(c, id);
  if ("errorResponse" in auth) return auth.errorResponse;
  const { session } = auth;

  const validated = validateUploadHeaders(c);
  if ("errorResponse" in validated) return validated.errorResponse;
  const { contentType } = validated;

  const body = c.req.raw.body;
  if (!body) return c.json({ error: "Body kosong" }, 400);

  const sortOrderRaw = c.req.query("sortOrder");
  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) || 0 : 0;

  const key = sessionAssetKey(session.boothId, session.id, `photo-${sortOrder}.png`);
  await uploadObject(c.env.BUCKET, { key, body, contentType });

  await onPhotoUploaded(c.env, session.boothId, {
    sessionId: session.id,
    index: sortOrder,
    r2Key: key,
  });

  logger.info("photo_uploaded", { sessionId: session.id, key, sortOrder });
  return c.json({ data: { key } });
});

sessionUploadRoutes.put("/:id/composite", async (c) => {
  const id = c.req.param("id");
  const auth = await authorizeSessionUpload(c, id);
  if ("errorResponse" in auth) return auth.errorResponse;
  const { session } = auth;

  const validated = validateUploadHeaders(c);
  if ("errorResponse" in validated) return validated.errorResponse;
  const { contentType } = validated;

  const body = c.req.raw.body;
  if (!body) return c.json({ error: "Body kosong" }, 400);

  const key = sessionAssetKey(session.boothId, session.id, "composite.png");
  await uploadObject(c.env.BUCKET, { key, body, contentType });

  await onCompositeUploaded(c.env, session.boothId, {
    sessionId: session.id,
    r2Key: key,
  });

  logger.info("composite_uploaded", { sessionId: session.id, key });
  return c.json({ data: { key } });
});

// ---------------------------------------------------------------------------
// downloadRoutes — mounted at /api/download (no basePath of its own)
// ---------------------------------------------------------------------------

export const downloadRoutes = new Hono<{ Bindings: Bindings }>();

downloadRoutes.get("/bridge", (c) => {
  const env = getEnv(c.env);
  const url = getPublicUrl(env.PUBLIC_CDN_URL, downloadKey("Mote-Capture-Bridge-Setup.exe"));
  return c.redirect(url, 302);
});
