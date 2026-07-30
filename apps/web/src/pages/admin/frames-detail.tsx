import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Booth, Frame } from "@capture/shared";
import { FrameForm } from "@/components/admin/frame-form";
import { ApiError, get } from "@/lib/api";

type BoothOption = { id: string; name: string };

type FrameRow = Omit<Frame, "seasonStart" | "seasonEnd" | "createdAt" | "updatedAt"> & {
  seasonStart: string | null;
  seasonEnd: string | null;
  createdAt: string;
  updatedAt: string;
};

// Ported from apps/cloud/app/admin/frames/[id]/page.tsx.
export default function FramesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [booths, setBooths] = useState<BoothOption[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([get<{ data: FrameRow }>(`/frames/${id}`), get<{ data: Booth[] }>("/booths")])
      .then(([frameRes, boothsRes]) => {
        if (cancelled) return;
        const row = frameRes.data;
        setFrame({
          ...row,
          seasonStart: row.seasonStart ? new Date(row.seasonStart) : null,
          seasonEnd: row.seasonEnd ? new Date(row.seasonEnd) : null,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        });
        setBooths(boothsRes.data.map((b) => ({ id: b.id, name: b.name })));
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
        <p className="text-sm text-muted-foreground">Frame tidak ditemukan.</p>
        <Link to="/admin/frames" className="text-sm text-brand-green-dark hover:underline">
          ← Kembali ke daftar frame
        </Link>
      </div>
    );
  }

  if (!frame) return null;

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
