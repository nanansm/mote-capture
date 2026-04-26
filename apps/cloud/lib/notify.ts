import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { sendDownloadLinkEmail } from "@/lib/email/client";
import { sendText } from "@/lib/wa/evolution";
import { formatDateID, getSetting, renderTemplate } from "@/lib/settings/store";
import { logger } from "@/lib/logger";

export type NotifyResult = {
  whatsapp?: { ok: boolean; mockMode: boolean; message?: string };
  email?: { ok: boolean; mockMode: boolean; message?: string };
};

export async function notifySession(sessionId: string): Promise<NotifyResult> {
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

  const link = `${env.NEXT_PUBLIC_APP_URL}/share/${session.downloadToken}`;
  const expiry = session.downloadExpiresAt ?? new Date(Date.now() + env.DOWNLOAD_LINK_EXPIRY_DAYS * 86400_000);

  const out: NotifyResult = {};

  // WhatsApp
  const wa = await getSetting("whatsapp");
  if (wa.enabled && session.customerPhone) {
    const msg = renderTemplate(wa.template, {
      link,
      nama_booth: booth?.name ?? "Maja Photobooth",
      tanggal: formatDateID(new Date()),
    });
    out.whatsapp = await sendText({ to: session.customerPhone, message: msg });
    logger.info("notify_whatsapp", {
      sessionId,
      ok: out.whatsapp.ok,
      mock: out.whatsapp.mockMode,
    });
  }

  // Email
  const emailSettings = await getSetting("email");
  if (emailSettings.enabled && session.customerEmail) {
    out.email = await sendDownloadLinkEmail({
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
