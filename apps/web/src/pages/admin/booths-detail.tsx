import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Booth } from "@capture/shared";
import { BoothForm } from "@/components/admin/booth-form";
import { BoothLiveStatus } from "@/components/admin/booth-live-status";
import { ApiError, get } from "@/lib/api";

// Ported from apps/cloud/app/admin/booths/[id]/page.tsx. `appUrl` used to
// come from `env.NEXT_PUBLIC_APP_URL` (server-only); the SPA equivalent is
// just the page's own origin, since the kiosk is served from the same host.
type BoothRow = Omit<Booth, "lastSeenAt" | "createdAt" | "updatedAt"> & {
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function BoothsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [booth, setBooth] = useState<Booth | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    get<{ data: BoothRow }>(`/booths/${id}`)
      .then((res) => {
        if (cancelled) return;
        const row = res.data;
        setBooth({
          ...row,
          lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Booth tidak ditemukan.</p>
        <Link to="/admin/booths" className="text-sm text-brand-green-dark hover:underline">
          ← Kembali ke daftar booth
        </Link>
      </div>
    );
  }

  if (!booth) return null;

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
        appUrl={window.location.origin}
      />
      <BoothForm mode="edit" initial={booth} />
    </div>
  );
}
