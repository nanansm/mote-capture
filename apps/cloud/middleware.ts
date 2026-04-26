import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "capture-session";

// Edge-safe HMAC verification (Web Crypto). Mirror of lib/auth.ts but
// without Node-only APIs so middleware can run on the Edge runtime.
async function verifyToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadStr, signature] = parts as [string, string];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadStr));
  const expected = bufToBase64Url(new Uint8Array(sigBuf));
  if (expected !== signature) return false;

  // Decode payload, check expiry
  try {
    const json = atob(payloadStr.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { email?: string; issuedAt?: number };
    if (typeof payload.email !== "string" || typeof payload.issuedAt !== "number") {
      return false;
    }
    if (Date.now() - payload.issuedAt > 7 * 24 * 60 * 60 * 1000) return false;
  } catch {
    return false;
  }
  return true;
}

function bufToBase64Url(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes that must skip the admin auth check entirely.
  if (
    pathname.startsWith("/share") ||
    pathname.startsWith("/api/share") ||
    pathname.startsWith("/api/webhook") ||
    pathname.startsWith("/api/bridge") ||
    pathname.startsWith("/api/r2/") ||
    pathname.startsWith("/api/kiosk/") ||
    pathname.startsWith("/kiosk") ||
    pathname === "/api/session" ||
    /^\/api\/session\/[^/]+\/(photos|composite|start-capture|contact)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL("/login?error=config", req.url));
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = await verifyToken(token, secret);
  if (!valid) {
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/admin") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

