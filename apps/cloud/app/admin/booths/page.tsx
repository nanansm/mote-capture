import Link from "next/link";
import { desc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db, schema } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { BoothList } from "@/components/admin/booth-list";
import type { Booth } from "@capture/shared";

export const dynamic = "force-dynamic";

function rowToBooth(row: typeof schema.booths.$inferSelect): Booth {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    defaultPrice: row.defaultPrice,
    paymentProvider: row.paymentProvider as "ipaymu" | "xendit",
    bridgeToken: row.bridgeToken,
    isActive: row.isActive,
    lastSeenAt: row.lastSeenAt,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export default async function BoothsPage() {
  const rows = await db
    .select()
    .from(schema.booths)
    .orderBy(desc(schema.booths.createdAt));
  const booths = rows.map(rowToBooth);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-brand-green-dark">Booth</h2>
          <p className="text-sm text-muted-foreground">
            Kelola titik photobooth yang terhubung ke Capture.
          </p>
        </div>
        <Button asChild variant="brand">
          <Link href="/admin/booths/new">
            <Plus className="h-4 w-4" />
            Booth Baru
          </Link>
        </Button>
      </div>

      <BoothList booths={booths} />
    </div>
  );
}
