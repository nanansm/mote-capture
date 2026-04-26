import { db, schema } from "@/lib/db";
import { FrameForm } from "@/components/admin/frame-form";

export const dynamic = "force-dynamic";

export default async function NewFramePage() {
  const booths = await db
    .select({ id: schema.booths.id, name: schema.booths.name })
    .from(schema.booths);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Frame Baru</h2>
        <p className="text-sm text-muted-foreground">
          Unggah background PNG dan atur tier serta harga.
        </p>
      </div>
      <FrameForm mode="create" booths={booths} />
    </div>
  );
}
