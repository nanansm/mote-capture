import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

const envSchema = z.object({
  // Core
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  REDIS_PREFIX: z.string().default("capture:"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(6),
  BETTER_AUTH_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:5000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  // R2 — all optional (mock mode when missing)
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,
  R2_ENDPOINT: optionalString,
  R2_PUBLIC_URL: optionalString,

  // Xendit — optional (mock mode when missing)
  XENDIT_SECRET_KEY: optionalString,
  XENDIT_WEBHOOK_TOKEN: optionalString,
  XENDIT_QR_AMOUNT_CURRENCY: z.string().default("IDR"),

  // Evolution API — optional (mock mode)
  EVOLUTION_API_URL: optionalString,
  EVOLUTION_API_KEY: optionalString,
  EVOLUTION_INSTANCE_NAME: z.string().default("capture"),

  // Email (Gmail SMTP) — optional (mock mode)
  EMAIL_HOST: optionalString,
  EMAIL_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_SECURE: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true"),
  EMAIL_USER: optionalString,
  EMAIL_PASSWORD: optionalString,
  EMAIL_FROM_NAME: z.string().default("Mote Capture"),

  // Misc
  DOWNLOAD_LINK_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  PAYMENT_DEFAULT_PROVIDER: z.enum(["xendit", "ipaymu"]).default("xendit"),
  LOG_LEVEL: optionalString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "[env] Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment variables — see logs above");
}

export const env = parsed.data;
export type Env = typeof env;

// Feature availability helpers — used by services to switch into mock mode
// when credentials are missing rather than crashing the app.
export const r2Configured = Boolean(
  env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME && env.R2_ENDPOINT,
);
export const xenditConfigured = Boolean(env.XENDIT_SECRET_KEY);
export const evolutionConfigured = Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY);
export const emailConfigured = Boolean(env.EMAIL_HOST && env.EMAIL_USER && env.EMAIL_PASSWORD);
