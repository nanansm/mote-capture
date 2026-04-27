import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { VoucherManager, type VoucherDto } from "@/components/admin/voucher-manager";

export const dynamic = "force-dynamic";

export default async function VoucherPage() {
  const rows = await db
    .select()
    .from(schema.vouchers)
    .orderBy(desc(schema.vouchers.createdAt));

  // Serialize Date columns the same way the API does — keeps the SSR'd HTML
  // and the post-mount fetch shape identical so React doesn't hydrate-mismatch.
  // The DB columns are TEXT (not pgEnum), so we narrow to the DTO's literal
  // unions defensively here rather than scatter casts across the client.
  const initial: VoucherDto[] = rows.map((v) => ({
    id: v.id,
    code: v.code,
    type: v.type === "discount" ? "discount" : "payment",
    value: v.value,
    limit: v.limit,
    usedCount: v.usedCount,
    status:
      v.status === "active" || v.status === "used" || v.status === "expired" || v.status === "disabled"
        ? v.status
        : "disabled",
    customerName: v.customerName ?? null,
    customerEmail: v.customerEmail ?? null,
    customerWhatsapp: v.customerWhatsapp ?? null,
    batchId: v.batchId ?? null,
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
    createdBy: v.createdBy ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }));

  return <VoucherManager initial={initial} />;
}
