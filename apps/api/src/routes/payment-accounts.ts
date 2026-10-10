// Admin CRUD akun pembayaran (Xendit/iPaymu) yang dipilih per booth.
//
// Aturan yang dijaga di sini (bukan di UI saja):
// - Key rahasia tidak pernah dikirim balik ke browser; hanya versi disamarkan.
// - Field kosong saat edit = "tidak diubah", jadi admin tidak perlu mengetik
//   ulang key yang tidak bisa ia lihat.
// - Ganti provider pada akun yang sudah ada ditolak: buat akun baru saja,
//   supaya sesi lama yang menunjuk akun ini tetap terverifikasi benar.
// - Akun yang masih dipakai booth tidak bisa dihapus.
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Bindings } from "@/lib/env";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";
import { getDb, schema } from "@/db";
import { logger } from "@/lib/logger";
import {
  PROVIDER_FIELDS,
  boothsUsing,
  buildProvider,
  generatePaymentAccountId,
  maskedSecrets,
  openSecrets,
  sealSecrets,
  webhookUrlFor,
  type AccountSecrets,
  type PaymentProviderName,
} from "@/lib/payment-accounts";

const accounts = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();
accounts.use("*", requireAdmin);

const trimmed = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .optional();

const secretsSchema = z.object({
  secretKey: trimmed(500),
  webhookToken: trimmed(500),
  clientId: trimmed(80).refine((v) => !v || /^[A-Za-z0-9-]+$/.test(v), "Client ID DOKU hanya huruf, angka, dan tanda -"),
  dokuSecretKey: trimmed(200),
  va: trimmed(40).refine((v) => !v || /^\d+$/.test(v), "Nomor VA iPaymu hanya angka"),
  apiKey: trimmed(300),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Nama akun wajib diisi").max(80),
  provider: z.enum(["xendit", "ipaymu", "doku"], { errorMap: () => ({ message: "Pilih Xendit, iPaymu, atau DOKU" }) }),
  mode: z.enum(["production", "sandbox"]).default("production"),
  secrets: secretsSchema,
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "Nama akun wajib diisi").max(80).optional(),
  mode: z.enum(["production", "sandbox"]).optional(),
  secrets: secretsSchema.optional(),
});

const FIELD_LABEL: Record<keyof AccountSecrets, string> = {
  secretKey: "Secret Key",
  webhookToken: "Webhook Token",
  va: "Nomor VA",
  clientId: "Client ID",
  dokuSecretKey: "Secret Key",
  apiKey: "API Key",
};

function pickProviderSecrets(provider: PaymentProviderName, input: AccountSecrets): AccountSecrets {
  const out: AccountSecrets = {};
  for (const f of PROVIDER_FIELDS[provider]) {
    const v = input[f.key];
    if (v) out[f.key] = v;
  }
  return out;
}

function missingFields(provider: PaymentProviderName, secrets: AccountSecrets): string[] {
  return PROVIDER_FIELDS[provider].filter((f) => f.required && !secrets[f.key]).map((f) => FIELD_LABEL[f.key]);
}

// Format yang diketahui pasti; salah tempel (mis. public key Xendit) ditolak
// sebelum sampai ke booth.
function formatProblem(provider: PaymentProviderName, mode: string, s: AccountSecrets): string | null {
  if (provider === "xendit" && s.secretKey) {
    if (s.secretKey.startsWith("xnd_public_")) return "Itu Public Key. Yang dibutuhkan Secret Key (xnd_production_… / xnd_development_…).";
    if (!s.secretKey.startsWith("xnd_")) return "Secret Key Xendit diawali xnd_production_ atau xnd_development_.";
    if (mode === "production" && s.secretKey.startsWith("xnd_development_"))
      return "Key xnd_development_ adalah key uji. Pilih Mode Sandbox, atau pakai key xnd_production_.";
    if (mode === "sandbox" && s.secretKey.startsWith("xnd_production_"))
      return "Key xnd_production_ adalah uang asli. Pilih Mode Production.";
  }
  if (provider === "doku" && s.clientId) {
    // Format resmi: BRN-xxxx-... (akun baru) atau MCH-xxxx-... (akun lama).
    if (!/^(BRN|MCH)-\d{4}-\d+$/i.test(s.clientId))
      return "Client ID DOKU berbentuk BRN-0000-0000000000000 (atau MCH-...). Salin dari Back Office DOKU, menu Integrations → API Keys.";
  }
  if (provider === "doku" && s.dokuSecretKey) {
    if (s.dokuSecretKey.startsWith("-----BEGIN"))
      return "Itu RSA key. Yang dibutuhkan Active Secret Key (diawali SK-).";
    if (!/^SK-/i.test(s.dokuSecretKey)) return "Active Secret Key DOKU diawali SK-. Salin dari Back Office DOKU, menu Integrations → API Keys.";
  }
  return null;
}

type AccountRow = typeof schema.paymentAccounts.$inferSelect;

async function present(row: AccountRow, env: Bindings, usedBy: { id: string; name: string }[]) {
  const secrets = await openSecrets(row, env);
  const provider = row.provider as PaymentProviderName;
  return {
    id: row.id,
    name: row.name,
    provider,
    mode: row.mode,
    masked: maskedSecrets(provider, secrets),
    // true = SETTINGS_ENC_KEY berubah; admin harus isi ulang key.
    unreadable: secrets === null,
    complete: secrets !== null && missingFields(provider, secrets).length === 0,
    webhookUrl: webhookUrlFor(env, provider, row.id),
    lastTest: row.lastTestAt ? { at: row.lastTestAt, ok: Boolean(row.lastTestOk), message: row.lastTestMessage ?? "" } : null,
    usedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

accounts.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(schema.paymentAccounts).orderBy(desc(schema.paymentAccounts.createdAt));
  const users = await boothsUsing(db, rows.map((r) => r.id));
  const data = await Promise.all(
    rows.map((r) =>
      present(
        r,
        c.env,
        users.filter((u) => u.accountId === r.id).map((u) => ({ id: u.id, name: u.name })),
      ),
    ),
  );
  return c.json({ data, meta: { encryptionConfigured: Boolean(c.env.SETTINGS_ENC_KEY) } });
});

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

accounts.post("/", async (c) => {
  const json = await readJson(c);
  if (json === undefined) return c.json({ error: "Body tidak valid" }, 400);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);
  if (!c.env.SETTINGS_ENC_KEY) return c.json({ error: "SETTINGS_ENC_KEY belum diset di server" }, 500);

  const { name, provider, mode } = parsed.data;
  const secrets = pickProviderSecrets(provider, parsed.data.secrets);
  const missing = missingFields(provider, secrets);
  if (missing.length) return c.json({ error: `Belum diisi: ${missing.join(", ")}` }, 400);
  const problem = formatProblem(provider, mode, secrets);
  if (problem) return c.json({ error: problem }, 400);

  const db = getDb(c.env.DB);
  const id = generatePaymentAccountId();
  const [row] = await db
    .insert(schema.paymentAccounts)
    .values({ id, name, provider, mode, credentials: await sealSecrets(secrets, c.env) })
    .returning();
  logger.info("payment_account_created", { id, provider, mode });
  return c.json({ data: await present(row!, c.env, []) }, 201);
});

accounts.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const json = await readJson(c);
  if (json === undefined) return c.json({ error: "Body tidak valid" }, 400);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, 400);

  const db = getDb(c.env.DB);
  const [row] = await db.select().from(schema.paymentAccounts).where(eq(schema.paymentAccounts.id, id)).limit(1);
  if (!row) return c.json({ error: "Akun tidak ditemukan" }, 404);
  const provider = row.provider as PaymentProviderName;
  const mode = parsed.data.mode ?? row.mode;

  // Key lama yang tidak bisa dibuka dianggap kosong: admin wajib isi ulang semua.
  const current = (await openSecrets(row, c.env)) ?? {};
  const merged: AccountSecrets = { ...pickProviderSecrets(provider, current), ...pickProviderSecrets(provider, parsed.data.secrets ?? {}) };
  const missing = missingFields(provider, merged);
  if (missing.length) return c.json({ error: `Belum diisi: ${missing.join(", ")}` }, 400);
  const problem = formatProblem(provider, mode, merged);
  if (problem) return c.json({ error: problem }, 400);

  const secretsChanged = JSON.stringify(merged) !== JSON.stringify(pickProviderSecrets(provider, current));
  const [updated] = await db
    .update(schema.paymentAccounts)
    .set({
      name: parsed.data.name ?? row.name,
      mode,
      credentials: await sealSecrets(merged, c.env),
      // Hasil tes lama tidak berlaku lagi kalau key/mode berubah.
      ...(secretsChanged || mode !== row.mode ? { lastTestAt: null, lastTestOk: null, lastTestMessage: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.paymentAccounts.id, id))
    .returning();
  const users = await boothsUsing(db, [id]);
  logger.info("payment_account_updated", { id, secretsChanged, mode });
  return c.json({ data: await present(updated!, c.env, users.map((u) => ({ id: u.id, name: u.name }))) });
});

accounts.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const [row] = await db.select().from(schema.paymentAccounts).where(eq(schema.paymentAccounts.id, id)).limit(1);
  if (!row) return c.json({ error: "Akun tidak ditemukan" }, 404);
  const secrets = await openSecrets(row, c.env);
  let result: { ok: boolean; message: string };
  if (!secrets) {
    result = { ok: false, message: "Key tersimpan tidak bisa dibuka (kunci enkripsi server berubah). Isi ulang key akun ini." };
  } else if (missingFields(row.provider as PaymentProviderName, secrets).length) {
    result = { ok: false, message: "Key belum lengkap." };
  } else {
    result = await buildProvider(row, secrets, c.env).ping();
  }
  const message = result.message.slice(0, 300);
  await db
    .update(schema.paymentAccounts)
    .set({ lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: message })
    .where(eq(schema.paymentAccounts.id, id));
  return c.json({ success: result.ok, message });
});

accounts.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const users = await boothsUsing(db, [id]);
  if (users.length) {
    return c.json(
      { error: `Masih dipakai booth: ${users.map((u) => u.name).join(", ")}. Ganti akun di booth itu dulu.` },
      409,
    );
  }
  const [deleted] = await db.delete(schema.paymentAccounts).where(eq(schema.paymentAccounts.id, id)).returning();
  if (!deleted) return c.json({ error: "Akun tidak ditemukan" }, 404);
  logger.info("payment_account_deleted", { id });
  return c.json({ ok: true });
});

export default accounts;
