import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getDb, schema } from "@/db";
import adminReadRoutes from "@/routes/admin-read";
import authRoutes from "@/routes/auth";
import boothsRoutes from "@/routes/booths";
import { bridgeRoutes, downloadRoutes, sessionUploadRoutes } from "@/routes/bridge";
import framesRoutes from "@/routes/frames";
import kioskRoutes from "@/routes/kiosk";
import sessionRoutes from "@/routes/session";
import sessionAdminRoutes, { devMockPayRoutes } from "@/routes/session-admin";
import settingsRoutes from "@/routes/settings";
import shareRoutes from "@/routes/share";
import uploadRoutes from "@/routes/upload";
import { adminVoucherRoutes, publicVoucherRoutes } from "@/routes/voucher";
import webhookRoutes from "@/routes/webhook";
import { handleScheduled } from "@/scheduled";

export { BoothDO } from "@/do/booth";
export { AdminDO } from "@/do/admin";

const app = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

app.get("/api/health", (c) => {
  return c.json({ ok: true, ts: Date.now() });
});

app.route("/api/auth", authRoutes);
app.route("/api/booths", boothsRoutes);
app.route("/api/frames", framesRoutes);
app.route("/api/kiosk", kioskRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/upload", uploadRoutes);
app.route("/api/admin/voucher", adminVoucherRoutes);
app.route("/api/voucher", publicVoucherRoutes);
app.route("/api/admin", adminReadRoutes);
app.route("/api/bridge", bridgeRoutes);
app.route("/api/download", downloadRoutes);
app.route("/api/webhook", webhookRoutes);
app.route("/api/share", shareRoutes);
app.route("/api/dev", devMockPayRoutes);
// Three routers share the /api/session prefix: uploads come from the bridge
// (bearer token), sessionRoutes covers kiosk/admin contact+notify+resend,
// sessionAdminRoutes covers admin reset+refund. Hono matches in registration
// order and none of these paths overlap (:id/photos, :id/composite vs.
// :id/contact, :id/notify, :id/resend vs. :id/reset, :id/refund).
app.route("/api/session", sessionUploadRoutes);
app.route("/api/session", sessionRoutes);
app.route("/api/session", sessionAdminRoutes);

// ---------------------------------------------------------------------------
// WebSocket upgrade routes — T3.2. Auth happens HERE, in the Worker, before
// the request is ever forwarded to BoothDO: the DO trusts that by the time
// it sees a fetch(), the caller has already been validated. The DO's own
// fetch() (src/do/booth.ts) parses `boothId` back out of the rewritten
// pathname (`/kiosk/:boothId` or `/bridge/:boothId`).
// ---------------------------------------------------------------------------

app.get("/ws/kiosk/:boothId", async (c) => {
  if ((c.req.header("upgrade") ?? "").toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }
  const boothId = c.req.param("boothId");
  const db = getDb(c.env.DB);
  const [booth] = await db
    .select({ id: schema.booths.id, isActive: schema.booths.isActive })
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  // boothId is not a secret — it's already in the kiosk page's own URL — so
  // the only gate needed here is "does this booth exist and is it active".
  if (!booth || !booth.isActive) {
    return c.text("Booth tidak ditemukan", 404);
  }

  const stub = c.env.BOOTH_DO.get(c.env.BOOTH_DO.idFromName(boothId));
  const url = new URL(c.req.url);
  url.pathname = `/kiosk/${boothId}`;
  return stub.fetch(new Request(url, c.req.raw));
});

app.get("/ws/bridge/:boothId", async (c) => {
  if ((c.req.header("upgrade") ?? "").toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }
  const boothId = c.req.param("boothId");

  // Bearer token ONLY — never a query string (would leak into access logs).
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return c.text("Bridge token diperlukan", 401);
  }

  const db = getDb(c.env.DB);
  const [booth] = await db
    .select({ id: schema.booths.id, bridgeToken: schema.booths.bridgeToken, isActive: schema.booths.isActive })
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  if (!booth || !booth.isActive || booth.bridgeToken !== token) {
    return c.text("Unauthorized", 401);
  }

  const stub = c.env.BOOTH_DO.get(c.env.BOOTH_DO.idFromName(boothId));
  const url = new URL(c.req.url);
  url.pathname = `/bridge/${boothId}`;
  return stub.fetch(new Request(url, c.req.raw));
});

// GET /ws/admin — realtime admin dashboard. AdminDO is a singleton (always
// `idFromName("overview")`, see src/do/admin.ts + src/do/rpc.ts), so unlike
// the kiosk/bridge routes above there is no per-booth id in the path.
//
// Auth happens HERE, same as kiosk/bridge: a same-origin WebSocket upgrade
// carries the `capture-session` cookie automatically, so it's verified
// before the request is ever forwarded to the DO — never accept a token via
// query string (it would leak into access logs).
app.get("/ws/admin", async (c) => {
  if ((c.req.header("upgrade") ?? "").toLowerCase() !== "websocket") {
    return c.text("Expected WebSocket upgrade", 426);
  }

  const env = getEnv(c.env);
  if (!env.BETTER_AUTH_SECRET) {
    return c.text("Unauthorized", 401);
  }
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySessionToken(token, env.BETTER_AUTH_SECRET);
  if (!session) {
    return c.text("Unauthorized", 401);
  }

  const stub = c.env.ADMIN_DO.get(c.env.ADMIN_DO.idFromName("overview"));
  const url = new URL(c.req.url);
  url.pathname = "/admin";
  return stub.fetch(new Request(url, c.req.raw));
});

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
