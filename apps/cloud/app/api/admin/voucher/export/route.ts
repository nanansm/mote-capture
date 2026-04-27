import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";

const HEADERS = [
  "Code",
  "Type",
  "Value",
  "Limit",
  "Used Count",
  "Status",
  "Customer Name",
  "Customer Email",
  "Customer WhatsApp",
  "Batch ID",
  "Created By",
  "Created At",
  "Expires At",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Always quote — handles commas, newlines, embedded quotes uniformly.
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  if (type !== "payment" && type !== "discount") {
    return NextResponse.json(
      { error: "BAD_TYPE", message: "type harus 'payment' atau 'discount'" },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.type, type))
    .orderBy(desc(schema.vouchers.createdAt));

  const lines = [HEADERS.join(",")];
  for (const v of rows) {
    lines.push(
      [
        v.code,
        v.type,
        v.value,
        v.limit,
        v.usedCount,
        v.status,
        v.customerName,
        v.customerEmail,
        v.customerWhatsapp,
        v.batchId,
        v.createdBy,
        v.createdAt,
        v.expiresAt,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vouchers-${type}-${today}.csv"`,
    },
  });
}
