import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { FrameForm } from "@/components/admin/frame-form";
import type { Frame, FrameLayout } from "@capture/shared";

export const dynamic = "force-dynamic";

export default async function EditFramePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [row] = await db
    .select()
    .from(schema.frames)
    .where(eq(schema.frames.id, id))
    .limit(1);
  if (!row) notFound();

  const booths = await db
    .select({ id: schema.booths.id, name: schema.booths.name })
    .from(schema.booths);

  const frame: Frame = {
    id: row.id,
    name: row.name,
    tier: (row.tier as Frame["tier"]) ?? "regular",
    price: row.price,
    backgroundUrl: row.backgroundUrl,
    logoUrl: row.logoUrl,
    previewUrl: row.previewUrl,
    layoutJson: (row.layoutJson ?? {}) as FrameLayout,
    boothId: row.boothId,
    isActive: row.isActive,
    isDefault: row.isDefault,
    seasonStart: row.seasonStart,
    seasonEnd: row.seasonEnd,
    sortOrder: row.sortOrder,
    usesCount: row.usesCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Edit Frame</h2>
        <p className="text-sm text-muted-foreground">{frame.name}</p>
      </div>
      <FrameForm mode="edit" initial={frame} booths={booths} />
    </div>
  );
}
