import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  REDIS_PREFIX: z.string().default("capture:"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(6),
  BETTER_AUTH_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:5000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
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
