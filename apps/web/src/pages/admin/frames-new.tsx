import { useEffect, useState } from "react";
import type { Booth } from "@capture/shared";
import { FrameForm } from "@/components/admin/frame-form";
import { get } from "@/lib/api";

type BoothOption = { id: string; name: string };

// Ported from apps/cloud/app/admin/frames/new/page.tsx.
export default function FramesNewPage() {
  const [booths, setBooths] = useState<BoothOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    get<{ data: Booth[] }>("/booths")
      .then((res) => {
        if (!cancelled) setBooths(res.data.map((b) => ({ id: b.id, name: b.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
