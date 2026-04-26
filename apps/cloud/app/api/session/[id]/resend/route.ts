import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { notifySession } from "@/lib/notify";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const adminSession = await getCurrentSession();
  if (!adminSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const result = await notifySession(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal mengirim ulang" },
      { status: 500 },
    );
  }
}
