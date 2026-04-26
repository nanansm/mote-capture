import nodemailer, { type Transporter } from "nodemailer";
import { emailConfigured, env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { downloadLinkHtml, downloadLinkText, type DownloadLinkVars } from "./templates/download-link";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!emailConfigured) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.EMAIL_HOST!,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_SECURE,
    pool: true,
    maxConnections: 3,
    auth: {
      user: env.EMAIL_USER!,
      pass: env.EMAIL_PASSWORD!,
    },
  });
  return transporter;
}

export type SendResult = {
  ok: boolean;
  messageId?: string;
  mockMode: boolean;
  message?: string;
};

export async function sendDownloadLinkEmail(params: {
  to: string;
  subject?: string;
  vars: DownloadLinkVars;
  fromName?: string;
}): Promise<SendResult> {
  const t = getTransporter();
  const subject = params.subject ?? "Foto Kamu Sudah Siap! 📸";
  if (!t) {
    logger.warn("email_mock_send", { to: params.to, subject });
    return { ok: true, mockMode: true, message: "Mock: email tidak ter-konfigurasi" };
  }
  try {
    const info = await t.sendMail({
      from: `"${params.fromName ?? env.EMAIL_FROM_NAME}" <${env.EMAIL_USER!}>`,
      to: params.to,
      subject,
      text: downloadLinkText(params.vars),
      html: downloadLinkHtml(params.vars),
    });
    return { ok: true, messageId: info.messageId, mockMode: false };
  } catch (err) {
    logger.error("email_send_failed", { err: err instanceof Error ? err.message : String(err) });
    return {
      ok: false,
      mockMode: false,
      message: err instanceof Error ? err.message : "Email send error",
    };
  }
}

export async function sendTestEmail(to: string): Promise<SendResult> {
  const t = getTransporter();
  if (!t) {
    logger.warn("email_mock_test", { to });
    return { ok: true, mockMode: true, message: "Mock: email tidak ter-konfigurasi" };
  }
  try {
    const info = await t.sendMail({
      from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_USER!}>`,
      to,
      subject: "Test koneksi email — Mote Capture",
      text: "Halo! Ini email test dari Mote Capture. Kalau kamu menerima ini, koneksi SMTP-mu berhasil. 🎉",
      html: "<p>Halo! Ini email test dari <strong>Mote Capture</strong>. Kalau kamu menerima ini, koneksi SMTP-mu berhasil. 🎉</p>",
    });
    return { ok: true, messageId: info.messageId, mockMode: false };
  } catch (err) {
    return {
      ok: false,
      mockMode: false,
      message: err instanceof Error ? err.message : "Email send error",
    };
  }
}
