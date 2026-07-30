import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Bindings } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export type AdminVariables = {
  adminEmail: string;
};

/**
 * Hono middleware guarding admin-only routes. Reads the `capture-session`
 * cookie, verifies it against BETTER_AUTH_SECRET, and on success stashes the
 * authenticated email on the request context (`c.get("adminEmail")`).
 */
export async function requireAdmin(
  c: Context<{ Bindings: Bindings; Variables: AdminVariables }>,
  next: Next,
) {
  const env = getEnv(c.env);
  if (!env.BETTER_AUTH_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySessionToken(token, env.BETTER_AUTH_SECRET);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("adminEmail", session.email);
  await next();
}
