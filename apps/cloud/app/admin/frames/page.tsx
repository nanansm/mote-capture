import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db, schema } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { FrameList } from "@/components/admin/frame-list";
import type { Frame, FrameLayout } from "@capture/shared";

export const dynamic = "force-dynamic";

function rowToFrame(row: typeof schema.frames.$inferSelect): Frame {
  return {
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
}

export default async function FramesPage() {
  const [frameRows, boothRows] = await Promise.all([
    db
      .select()
      .from(schema.frames)
      .orderBy(asc(schema.frames.sortOrder), desc(schema.frames.createdAt)),
    db.select({ id: schema.booths.id, name: schema.booths.name }).from(schema.booths),
  ]);

  const frames = frameRows.map(rowToFrame);
  const boothNames = Object.fromEntries(boothRows.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-brand-green-dark">Frame</h2>
          <p className="text-sm text-muted-foreground">
            Kelola frame photobooth, harga, dan jadwal musiman.
          </p>
        </div>
        <Button asChild variant="brand">
          <Link href="/admin/frames/new">
            <Plus className="h-4 w-4" />
            Frame Baru
          </Link>
        </Button>
      </div>

      <FrameList frames={frames} boothNames={boothNames} />
    </div>
  );
}
