// Cron Trigger handler for the `apps/api` Worker (T2.9).
//
// Why Cron Trigger and not a Durable Object alarm: both jobs below are
// GLOBAL sweeps across every booth/session, not state belonging to one
// booth. A DO alarm is scoped to a single DO instance (one booth), so it's
// the wrong tool for "find every booth that went quiet" or "expire every
// stale session" — a Cron Trigger firing once for the whole Worker is.
//
// Each job is wrapped in its own try/catch so a failure in one never blocks
// the other (see wrangler.jsonc `triggers.crons` for the schedule).
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Bindings } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSetting } from "@/lib/settings";

export async function handleScheduled(
  _event: ScheduledController,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = getDb(env.DB);

  await alertOfflineBooths(db, env).catch((err) => {
    logger.error("scheduled_booth_offline_alert_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  });

  await expireHungPaymentSessions(db).catch((err) => {
    logger.error("scheduled_session_gc_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

// ---------------------------------------------------------------------------
// Job A — alert on booths that stopped heartbeating.
//
// `general.booth_alert_offline_minutes` (src/lib/settings.ts DEFAULTS.general)
// has existed since the old apps/cloud app but was never wired to anything —
// this is the first consumer.
//
// Anti-spam: we mark a booth as already-alerted by stamping
// `booths.metadata.offlineAlertedAt` (epoch ms) the first time it's caught
// stale, and skip it on subsequent runs while that stamp is present. The
// stamp is cleared as soon as the booth's `lastSeenAt` is fresh again, so a
// booth that flaps (offline -> online -> offline) gets alerted once per
// offline episode, not once ever.
//
// Admin notification channel: there is currently no admin phone/WhatsApp
// number anywhere in settings (src/lib/settings.ts SettingMap) or in
// Bindings/Secrets (src/lib/env.ts) — `wa.ts#sendText` needs a `to` number
// we simply don't have. Rather than invent a new field, this job only logs
// a structured warning per newly-offline booth. Wiring a real admin channel
// (new setting key + sendText call) is a follow-up once that field exists.
async function alertOfflineBooths(db: ReturnType<typeof getDb>, env: Bindings): Promise<void> {
  const general = await getSetting(db, "general");
  const thresholdMinutes = general.booth_alert_offline_minutes;
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);

  // isActive booths that have reported in at least once. Booths that never
  // reported (lastSeenAt IS NULL) are excluded per spec — that's "never
  // connected", not "went offline".
  const candidates = await db
    .select({
      id: schema.booths.id,
      name: schema.booths.name,
      lastSeenAt: schema.booths.lastSeenAt,
      metadata: schema.booths.metadata,
    })
    .from(schema.booths)
    .where(and(eq(schema.booths.isActive, true), isNotNull(schema.booths.lastSeenAt)));

  let alerted = 0;
  let cleared = 0;

  for (const booth of candidates) {
    const lastSeenAt = booth.lastSeenAt as Date;
    const isStale = lastSeenAt.getTime() < cutoff.getTime();
    const metadata = ((booth.metadata as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const alreadyAlerted = Boolean(metadata.offlineAlertedAt);

    if (isStale && !alreadyAlerted) {
      const minutesOffline = Math.floor((Date.now() - lastSeenAt.getTime()) / 60_000);
      logger.warn("booth_offline_alert", {
        boothId: booth.id,
        boothName: booth.name,
        lastSeenAt: lastSeenAt.toISOString(),
        minutesOffline,
        note: "no admin WhatsApp/phone setting configured — logged only, not sent",
      });
      await db
        .update(schema.booths)
        .set({ metadata: { ...metadata, offlineAlertedAt: Date.now() } })
        .where(eq(schema.booths.id, booth.id));
      alerted++;
    } else if (!isStale && alreadyAlerted) {
      const { offlineAlertedAt: _drop, ...rest } = metadata;
      await db.update(schema.booths).set({ metadata: rest }).where(eq(schema.booths.id, booth.id));
      cleared++;
    }
  }

  logger.info("scheduled_booth_offline_alert", {
    checked: candidates.length,
    thresholdMinutes,
    alerted,
    cleared,
    mockWa: !env.EVOLUTION_API_URL,
  });
}

// ---------------------------------------------------------------------------
// Job B — GC sessions stuck in "payment" past their expiry.
//
// Project rule elsewhere: BoothDO is the sole writer of the `sessions`
// table (it owns the live state machine for a session). This job is a
// deliberate, narrow exception to that rule: it is not a state transition of
// a *live* session, it's a global sweep that closes out sessions BoothDO
// itself can no longer act on (the booth may have moved on, restarted, or
// the DO instance may be gone) once their `expired_at` has already passed.
// The WHERE clause is intentionally restrictive — status='payment' AND
// expired_at < now — so it can only ever touch rows that are already dead
// by the booth's own deadline, never a session that's still live.
async function expireHungPaymentSessions(db: ReturnType<typeof getDb>): Promise<void> {
  const now = new Date();
  const result = await db
    .update(schema.sessions)
    .set({ status: "expired" })
    .where(and(eq(schema.sessions.status, "payment"), lt(schema.sessions.expiredAt, now)));

  logger.info("scheduled_session_gc", {
    expiredCount: result.meta.changes,
  });
}
