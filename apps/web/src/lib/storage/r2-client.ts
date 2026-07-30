// Client-safe helpers — no AWS SDK / Node fs imports.
//
// Fixed during T4.3 (was ported verbatim from apps/cloud/lib/storage/
// r2-client.ts in T4.1, before any page actually called it with real API
// data): the old apps/cloud app proxied every image through a local
// `/api/r2/[...key]` Next.js route (for local/dev without a real CDN
// configured), so `displayUrl` rewrote any URL/key into that path. The new
// Worker (apps/api/src/index.ts's route table) never implements an
// `/api/r2/*` proxy — `getPublicUrl()` (apps/api/src/lib/storage.ts) already
// returns a fully-qualified `${PUBLIC_CDN_URL}/${key}` URL for every
// `*Url`/`photos[].url` field the API sends back, ready to use directly as
// an `<img src>` or fetch target. Rewriting it through `/api/r2/...` (as
// this file used to) 404s — every frame preview/background/logo and every
// session/share photo would silently break. `displayUrl` is now a
// passthrough; `urlToKey` is kept (still used by FrameForm to recover the
// R2 key from an already-uploaded asset's URL for re-submission).
export function urlToKey(urlOrKey: string): string {
  if (!urlOrKey) return urlOrKey;
  const m = urlOrKey.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (m) return m[1]!;
  return urlOrKey.replace(/^\/+/, "");
}

export function displayUrl(urlOrKey: string | null | undefined): string {
  return urlOrKey ?? "";
}
