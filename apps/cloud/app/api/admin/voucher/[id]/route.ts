import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// Soft delete: flips status to "disabled" so audit trail (redemptions, etc.)
// stays intact. The redeem endpoint rejects non-active statuses.
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const result = await db
    .update(schema.vouchers)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(schema.vouchers.id, id))
    .returning({ id: schema.vouchers.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "Voucher tidak ditemukan" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
