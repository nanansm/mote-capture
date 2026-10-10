import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FrameList, type LibraryFrame } from "@/components/admin/frame-list";
import { get } from "@/lib/api";

// Library: semua desain frame. Pasang ke booth + harga di halaman booth.
export default function FramesPage() {
  const [frames, setFrames] = useState<LibraryFrame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    get<{ data: LibraryFrame[] }>("/frames")
      .then((res) => {
        if (!cancelled) setFrames(res.data);
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
          <h2 className="sr-only">Library Frame</h2>
          <p className="text-sm text-muted-foreground">
            Semua desain frame. Untuk memasang frame dan mengatur harganya, buka{" "}
            <Link to="/admin/booths" className="font-medium text-brand-green-dark underline">
              Booth
            </Link>
            .
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/frames/new">
            <Plus className="h-4 w-4" />
            Tambah frame
          </Link>
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Memuat…</p> : <FrameList frames={frames} />}
    </div>
  );
}
