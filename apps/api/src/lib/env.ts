import { z } from "zod";
import type { BoothDO } from "@/do/booth";

// Secrets are optional at the type level: the app has a mock mode that
// works without real credentials configured. In Workers they are set via
// `wrangler secret put <NAME>` and arrive on the same Bindings object as
// everything else — never read from process.env.
export type Secrets = {
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  BETTER_AUTH_SECRET: string;
  XENDIT_SECRET_KEY: string;
  XENDIT_WEBHOOK_TOKEN: string;
  RESEND_API_KEY: string;
  EVOLUTION_API_URL: string;
  EVOLUTION_API_KEY: string;
  EVOLUTION_INSTANCE_NAME: string;
};

export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  BOOTH_DO: DurableObjectNamespace<BoothDO>;
  ADMIN_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  PUBLIC_CDN_URL: string;
  APP_URL: string;
  DOWNLOAD_LINK_EXPIRY_DAYS: string;
  // Optional: not every wrangler.jsonc env needs to set these (falls back to
  // onboarding@resend.dev / "Mote Capture" in src/lib/email.ts).
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
} & Partial<Secrets>;

const envSchema = z.object({
  PUBLIC_CDN_URL: z.string(),
  APP_URL: z.string(),
  DOWNLOAD_LINK_EXPIRY_DAYS: z.coerce.number().default(7),
  EMAIL_FROM: z.string().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  XENDIT_SECRET_KEY: z.string().optional(),
  XENDIT_WEBHOOK_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EVOLUTION_API_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_INSTANCE_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Module-level cache: Workers isolates are reused across requests, so this
// only actually parses once per isolate lifetime (not once per request).
let cached: Env | undefined;

export function getEnv(bindings: Bindings): Env {
  if (!cached) {
    cached = envSchema.parse(bindings);
  }
  return cached;
}
