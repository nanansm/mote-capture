import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Booth } from "@capture/shared";
import { Button } from "@/components/ui/button";
import { BoothList } from "@/components/admin/booth-list";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/booths/page.tsx (was a server component
// querying `db.select().from(schema.booths)` directly) — now a client fetch
// against GET /api/booths (apps/api/src/routes/booths.ts).
export default function BoothsPage() {
  const [booths, setBooths] = useState<Booth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    get<{ data: Booth[] }>("/booths")
      .then((res) => {
        if (!cancelled) setBooths(res.data);
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
          <h2 className="text-xl font-semibold text-brand-green-dark">Booth</h2>
          <p className="text-sm text-muted-foreground">
            Kelola titik photobooth yang terhubung ke Capture.
          </p>
        </div>
        <Button asChild variant="brand">
          <Link to="/admin/booths/new">
            <Plus className="h-4 w-4" />
            Booth Baru
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : (
        <BoothList booths={booths} />
      )}
    </div>
  );
}
