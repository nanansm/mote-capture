import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Booth } from "@capture/shared";
import { FrameForm, type TargetBooth } from "@/components/admin/frame-form";
import { get } from "@/lib/api";

// Frame baru. Dari halaman booth (`?booth=ID`): frame langsung dipasang di
// booth itu dengan harga yang diisi. Tanpa `?booth`: masuk library saja.
export default function FramesNewPage() {
  const [params] = useSearchParams();
  const boothId = params.get("booth");
  const [target, setTarget] = useState<TargetBooth | null | undefined>(boothId ? undefined : null);

  useEffect(() => {
    if (!boothId) return;
    let cancelled = false;
    get<{ data: Booth }>(`/booths/${boothId}`)
      .then((res) => {
        if (!cancelled) setTarget({ id: res.data.id, name: res.data.name, defaultPrice: res.data.defaultPrice });
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [boothId]);

  if (target === undefined) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        {target ? (
          <Link
            to={`/admin/booths/${target.id}?tab=frame`}
            className="text-sm text-muted-foreground hover:text-brand-green-dark"
          >
            ← {target.name}
          </Link>
        ) : null}
        <h2 className="text-xl font-semibold text-brand-green-dark">
          {target ? `Frame baru untuk ${target.name}` : "Frame baru di library"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {target
            ? "Unggah desain, isi harga. Frame langsung tampil di kiosk booth ini."
            : "Desain di library bisa dipasang ke banyak booth, masing-masing dengan harga sendiri."}
        </p>
      </div>
      <FrameForm mode="create" targetBooth={target} />
    </div>
  );
}
