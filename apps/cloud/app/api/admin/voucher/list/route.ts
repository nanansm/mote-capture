import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await db
    .select()
    .from(schema.vouchers)
    .orderBy(desc(schema.vouchers.createdAt));

  return NextResponse.json({
    payment: all.filter((v) => v.type === "payment"),
    discount: all.filter((v) => v.type === "discount"),
  });
}
