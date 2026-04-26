import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { notifySession } from "@/lib/notify";

const bodySchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const adminSession = await getCurrentSession();
  if (!adminSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    // empty body is allowed
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  // Update customer contact fields if admin provided new ones.
  const updates: Partial<typeof schema.sessions.$inferInsert> = {};
  if (parsed.data.phone !== undefined) updates.customerPhone = parsed.data.phone || null;
  if (parsed.data.email !== undefined) updates.customerEmail = parsed.data.email || null;
  if (Object.keys(updates).length > 0) {
    await db.update(schema.sessions).set(updates).where(eq(schema.sessions.id, id));
  }

  try {
    const result = await notifySession(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal mengirim notifikasi" },
      { status: 500 },
    );
  }
}
