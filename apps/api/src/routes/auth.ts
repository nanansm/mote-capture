import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  SESSION_COOKIE_NAME,
  checkAdminCredentials,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";
import type { AdminVariables } from "@/middleware/admin";
import { requireAdmin } from "@/middleware/admin";

const auth = new Hono<{ Bindings: Bindings; Variables: AdminVariables }>();

const bodySchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

const GENERIC_AUTH_ERROR = "Email atau password salah.";

auth.post("/login", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Body tidak valid" }, 400);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "Body tidak valid" },
      400,
    );
  }

  const { email, password } = parsed.data;
  const env = getEnv(c.env);

  const valid = await checkAdminCredentials(email, password, env);
  if (!valid) {
    logger.warn("login_failed", { email });
    // Deliberately identical message for wrong-email vs wrong-password so
    // the response never discloses which part of the credential was wrong.
    return c.json({ error: GENERIC_AUTH_ERROR }, 401);
  }

  if (!env.BETTER_AUTH_SECRET) {
    logger.error("login_failed_no_secret", { email });
    return c.json({ error: GENERIC_AUTH_ERROR }, 401);
  }

  const token = await createSessionToken(email, env.BETTER_AUTH_SECRET);
  const opts = sessionCookieOptions();
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: opts.httpOnly,
    sameSite: opts.sameSite,
    secure: opts.secure,
    path: opts.path,
    maxAge: opts.maxAge,
  });

  logger.info("login_success", { email });
  return c.json({ ok: true });
});

auth.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return c.json({ ok: true });
});

auth.get("/me", requireAdmin, (c) => {
  return c.json({ email: c.get("adminEmail") });
});

export default auth;
