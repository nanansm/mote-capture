// Ported from apps/cloud/app/share/[token]/page.tsx (a Next.js server
// component) into a JSON API endpoint — the actual HTML page now lives in
// apps/web (a separate task) and calls this route for data.
//
// Differences from the old page:
//  - Returns JSON, not HTML. Field selection (session, booth name, photo
//    list with `isFinal`, expiry) mirrors exactly what that page needed:
//    apps/cloud/app/share/[token]/page.tsx:96-107 (query), :133-160
//    (composite/individual split via `isFinal`), :176-183 (expiry text).
//  - Status codes for the three "can't show photos yet" states are kept
//    identical to the old page's *intent* (it rendered a state card
//    instead of an HTTP status because Next pages can't set one from a
//    server component body easily) — and identical to the sibling ZIP
//    route that DID set real statuses for the same three checks
//    (apps/cloud/app/api/share/[token]/zip/route.ts:16-24):
//      unknown token          -> 404
//      downloadExpiresAt past -> 410
//      status !== "done"      -> 425
//  - Photo URLs: apps/cloud/app/share/[token]/page.tsx:139/151 called
//    `displayUrl(p.url)` because the old `photos.url` column held a full
//    (possibly-mock) URL already. The new `photos.r2Key` column
//    (src/db/schema.ts) holds only the R2 object key, so URLs are built
//    here with `getPublicUrl(env.PUBLIC_CDN_URL, key)` instead.
//  - No ZIP link/route — see the ZIP endpoint's own file header
//    (apps/cloud/app/api/share/[token]/zip/route.ts) for why: the old zip
//    library is a Node stream API with no Workers equivalent, and it's also CPU-heavy
//    (well past the Workers Free 10ms/request budget). The new
//    architecture builds the zip client-side in the browser from this
//    route's photo URL list instead.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/db";
import { getPublicUrl } from "@/lib/storage";

const share = new Hono<{ Bindings: Bindings }>();

share.get("/:token", async (c) => {
  const token = c.req.param("token");
  const env = getEnv(c.env);
  const db = getDb(c.env.DB);

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.downloadToken, token))
    .limit(1);

  if (!session) {
    return c.json({ error: "Link tidak valid" }, 404);
  }

  if (session.downloadExpiresAt && session.downloadExpiresAt.getTime() < Date.now()) {
    return c.json(
      {
        error: "Link sudah expired",
        downloadExpiresAt: session.downloadExpiresAt.toISOString(),
      },
      410,
    );
  }

  if (session.status !== "done") {
    return c.json({ error: "Foto belum siap" }, 425);
  }

  const [booth] = await db
    .select({ name: schema.booths.name })
    .from(schema.booths)
    .where(eq(schema.booths.id, session.boothId))
    .limit(1);

  const photos = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.sessionId, session.id))
    .orderBy(schema.photos.sortOrder);

  return c.json({
    session: {
      id: session.id,
      boothName: booth?.name ?? "Maja Photobooth",
      downloadExpiresAt: session.downloadExpiresAt ? session.downloadExpiresAt.toISOString() : null,
    },
    photos: photos.map((p) => ({
      id: p.id,
      url: getPublicUrl(env.PUBLIC_CDN_URL, p.r2Key),
      isFinal: p.isFinal,
      sortOrder: p.sortOrder,
    })),
  });
});

export default share;
