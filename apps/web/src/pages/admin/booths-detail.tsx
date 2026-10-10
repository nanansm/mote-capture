import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Booth } from "@capture/shared";
import { BoothForm } from "@/components/admin/booth-form";
import { BoothFramesManager } from "@/components/admin/booth-frames";
import { BoothLiveStatus } from "@/components/admin/booth-live-status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, get } from "@/lib/api";

type BoothRow = Omit<Booth, "lastSeenAt" | "createdAt" | "updatedAt"> & {
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const TABS = ["frame", "info", "status"] as const;
type Tab = (typeof TABS)[number];

// Halaman booth = pusat pengaturan: frame & harga, info/pembayaran, status.
// Tab disimpan di URL (?tab=) supaya kembali dari form frame mendarat di tab
// yang sama.
export default function BoothsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "frame";
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/admin/booths" className="text-sm text-muted-foreground hover:text-brand-green-dark">
          ← Semua booth
        </Link>
        <h2 className="text-xl font-semibold text-brand-green-dark">{booth.name}</h2>
        <p className="text-sm text-muted-foreground">
          {booth.id}
          {booth.location ? ` · ${booth.location}` : ""}
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="frame">Frame &amp; Harga</TabsTrigger>
          <TabsTrigger value="info">Info &amp; Pembayaran</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
        </TabsList>
        <TabsContent value="frame" className="pt-4">
          <BoothFramesManager boothId={booth.id} boothName={booth.name} defaultPrice={booth.defaultPrice} />
        </TabsContent>
        <TabsContent value="info" className="pt-4">
          <BoothForm mode="edit" initial={booth} />
        </TabsContent>
        <TabsContent value="status" className="pt-4">
          <BoothLiveStatus
            boothId={booth.id}
            metadata={booth.metadata}
            lastSeenAt={booth.lastSeenAt}
            appUrl={window.location.origin}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
