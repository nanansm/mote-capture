// Akun pembayaran per booth (migrations/0003_payment_accounts.sql).
//
// Model: admin membuat beberapa akun ("iPaymu smnanan", "Xendit Maja", ...),
// lalu tiap booth memilih satu. Tidak ada kredensial global lagi: booth tanpa
// akun = QRIS mati (voucher tetap jalan), bukan jatuh ke akun lain diam-diam.
//
// Kredensial satu akun disimpan sebagai SATU amplop AES-GCM berisi JSON, jadi
// kolom D1 tidak pernah memuat key mentah dan field rahasia tidak bisa
// ditukar antar akun lewat edit baris.
import { eq, inArray } from "drizzle-orm";
import type { Database, PaymentAccountRow } from "@/db";
import { schema } from "@/db";
import type { Bindings } from "@/lib/env";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/secret-box";
import { logger } from "@/lib/logger";
import { DokuProvider, IpaymuProvider, XenditProvider, type PaymentProvider } from "@/lib/payment";

export type PaymentProviderName = "xendit" | "ipaymu" | "doku";
export type PaymentMode = "production" | "sandbox";

export type XenditSecrets = { secretKey?: string; webhookToken?: string };
export type IpaymuSecrets = { va?: string; apiKey?: string };
export type DokuSecrets = { clientId?: string; dokuSecretKey?: string };
export type AccountSecrets = XenditSecrets & IpaymuSecrets & DokuSecrets;

// Field per provider: `secret` = disamarkan di UI, sisanya tampil utuh.
export const PROVIDER_FIELDS: Record<PaymentProviderName, { key: keyof AccountSecrets; secret: boolean; required: boolean }[]> = {
  xendit: [
    { key: "secretKey", secret: true, required: true },
    { key: "webhookToken", secret: true, required: true },
  ],
  ipaymu: [
    { key: "va", secret: false, required: true },
    { key: "apiKey", secret: true, required: true },
  ],
  // Nama field beda dari Xendit (dokuSecretKey) supaya key salah provider
  // tidak pernah terbaca lintas provider.
  doku: [
    { key: "clientId", secret: false, required: true },
    { key: "dokuSecretKey", secret: true, required: true },
  ],
};

// URL webhook memuat id akun: server langsung tahu kredensial mana yang dipakai
// untuk verifikasi, tanpa menebak dari isi body yang belum dipercaya.
export function webhookUrlFor(env: Bindings, provider: PaymentProviderName, accountId: string): string {
  return `${(env.APP_URL ?? "").replace(/\/$/, "")}/api/webhook/${provider}/${accountId}`;
}

export async function sealSecrets(secrets: AccountSecrets, env: Bindings): Promise<string> {
  const pass = env.SETTINGS_ENC_KEY;
  if (!pass) throw new Error("SETTINGS_ENC_KEY belum diset di server");
  return encryptSecret(JSON.stringify(secrets), pass);
}

// null = amplop tidak bisa dibuka (SETTINGS_ENC_KEY berubah/hilang).
export async function openSecrets(row: Pick<PaymentAccountRow, "id" | "credentials">, env: Bindings): Promise<AccountSecrets | null> {
  const pass = env.SETTINGS_ENC_KEY;
  if (!pass) return null;
  const plain = await decryptSecret(row.credentials, pass);
  if (plain === null) {
    logger.warn("payment_account_decrypt_failed", { accountId: row.id });
    return null;
  }
  try {
    const parsed = JSON.parse(plain) as AccountSecrets;
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function maskedSecrets(provider: PaymentProviderName, secrets: AccountSecrets | null) {
  const out: Record<string, string> = {};
  for (const f of PROVIDER_FIELDS[provider]) {
    const v = secrets?.[f.key] ?? "";
    out[f.key] = !v ? "" : f.secret ? maskSecret(v) : v;
  }
  return out;
}

export function buildProvider(
  row: Pick<PaymentAccountRow, "id" | "provider" | "mode">,
  secrets: AccountSecrets,
  env: Bindings,
): PaymentProvider {
  if (row.provider === "ipaymu") {
    return new IpaymuProvider({
      va: secrets.va,
      apiKey: secrets.apiKey,
      mode: row.mode === "sandbox" ? "sandbox" : "production",
      notifyUrl: webhookUrlFor(env, "ipaymu", row.id),
    });
  }
  if (row.provider === "xendit") {
    return new XenditProvider({ secretKey: secrets.secretKey, webhookToken: secrets.webhookToken });
  }
  if (row.provider === "doku") {
    return new DokuProvider({
      clientId: secrets.clientId,
      secretKey: secrets.dokuSecretKey,
      mode: row.mode === "sandbox" ? "sandbox" : "production",
    });
  }
  throw new Error(`Provider tidak dikenal: ${row.provider}`);
}

export type LoadedAccount = { row: PaymentAccountRow; secrets: AccountSecrets; provider: PaymentProvider };

export async function loadAccount(db: Database, env: Bindings, accountId: string | null | undefined): Promise<LoadedAccount | null> {
  if (!accountId) return null;
  const [row] = await db.select().from(schema.paymentAccounts).where(eq(schema.paymentAccounts.id, accountId)).limit(1);
  if (!row) return null;
  const secrets = await openSecrets(row, env);
  if (!secrets) return null;
  return { row, secrets, provider: buildProvider(row, secrets, env) };
}

export async function loadAccountsByProvider(db: Database, env: Bindings, provider: PaymentProviderName): Promise<LoadedAccount[]> {
  const rows = await db.select().from(schema.paymentAccounts).where(eq(schema.paymentAccounts.provider, provider));
  const out: LoadedAccount[] = [];
  for (const row of rows) {
    const secrets = await openSecrets(row, env);
    if (secrets) out.push({ row, secrets, provider: buildProvider(row, secrets, env) });
  }
  return out;
}

export async function boothsUsing(db: Database, accountIds: string[]) {
  if (accountIds.length === 0) return [];
  return db
    .select({ id: schema.booths.id, name: schema.booths.name, accountId: schema.booths.paymentAccountId })
    .from(schema.booths)
    .where(inArray(schema.booths.paymentAccountId, accountIds));
}

export function generatePaymentAccountId(): string {
  return `PAY-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

// Mock QR hanya untuk dev lokal; di production booth tanpa akun ditolak jelas.
export function isLocalDev(env: Bindings): boolean {
  const u = env.APP_URL ?? "";
  return u.includes("localhost") || u.includes("127.0.0.1");
}
