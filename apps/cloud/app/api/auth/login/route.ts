import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  checkAdminCredentials,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body tidak valid" },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;
  if (!checkAdminCredentials(email, password)) {
    logger.warn("login_failed", { email });
    return NextResponse.json(
      { error: "Email atau password salah." },
      { status: 401 },
    );
  }

  const token = createSessionToken(email);
  const opts = sessionCookieOptions();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: opts.httpOnly,
    sameSite: opts.sameSite,
    secure: opts.secure,
    path: opts.path,
    maxAge: opts.maxAge,
  });
  logger.info("login_success", { email });
  return res;
}
