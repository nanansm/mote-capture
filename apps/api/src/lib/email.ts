// Ported from apps/cloud/lib/email/client.ts + the HTML/text templates in
// apps/cloud/lib/email/templates/download-link.ts.
//
// Differences from the old module:
//  - The old SMTP-based mail client has no Workers equivalent (no
//    persistent TCP sockets for a pooled SMTP connection) — replaced with
//    a single `fetch` call to the Resend REST API (POST
//    https://api.resend.com/emails), same as the "test connection" ping
//    already implemented in src/routes/settings.ts. The sender address
//    comes from `env.EMAIL_FROM`/`env.EMAIL_FROM_NAME` (src/lib/env.ts,
//    set via wrangler.jsonc `vars`), defaulting to
//    "Mote Capture <onboarding@resend.dev>" because
//    send.motekreatif.com is not yet verified in Resend — Resend rejects
//    sends from unverified domains.
//  - No module-level transporter singleton: every call takes `Env` (from
//    `getEnv(bindings)`) as an argument instead of reading a cached client.
//  - Empty `RESEND_API_KEY` → mock mode, same spirit as the old code's
//    "no transporter configured" branch: logs "would send" and resolves
//    `{ ok: true, mockMode: true }` instead of throwing.
//  - `sendTestEmail` (apps/cloud/lib/email/client.ts:59-76) is not ported —
//    src/routes/settings.ts already has its own test-connection ping for
//    email and isn't part of this task's scope.
import type { Env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type DownloadLinkVars = {
  link: string;
  boothName: string;
  expiryDate: string;
};

export type SendResult = {
  ok: boolean;
  messageId?: string;
  mockMode: boolean;
  message?: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_SUBJECT = "Foto Kamu Sudah Siap! 📸";

function escape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Ported as-is from apps/cloud/lib/email/templates/download-link.ts.
export function downloadLinkHtml(v: DownloadLinkVars): string {
  return `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:0;background:#F5F0E8;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1A3A2A;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F0E8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(26,58,42,0.08);">
            <tr>
              <td style="padding:32px 32px 16px 32px;text-align:center;">
                <p style="margin:0;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#86A398;">Mote Capture</p>
                <h1 style="margin:12px 0 0 0;font-size:28px;line-height:1.2;color:#1A3A2A;">Foto Kamu Sudah Siap! 📸</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;font-size:16px;line-height:1.5;color:#1A3A2A;">
                <p style="margin:0 0 16px 0;">Halo!</p>
                <p style="margin:0 0 16px 0;">Terima kasih sudah berfoto di <strong>${escape(v.boothName)}</strong>. Foto kamu sudah siap di-download lewat tombol di bawah.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 32px 32px;">
                <a href="${escape(v.link)}" style="display:inline-block;background:#F5E642;color:#1A3A2A;padding:14px 32px;border-radius:9999px;font-weight:700;text-decoration:none;font-size:16px;">Download Foto</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;font-size:14px;color:#5A6E63;text-align:center;">
                <p style="margin:0 0 8px 0;">Atau buka link ini:</p>
                <p style="margin:0 0 16px 0;word-break:break-all;"><a href="${escape(v.link)}" style="color:#1A3A2A;">${escape(v.link)}</a></p>
                <p style="margin:0;">Link berlaku sampai <strong>${escape(v.expiryDate)}</strong>.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#1A3A2A;color:#F5E642;padding:24px;text-align:center;font-size:13px;">
                <p style="margin:0;">— Maja Photobooth × Mote Kreatif</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Ported as-is from apps/cloud/lib/email/templates/download-link.ts.
export function downloadLinkText(v: DownloadLinkVars): string {
  return [
    "Foto kamu sudah siap! 📸",
    "",
    `Terima kasih sudah berfoto di ${v.boothName}.`,
    "",
    "Download di sini:",
    v.link,
    "",
    `Link berlaku sampai ${v.expiryDate}.`,
    "",
    "— Maja Photobooth × Mote Kreatif",
  ].join("\n");
}

export async function sendDownloadLinkEmail(
  env: Env,
  params: {
    to: string;
    subject?: string;
    fromName?: string;
    vars: DownloadLinkVars;
  },
): Promise<SendResult> {
  const subject = params.subject ?? DEFAULT_SUBJECT;

  if (!env.RESEND_API_KEY) {
    logger.warn("email_mock_send", { to: params.to, subject });
    return { ok: true, mockMode: true, message: "Mock: email tidak ter-konfigurasi" };
  }

  const fromName = params.fromName ?? env.EMAIL_FROM_NAME ?? "Mote Capture";
  const fromAddress = env.EMAIL_FROM ?? "onboarding@resend.dev";
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [params.to],
        subject,
        html: downloadLinkHtml(params.vars),
        text: downloadLinkText(params.vars),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.error("email_send_failed", { status: res.status, body: text.slice(0, 300) });
      return { ok: false, mockMode: false, message: `Resend responded ${res.status}` };
    }
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // ignore — id is optional on the result
    }
    const messageId = typeof json.id === "string" ? json.id : undefined;
    return { ok: true, messageId, mockMode: false };
  } catch (err) {
    logger.error("email_send_error", { err: err instanceof Error ? err.message : String(err) });
    return {
      ok: false,
      mockMode: false,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}
