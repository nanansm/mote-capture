import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Booth, Frame } from "@capture/shared";
import { Button } from "@/components/ui/button";
import { FrameList } from "@/components/admin/frame-list";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/frames/page.tsx (server component joining
// frames + booths directly) — now two client fetches against GET /api/frames
// and GET /api/booths (for the booth-id -> name lookup FrameList needs).
export default function FramesPage() {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [boothNames, setBoothNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([get<{ data: Frame[] }>("/frames"), get<{ data: Booth[] }>("/booths")])
      .then(([framesRes, boothsRes]) => {
        if (cancelled) return;
        setFrames(framesRes.data);
        setBoothNames(Object.fromEntries(boothsRes.data.map((b) => [b.id, b.name])));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <Link to="/admin/frames/new">
            <Plus className="h-4 w-4" />
            Frame Baru
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : (
        <FrameList frames={frames} boothNames={boothNames} />
      )}
    </div>
  );
}
