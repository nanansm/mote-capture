import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BoothForm } from "@/components/admin/booth-form";
import { BoothLiveStatus } from "@/components/admin/booth-live-status";
import { env } from "@/lib/env";
import type { Booth } from "@capture/shared";

export const dynamic = "force-dynamic";

export default async function EditBoothPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [row] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, id))
    .limit(1);
  if (!row) notFound();

  const booth: Booth = {
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Edit Booth</h2>
        <p className="text-sm text-muted-foreground">{booth.name}</p>
      </div>
      <BoothLiveStatus
        boothId={booth.id}
        metadata={booth.metadata}
        lastSeenAt={booth.lastSeenAt}
        appUrl={env.NEXT_PUBLIC_APP_URL}
      />
      <BoothForm mode="edit" initial={booth} />
    </div>
  );
}
