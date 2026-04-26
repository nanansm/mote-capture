import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { getAllSettings, setSetting, type SettingMap } from "@/lib/settings/store";

const bodySchema = z.object({
  key: z.enum(["whatsapp", "email", "payment", "general"]),
  value: z.record(z.unknown()),
});

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const all = await getAllSettings();
  return NextResponse.json({ data: all });
}

export async function PATCH(req: Request) {
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
  const merged = await setSetting(
    parsed.data.key,
    parsed.data.value as SettingMap[typeof parsed.data.key],
  );
  return NextResponse.json({ data: { key: parsed.data.key, value: merged } });
}
