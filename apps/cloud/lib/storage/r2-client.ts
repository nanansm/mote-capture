// Client-safe helpers — no AWS SDK / Node fs imports.
// Mirrors urlToKey/displayUrl from `r2.ts` so client components can use them.

export function urlToKey(urlOrKey: string): string {
  if (!urlOrKey) return urlOrKey;
  if (urlOrKey.startsWith("/uploads/")) return urlOrKey.slice("/uploads/".length);
  if (urlOrKey.startsWith("/api/r2/")) return urlOrKey.slice("/api/r2/".length);
  const m = urlOrKey.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (m) return m[1]!;
  return urlOrKey;
}

export function displayUrl(urlOrKey: string | null | undefined): string {
  if (!urlOrKey) return "";
  if (urlOrKey.startsWith("/uploads/")) return urlOrKey;
  if (urlOrKey.startsWith("/api/r2/")) return urlOrKey;
  const key = urlToKey(urlOrKey);
  if (!key) return urlOrKey;
  return `/api/r2/${key}`;
}
