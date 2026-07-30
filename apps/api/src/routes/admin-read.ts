import { Hono } from "hono";
import { and, asc, count, desc, eq, gte, like, lt, lte, or, sum } from "drizzle-orm";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/db";
import { getPublicUrl } from "@/lib/storage";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";

// Read-only admin endpoints for the SPA. The old apps/cloud admin pages were
// Next.js Server Components that queried the DB directly (see
// apps/cloud/app/admin/{sessions,payments/transactions,dashboard}/{,[id]/}page.tsx)
// — there was never a JSON endpoint for any of this. This router is that
// missing JSON surface, scoped to exactly the fields those pages rendered.
//
// Mounted by src/index.ts (not this file) under whatever base path it picks;
// this router itself has no basePath so it works either way.

const app = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

app.use("*", requireAdmin);

// ---------------------------------------------------------------------------
// Paging helpers — Workers Free caps CPU at 10ms/request, so every list
// endpoint here is bounded: default 50 rows, hard cap 100, never "select *".
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---------------------------------------------------------------------------
// GET /sessions — list, matches apps/cloud/app/admin/sessions/page.tsx +
// the client-side filters in components/admin/sessions-list.tsx (booth,
// status, free-text search over id/phone/email). The old page pulled the
// 500 latest rows and filtered in the browser; here it's paged + filtered
// in SQL instead, since we can't afford to return the whole table.
// ---------------------------------------------------------------------------

app.get("/sessions", async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query();

  const limit = clampLimit(q.limit);
  const offset = parseOffset(q.offset);

  const conditions = [];
  if (q.status) conditions.push(eq(schema.sessions.status, q.status));
  if (q.boothId) conditions.push(eq(schema.sessions.boothId, q.boothId));

  const from = parseDate(q.from);
  if (from) conditions.push(gte(schema.sessions.createdAt, from));
  const to = parseDate(q.to);
  if (to) conditions.push(lte(schema.sessions.createdAt, to));

  if (q.q) {
    const needle = `%${q.q.trim()}%`;
    conditions.push(
      or(
        like(schema.sessions.id, needle),
        like(schema.sessions.customerPhone, needle),
        like(schema.sessions.customerEmail, needle),
      ),
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: schema.sessions.id,
      boothId: schema.sessions.boothId,
      boothName: schema.booths.name,
      status: schema.sessions.status,
      amount: schema.sessions.amount,
      customerEmail: schema.sessions.customerEmail,
      customerPhone: schema.sessions.customerPhone,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .leftJoin(schema.booths, eq(schema.booths.id, schema.sessions.boothId))
    .where(where)
    .orderBy(desc(schema.sessions.createdAt))
    .limit(limit + 1) // fetch one extra row to know if there's a next page
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    data: page.map((r) => ({
      id: r.id,
      boothId: r.boothId,
      boothName: r.boothName ?? r.boothId,
      status: r.status,
      amount: r.amount,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: {
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /sessions/:id — detail, matches
// apps/cloud/app/admin/sessions/[id]/page.tsx (184 lines): session core
// fields + booth name + share link, the frame used, the photo grid (CDN
// URLs), and the payment log timeline. qrString is never rendered by that
// page, so it's deliberately omitted here.
// ---------------------------------------------------------------------------

app.get("/sessions/:id", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(c.env.DB);
  const id = c.req.param("id");

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session) {
    return c.json({ error: "Session tidak ditemukan" }, 404);
  }

  const [booth] = session.boothId
    ? await db
        .select({ id: schema.booths.id, name: schema.booths.name })
        .from(schema.booths)
        .where(eq(schema.booths.id, session.boothId))
        .limit(1)
    : [];

  const [frame] = session.frameId
    ? await db
        .select({
          id: schema.frames.id,
          name: schema.frames.name,
          tier: schema.frames.tier,
          previewKey: schema.frames.previewKey,
        })
        .from(schema.frames)
        .where(eq(schema.frames.id, session.frameId))
        .limit(1)
    : [];

  const [photos, logs] = await Promise.all([
    db
      .select({
        id: schema.photos.id,
        r2Key: schema.photos.r2Key,
        isFinal: schema.photos.isFinal,
        sortOrder: schema.photos.sortOrder,
        createdAt: schema.photos.createdAt,
      })
      .from(schema.photos)
      .where(eq(schema.photos.sessionId, session.id))
      .orderBy(asc(schema.photos.sortOrder)),
    db
      .select({
        id: schema.paymentLogs.id,
        provider: schema.paymentLogs.provider,
        eventType: schema.paymentLogs.eventType,
        payload: schema.paymentLogs.payload,
        createdAt: schema.paymentLogs.createdAt,
      })
      .from(schema.paymentLogs)
      .where(eq(schema.paymentLogs.sessionId, session.id))
      .orderBy(desc(schema.paymentLogs.createdAt)),
  ]);

  const shareUrl = session.downloadToken
    ? `${env.APP_URL.replace(/\/$/, "")}/share/${session.downloadToken}`
    : null;

  return c.json({
    data: {
      id: session.id,
      status: session.status,
      boothId: session.boothId,
      boothName: booth?.name ?? session.boothId,
      amount: session.amount,
      paymentProvider: session.paymentProvider,
      paymentRef: session.paymentRef,
      customerEmail: session.customerEmail,
      customerPhone: session.customerPhone,
      createdAt: session.createdAt.toISOString(),
      paidAt: session.paidAt ? session.paidAt.toISOString() : null,
      printCompletedAt: session.printCompletedAt ? session.printCompletedAt.toISOString() : null,
      downloadExpiresAt: session.downloadExpiresAt ? session.downloadExpiresAt.toISOString() : null,
      shareUrl,
      frame: frame
        ? {
            id: frame.id,
            name: frame.name,
            tier: frame.tier,
            previewUrl: frame.previewKey ? getPublicUrl(env.PUBLIC_CDN_URL, frame.previewKey) : null,
          }
        : null,
      photos: photos.map((p) => ({
        id: p.id,
        url: getPublicUrl(env.PUBLIC_CDN_URL, p.r2Key),
        isFinal: p.isFinal,
        sortOrder: p.sortOrder,
        createdAt: p.createdAt.toISOString(),
      })),
      paymentLogs: logs.map((l) => ({
        id: l.id,
        provider: l.provider,
        eventType: l.eventType,
        payload: l.payload,
        createdAt: l.createdAt.toISOString(),
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /transactions — matches
// apps/cloud/app/admin/payments/transactions/page.tsx (105 lines): time,
// event type, provider, session id (link), payload preview. The old page
// pulled the 200 latest rows with no filters; paging replaces the fixed
// limit, and sessionId/eventType/provider filters are added as a bonus
// since the columns are already there for the join.
// ---------------------------------------------------------------------------

app.get("/transactions", async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query();

  const limit = clampLimit(q.limit);
  const offset = parseOffset(q.offset);

  const conditions = [];
  if (q.sessionId) conditions.push(eq(schema.paymentLogs.sessionId, q.sessionId));
  if (q.eventType) conditions.push(eq(schema.paymentLogs.eventType, q.eventType));
  if (q.provider) conditions.push(eq(schema.paymentLogs.provider, q.provider));

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: schema.paymentLogs.id,
      sessionId: schema.paymentLogs.sessionId,
      provider: schema.paymentLogs.provider,
      eventType: schema.paymentLogs.eventType,
      payload: schema.paymentLogs.payload,
      createdAt: schema.paymentLogs.createdAt,
    })
    .from(schema.paymentLogs)
    .where(where)
    .orderBy(desc(schema.paymentLogs.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    data: page.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      provider: r.provider,
      eventType: r.eventType,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: {
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /dashboard — matches apps/cloud/app/admin/dashboard/page.tsx's 4 stat
// tiles (Booth Aktif, Frame Tersedia, Transaksi Bulan Ini, Pendapatan Bulan
// Ini). That page was a static Sprint-1 placeholder ("Tersedia di Sprint 2")
// with no real query behind it — these are the real aggregates it was
// always meant to show, computed with SQL COUNT/SUM (never pulling rows
// into JS to add them up).
// ---------------------------------------------------------------------------

app.get("/dashboard", async (c) => {
  const db = getDb(c.env.DB);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [[activeBooths], [availableFrames], [monthly]] = await Promise.all([
    db.select({ value: count() }).from(schema.booths).where(eq(schema.booths.isActive, true)),
    db.select({ value: count() }).from(schema.frames).where(eq(schema.frames.isActive, true)),
    db
      .select({ transactions: count(), revenue: sum(schema.sessions.amount) })
      .from(schema.sessions)
      .where(
        and(
          gte(schema.sessions.paidAt, monthStart),
          lt(schema.sessions.paidAt, nextMonthStart),
        ),
      ),
  ]);

  return c.json({
    data: {
      activeBooths: activeBooths?.value ?? 0,
      availableFrames: availableFrames?.value ?? 0,
      transactionsThisMonth: monthly?.transactions ?? 0,
      revenueThisMonth: Number(monthly?.revenue ?? 0),
    },
  });
});

export default app;
