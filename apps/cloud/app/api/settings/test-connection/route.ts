import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { sendTestEmail } from "@/lib/email/client";
import { testConnection as testWa } from "@/lib/wa/evolution";
import { getPaymentProvider } from "@/lib/payment";

const bodySchema = z.object({
  service: z.enum(["email", "whatsapp", "xendit"]),
  to: z.string().email().optional(),
});

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  if (parsed.data.service === "email") {
    const result = await sendTestEmail(parsed.data.to ?? env.ADMIN_EMAIL);
    return NextResponse.json({
      success: result.ok,
      message: result.mockMode
        ? "Email tidak ter-konfigurasi (mock mode aktif)."
        : result.ok
          ? `Email test terkirim ke ${parsed.data.to ?? env.ADMIN_EMAIL}.`
          : `Gagal kirim email: ${result.message}`,
      details: result,
    });
  }

  if (parsed.data.service === "whatsapp") {
    const state = await testWa();
    return NextResponse.json({
      success: state.connected,
      message: state.message,
      details: state,
    });
  }

  if (parsed.data.service === "xendit") {
    const provider = getPaymentProvider("xendit");
    const result = await provider.ping();
    return NextResponse.json({
      success: result.ok,
      message: result.message,
      details: result,
    });
  }

  return NextResponse.json({ error: "Service tidak dikenal" }, { status: 400 });
}
