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
import { getAllSettings, getSetting, setSetting, type SettingMap } from "@/lib/settings";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/secret-box";
import { credentialSource, resolveCredentials, type CredentialSource } from "@/lib/runtime-credentials";
import { logger } from "@/lib/logger";

const settings = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

settings.use("*", requireAdmin);

const patchBodySchema = z.object({
  key: z.enum(["whatsapp", "email", "payment", "general"]),
  value: z.record(z.unknown()),
});

// Credentials are written through their own endpoint, never the generic PATCH:
// they need encrypting on the way in, and a blank field has to mean "keep the
// existing value" rather than "clear it" (the UI can't echo the current one
// back for the user to retype).
const CREDENTIAL_FIELDS = [
  "xendit_secret_key",
  "xendit_webhook_token",
  "evolution_api_url",
  "evolution_api_key",
  "evolution_instance_name",
] as const;

const credentialsBodySchema = z.object({
  xendit_secret_key: z.string().max(500).optional(),
  xendit_webhook_token: z.string().max(500).optional(),
  evolution_api_url: z.string().max(500).optional(),
  evolution_api_key: z.string().max(500).optional(),
  evolution_instance_name: z.string().max(200).optional(),
  // Explicit opt-in to wipe a stored value and fall back to the Worker secret.
  clear: z.array(z.enum(CREDENTIAL_FIELDS)).optional(),
});

settings.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const all = await getAllSettings(db);
  // Never hand raw credentials back to the browser — an admin session is a
  // cookie, and this endpoint is the one place the whole set would be
  // reachable from. The UI only needs to know what is installed and where it
  // came from, so it gets a masked view plus the source of each field.
  const env = getEnv(c.env);
  const stored = all.credentials;
  const passphrase = c.env.SETTINGS_ENC_KEY;
  const envFallback: Record<(typeof CREDENTIAL_FIELDS)[number], string | undefined> = {
    xendit_secret_key: env.XENDIT_SECRET_KEY,
    xendit_webhook_token: env.XENDIT_WEBHOOK_TOKEN,
    evolution_api_url: env.EVOLUTION_API_URL,
    evolution_api_key: env.EVOLUTION_API_KEY,
    evolution_instance_name: env.EVOLUTION_INSTANCE_NAME,
  };

  const credentials: Record<string, { masked: string; source: CredentialSource }> = {};
  let decryptFailed = false;
  for (const field of CREDENTIAL_FIELDS) {
    const envelope = stored[field];
    const source = credentialSource(envelope, envFallback[field]);
    let masked = "";
    if (envelope && passphrase) {
      const plain = await decryptSecret(envelope, passphrase);
      if (plain === null) decryptFailed = true;
      // The Evolution URL and instance name are not secrets — showing them in
      // full is what makes the panel usable for spotting a wrong instance.
      masked =
        plain === null
          ? ""
          : field === "evolution_api_url" || field === "evolution_instance_name"
            ? plain
            : maskSecret(plain);
    } else if (envelope && !passphrase) {
      decryptFailed = true;
    } else if (source === "server") {
      masked =
        field === "evolution_api_url" || field === "evolution_instance_name"
          ? (envFallback[field] ?? "")
          : maskSecret(envFallback[field] ?? "");
    }
    credentials[field] = { masked, source };
  }

  return c.json({
    data: {
      ...all,
      credentials,
      credentialsMeta: {
        encryptionConfigured: Boolean(passphrase),
        decryptFailed,
      },
    },
  });
});

settings.patch("/credentials", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }
  const parsed = credentialsBodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  }

  const passphrase = c.env.SETTINGS_ENC_KEY;
  if (!passphrase) {
    // Refuse rather than silently storing a live payment key in plaintext.
    return c.json(
      {
        error:
          "SETTINGS_ENC_KEY belum diset di Worker. Jalankan sekali: " +
          "`wrangler secret put SETTINGS_ENC_KEY` (isi dengan `openssl rand -base64 32`), " +
          "lalu simpan kredensial lagi dari halaman ini.",
      },
      409,
    );
  }

  const db = getDb(c.env.DB);
  const current = await getSetting(db, "credentials");
  const next = { ...current };
  const toClear = new Set(parsed.data.clear ?? []);
  const changed: string[] = [];

  for (const field of CREDENTIAL_FIELDS) {
    if (toClear.has(field)) {
      next[field] = "";
      changed.push(`${field}:cleared`);
      continue;
    }
    const incoming = parsed.data[field];
    // Blank/absent = leave the stored value alone. This is what lets the admin
    // rotate only the Xendit key without re-typing the Evolution credentials.
    if (incoming === undefined || incoming.trim() === "") continue;
    next[field] = await encryptSecret(incoming.trim(), passphrase);
    changed.push(field);
  }

  if (changed.length === 0) {
    return c.json({ data: { changed: [] } });
  }

  await setSetting(db, "credentials", next);
  logger.info("credentials_updated", { by: c.get("adminEmail"), fields: changed });
  return c.json({ data: { changed } });
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
  // Test against whatever a real request would use, UI-entered credentials
  // included — otherwise Test would keep reporting on the deployed secrets
  // while checkout ran on the new ones.
  const resolved = await resolveCredentials(getDb(c.env.DB), c.env);

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
    const { apiUrl, apiKey, instanceName } = resolved.evolution;
    if (!apiUrl || !apiKey || !instanceName) {
      return c.json({
        success: false,
        message: resolved.hasUndecryptable
          ? "Kredensial Evolution tersimpan tapi tidak bisa dibuka — SETTINGS_ENC_KEY berubah/hilang. Isi ulang dari halaman ini."
          : "URL / API key / instance name Evolution belum diisi.",
        details: { connected: false, status: "not_configured" },
      });
    }
    try {
      const url = `${apiUrl.replace(/\/$/, "")}/instance/connectionState/${instanceName}`;
      const res = await fetch(url, { headers: { apikey: apiKey } });
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
    const secretKey = resolved.xendit.secretKey;
    if (!secretKey) {
      return c.json({
        success: false,
        message: resolved.hasUndecryptable
          ? "Xendit key tersimpan tapi tidak bisa dibuka — SETTINGS_ENC_KEY berubah/hilang. Isi ulang dari halaman ini."
          : "Xendit secret key belum diisi (mock mode aktif).",
      });
    }
    try {
      const res = await fetch("https://api.xendit.co/balance", {
        headers: { authorization: basicAuthHeader(secretKey) },
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
