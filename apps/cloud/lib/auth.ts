import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export const SESSION_COOKIE_NAME = "capture-session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  return base64url(
    createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest(),
  );
}

export type SessionPayload = {
  email: string;
  issuedAt: number;
};

export function createSessionToken(email: string): string {
  const payload: SessionPayload = { email, issuedAt: Date.now() };
  const payloadStr = base64url(JSON.stringify(payload));
  const signature = sign(payloadStr);
  return `${payloadStr}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, signature] = parts as [string, string];

  const expected = sign(payloadStr);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64url(payloadStr).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload?.email !== "string" || typeof payload?.issuedAt !== "number") {
    return null;
  }
  if (Date.now() - payload.issuedAt > SESSION_TTL_MS) {
    return null;
  }
  return payload;
}

export function checkAdminCredentials(email: string, password: string): boolean {
  // Plain compare against env (no hashing — single-tenant single-user)
  const emailMatch = email.trim().toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase();
  const a = Buffer.from(password);
  const b = Buffer.from(env.ADMIN_PASSWORD);
  const passwordMatch = a.length === b.length && timingSafeEqual(a, b);
  return emailMatch && passwordMatch;
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export async function getCurrentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
