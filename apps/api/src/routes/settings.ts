// Ported from apps/cloud/app/api/settings/route.ts +
// settings/test-connection/route.ts.
//
// Decision (no direct equivalent to port from apps/cloud for this part):
// the old test-connection route delegated to three fully-fledged client
// modules — apps/cloud/lib/email/client.ts (nodemailer/SMTP),
// apps/cloud/lib/wa/evolution.ts, and apps/cloud/lib/payment/providers/
// xendit.ts. None of those are part of this task's scope (T2.3 is
// booths/frames/settings/upload only) and SMTP sockets aren't available on
// Workers anyway. This route re-implements just the "ping" behavior of each
// service directly against Bindings secrets with plain `fetch`:
//   - email: apps/cloud's SMTP send is replaced with the Resend HTTP API
//     (RESEND_API_KEY is already declared as a Worker secret in
//     apps/api/src/lib/env.ts — SMTP has no Workers equivalent). Uses
//     Resend's unverified-domain sender (`onboarding@resend.dev`) so this
//     works without a domain being configured yet.
//   - whatsapp: same Evolution API instance-connection-state check as
//     apps/cloud/lib/wa/evolution.ts:77-116, ported to `fetch`.
//   - xendit: same GET /balance ping as
//     apps/cloud/lib/payment/providers/xendit.ts:141-157, with
//     `Buffer.from(...).toString("base64")` replaced by `btoa` for the
//     Basic-auth header (Workers have no `Buffer`).
import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb } from "@/db";
import { getAllSettings, setSetting, type SettingMap } from "@/lib/settings";
import { logger } from "@/lib/logger";

const settings = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

settings.use("*", requireAdmin);

const patchBodySchema = z.object({
  key: z.enum(["whatsapp", "email", "payment", "general"]),
  value: z.record(z.unknown()),
});

settings.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const all = await getAllSettings(db);
  return c.json({ data: all });
});

settings.patch("/", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = patchBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }
  const db = getDb(c.env.DB);
  const merged = await setSetting(
    db,
    parsed.data.key,
    parsed.data.value as SettingMap[typeof parsed.data.key],
  );
  return c.json({ data: { key: parsed.data.key, value: merged } });
});

const testConnectionBodySchema = z.object({
  service: z.enum(["email", "whatsapp", "xendit"]),
  to: z.string().email().optional(),
});

function basicAuthHeader(secretKey: string): string {
  return "Basic " + btoa(`${secretKey}:`);
}

settings.post("/test-connection", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = testConnectionBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }
  const env = getEnv(c.env);
  const { service } = parsed.data;

  if (service === "email") {
    if (!env.RESEND_API_KEY) {
      return c.json({
        success: false,
        message: "Email tidak ter-konfigurasi (RESEND_API_KEY belum diset).",
      });
    }
    const to = parsed.data.to ?? env.ADMIN_EMAIL;
    if (!to) {
      return c.json({ success: false, message: "Tidak ada alamat tujuan (`to`) untuk test email." }, 400);
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${env.EMAIL_FROM_NAME ?? "Mote Capture"} <${env.EMAIL_FROM ?? "onboarding@resend.dev"}>`,
          to: [to],
          subject: "Test koneksi email — Mote Capture",
          text: "Halo! Ini email test dari Mote Capture. Kalau kamu menerima ini, koneksi email-mu berhasil.",
        }),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        logger.error("email_test_failed", { status: res.status, body: bodyText.slice(0, 300) });
        return c.json({
          success: false,
          message: `Gagal kirim email: Resend responded ${res.status}`,
          details: bodyText.slice(0, 300),
        });
      }
      logger.info("email_test_success", { to });
      return c.json({ success: true, message: `Email test terkirim ke ${to}.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      logger.error("email_test_error", { message });
      return c.json({ success: false, message: `Gagal kirim email: ${message}` });
    }
  }

  if (service === "whatsapp") {
    if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY || !env.EVOLUTION_INSTANCE_NAME) {
      return c.json({
        success: false,
        message: "EVOLUTION_API_URL/API_KEY/INSTANCE_NAME belum di-set.",
        details: { connected: false, status: "not_configured" },
      });
    }
    try {
      const url = `${env.EVOLUTION_API_URL.replace(/\/$/, "")}/instance/connectionState/${env.EVOLUTION_INSTANCE_NAME}`;
      const res = await fetch(url, { headers: { apikey: env.EVOLUTION_API_KEY } });
      if (!res.ok) {
        return c.json({
          success: false,
          message: `Evolution responded ${res.status}`,
          details: { connected: false, status: "error" },
        });
      }
      const jsonBody = (await res.json()) as Record<string, unknown>;
      const stateRaw =
        (jsonBody.instance as Record<string, unknown> | undefined)?.state ?? jsonBody.state;
      const state = typeof stateRaw === "string" ? stateRaw : "unknown";
      const connected = state === "open";
      return c.json({
        success: connected,
        message: connected ? "Terhubung" : `Status: ${state}`,
        details: { connected, status: state },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      return c.json({ success: false, message, details: { connected: false, status: "error" } });
    }
  }

  if (service === "xendit") {
    if (!env.XENDIT_SECRET_KEY) {
      return c.json({
        success: false,
        message: "Xendit secret key belum di-set (mock mode aktif).",
      });
    }
    try {
      const res = await fetch("https://api.xendit.co/balance", {
        headers: { authorization: basicAuthHeader(env.XENDIT_SECRET_KEY) },
      });
      if (!res.ok) {
        const text = await res.text();
        return c.json({
          success: false,
          message: `Xendit responded ${res.status}: ${text.slice(0, 120)}`,
        });
      }
      return c.json({ success: true, message: "Xendit credentials valid" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ success: false, message });
    }
  }

  return c.json({ error: "Service tidak dikenal" }, 400);
});

export default settings;
