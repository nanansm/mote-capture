// Admin session auth — pure Web Crypto only, no Node built-ins.
//
// Token format is preserved exactly from the old apps/cloud implementation
// (see apps/cloud/lib/auth.ts and apps/cloud/middleware.ts, the latter being
// the canonical Edge/Web-Crypto version this file is based on):
//
//   base64url(JSON.stringify({ email, issuedAt })) + "." + base64url(HMAC-SHA256(payloadStr, secret))

import type { Env } from "@/lib/env";

export const SESSION_COOKIE_NAME = "capture-session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionPayload = {
  email: string;
  issuedAt: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncodeString(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payloadStr: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadStr));
  return bytesToBase64Url(new Uint8Array(sigBuf));
}

export async function createSessionToken(email: string, secret: string): Promise<string> {
  const payload: SessionPayload = { email, issuedAt: Date.now() };
  const payloadStr = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await sign(payloadStr, secret);
  return `${payloadStr}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, signature] = parts as [string, string];

  const expected = await sign(payloadStr, secret);
  const a = base64UrlToBytes(signature);
  const b = base64UrlToBytes(expected);
  if (a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payloadStr));
    payload = JSON.parse(json) as SessionPayload;
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

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

/**
 * Compares email/password against env-configured admin credentials.
 *
 * Fails safe (returns false) if ADMIN_EMAIL/ADMIN_PASSWORD are not
 * configured, rather than throwing.
 *
 * Password comparison hashes both sides with SHA-256 first: `timingSafeEqual`
 * throws if the two buffers differ in length, and raw password lengths vary,
 * so comparing fixed-length 32-byte digests keeps the comparison both
 * constant-time and exception-free.
 */
export async function checkAdminCredentials(
  email: string,
  password: string,
  env: Pick<Env, "ADMIN_EMAIL" | "ADMIN_PASSWORD">,
): Promise<boolean> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return false;

  const emailMatch = email.trim().toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase();

  const [a, b] = await Promise.all([sha256(password), sha256(env.ADMIN_PASSWORD)]);
  const passwordMatch = crypto.subtle.timingSafeEqual(a, b);

  return emailMatch && passwordMatch;
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
