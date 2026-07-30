// Ported from apps/cloud/app/api/session/[id]/{contact,notify,resend}/route.ts.
//
// This router only covers the non-upload session endpoints (contact,
// notify, resend). photos/composite/start-capture belong to other tasks.
//
// Differences from the old routes:
//  - No direct `db.update(schema.sessions)` for customerPhone/customerEmail
//    (apps/cloud/app/api/session/[id]/contact/route.ts:44-47 and
//    .../notify/route.ts:33-39). This Worker's `sessions` table is owned by
//    BoothDO (src/do/rpc.ts header) — the write path here is
//    `setContact(env, boothId, { sessionId, phone, email })`, currently a
//    logging stub (src/do/rpc.ts `notImplemented`) until BoothDO itself is
//    implemented in a later task. `notifySession` still reads
//    `customerPhone`/`customerEmail` straight off the D1 row, so until that
//    DO lands, contact info only actually reaches D1 via whatever wrote the
//    row already (e.g. seed data) — this is expected for this task's scope,
//    not a bug in this router.
//  - Auth split matches apps/cloud/middleware.ts's public-route matcher
//    (line 52: `/^\/api\/session\/[^/]+\/(photos|composite|start-capture|contact)$/`
//    explicitly includes `contact` but not `notify`/`resend`, which the old
//    app gated with `getCurrentSession()` in-route, i.e. admin-only):
//      POST /:id/contact  -> public (customer-facing contact form)
//      POST /:id/notify   -> requireAdmin
//      POST /:id/resend   -> requireAdmin
//  - Decision (deviation from old /notify route): the old route allowed
//    partial admin-supplied contact updates — phone-only, email-only, or
//    neither (apps/cloud/app/api/session/[id]/notify/route.ts:24-39), each
//    field updated independently. The new `ContactInput` RPC type
//    (src/do/rpc.ts) requires `phone` as non-optional. To stay closer to
//    the RPC's contract instead of loosening it, this router only calls
//    `setContact` when the admin supplies a `phone`; an email-only payload
//    is accepted (200) but does not attempt a contact update — it just
//    proceeds to (re)notify using whatever contact info is already on the
//    session row. Flag this if admin UI needs true email-only updates once
//    BoothDO's real setContact lands.
//  - Existence check: the old routes didn't verify the session existed
//    before running an update/notify (a no-op `WHERE id = ...` update on a
//    missing row silently succeeded). Since this router needs the
//    session's `boothId` to call `setContact` anyway, a missing session is
//    surfaced as 404 instead of silently doing nothing.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Bindings } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import { notifySession } from "@/lib/notify";
import { formatPhoneNumber } from "@/lib/wa";
import { setContact } from "@/do/rpc";
import { logger } from "@/lib/logger";

const session = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

// Indonesian phone format: 08xxxx, 8xxxx, +62xxxx, 62xxxx — converted to
// 62xxxx. Ported as-is from apps/cloud/app/api/session/[id]/contact/route.ts.
const phoneSchema = z
  .string()
  .min(8, "Nomor terlalu pendek")
  .max(20, "Nomor terlalu panjang")
  .refine(
    (v) => /^(\+?62|0|8)[\d\s\-]{6,}$/.test(v.trim()),
    "Format nomor WhatsApp Indonesia tidak valid",
  );

const contactBodySchema = z.object({
  phone: phoneSchema,
  email: z
    .string()
    .email("Email tidak valid")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
});

// PUBLIC — customer-facing contact form after a session finishes.
session.post("/:id/contact", async (c) => {
  const id = c.req.param("id");

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = contactBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }

  const db = getDb(c.env.DB);
  const [existing] = await db
    .select({ boothId: schema.sessions.boothId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Sesi tidak ditemukan" }, 404);
  }

  const phone = formatPhoneNumber(parsed.data.phone);
  await setContact(c.env, existing.boothId, {
    sessionId: id,
    phone,
    email: parsed.data.email,
  });

  let waSent = false;
  let emailSent = false;
  try {
    const result = await notifySession(c.env, id);
    waSent = Boolean(result.whatsapp?.ok);
    emailSent = Boolean(result.email?.ok);
  } catch (err) {
    logger.warn("contact_notify_failed", {
      sessionId: id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return c.json({ ok: true, sent: { wa: waSent, email: emailSent } });
});

const notifyBodySchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

// ADMIN-ONLY — applied via `.use()` on the specific paths (rather than
// passing `requireAdmin` inline as a route arg) because Hono's 3-arg
// `.post(path, middleware, handler)` overload doesn't propagate the `:id`
// param's literal type into `c.req.param("id")` the way the 2-arg
// `.post(path, handler)` overload used everywhere else in this codebase
// does (see src/routes/booths.ts:20/62 for the same `.use("*", ...)` then
// 2-arg-route pattern) — this keeps `id` typed as `string`, not
// `string | undefined`, without a cast.
session.use("/:id/notify", requireAdmin);
session.use("/:id/resend", requireAdmin);

session.post("/:id/notify", async (c) => {
  const id = c.req.param("id");

  let json: unknown = {};
  try {
    json = await c.req.json();
  } catch {
    // empty body is allowed
  }
  const parsed = notifyBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }

  if (parsed.data.phone) {
    const db = getDb(c.env.DB);
    const [existing] = await db
      .select({ boothId: schema.sessions.boothId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .limit(1);
    if (!existing) {
      return c.json({ error: "Sesi tidak ditemukan" }, 404);
    }
    await setContact(c.env, existing.boothId, {
      sessionId: id,
      phone: parsed.data.phone,
      email: parsed.data.email,
    });
  }

  try {
    const result = await notifySession(c.env, id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Gagal mengirim notifikasi" },
      500,
    );
  }
});

session.post("/:id/resend", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await notifySession(c.env, id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Gagal mengirim ulang" }, 500);
  }
});

export default session;
