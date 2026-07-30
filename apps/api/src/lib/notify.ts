// Ported from apps/cloud/lib/notify.ts.
//
// Differences from the old module:
//  - No module-level `db`/`env` singletons: `notifySession` takes the
//    Worker `Bindings` (from `c.env`) as its first argument and derives
//    both `getEnv(bindings)` and `getDb(bindings.DB)` per call.
//  - `sendDownloadLinkEmail`/`sendText` now come from src/lib/email.ts and
//    src/lib/wa.ts (Resend REST API + Evolution `fetch`, see those files'
//    headers) instead of apps/cloud/lib/email/client.ts (the old SMTP-based
//    mail client) and apps/cloud/lib/wa/evolution.ts.
//  - `session.downloadToken`/`downloadExpiresAt` are read straight off the
//    D1 row exactly like the old Postgres row — no change there, this
//    table isn't written by this module either way (see setContact in
//    src/routes/session.ts, which owns the write path via the BoothDO RPC).
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { sendDownloadLinkEmail } from "@/lib/email";
import { sendText } from "@/lib/wa";
import { formatDateID, getSetting, renderTemplate } from "@/lib/settings";
import { logger } from "@/lib/logger";

export type NotifyResult = {
  whatsapp?: { ok: boolean; mockMode: boolean; message?: string };
  email?: { ok: boolean; mockMode: boolean; message?: string };
};

export async function notifySession(env: Bindings, sessionId: string): Promise<NotifyResult> {
  const cfg = getEnv(env);
  const db = getDb(env.DB);

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) throw new Error("Session tidak ditemukan");

  const [booth] = await db
    .select({ name: schema.booths.name })
    .from(schema.booths)
    .where(eq(schema.booths.id, session.boothId))
    .limit(1);

  const link = `${cfg.APP_URL}/share/${session.downloadToken}`;
  const expiry =
    session.downloadExpiresAt ?? new Date(Date.now() + cfg.DOWNLOAD_LINK_EXPIRY_DAYS * 86_400_000);

  const out: NotifyResult = {};

  // WhatsApp
  const wa = await getSetting(db, "whatsapp");
  if (wa.enabled && session.customerPhone) {
    const msg = renderTemplate(wa.template, {
      link,
      nama_booth: booth?.name ?? "Maja Photobooth",
      tanggal: formatDateID(new Date()),
    });
    out.whatsapp = await sendText(cfg, { to: session.customerPhone, message: msg });
    logger.info("notify_whatsapp", {
      sessionId,
      ok: out.whatsapp.ok,
      mock: out.whatsapp.mockMode,
    });
  }

  // Email
  const emailSettings = await getSetting(db, "email");
  if (emailSettings.enabled && session.customerEmail) {
    out.email = await sendDownloadLinkEmail(cfg, {
      to: session.customerEmail,
      subject: emailSettings.subject ?? "Foto Kamu Sudah Siap! 📸",
      fromName: emailSettings.from_name,
      vars: {
        link,
        boothName: booth?.name ?? "Maja Photobooth",
        expiryDate: formatDateID(expiry),
      },
    });
    logger.info("notify_email", {
      sessionId,
      ok: out.email.ok,
      mock: out.email.mockMode,
    });
  }

  return out;
}
