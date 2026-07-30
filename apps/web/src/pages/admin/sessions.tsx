import { useEffect, useState } from "react";
import type { SessionStatus } from "@capture/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SessionsList } from "@/components/admin/sessions-list";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/sessions/page.tsx. The old page pulled
// the 500 latest rows and let <SessionsList> filter them client-side; the
// SPA instead pages/filters through GET /api/admin/sessions?limit=&offset=
// &status=&boothId=&q= (apps/api/src/routes/admin-read.ts), which is bounded
// to 100 rows/request. <SessionsList> is unchanged and still offers its own
// client-side refinement on top of whatever page is currently loaded.
type Row = {
  id: string;
  boothId: string;
  boothName: string;
  status: SessionStatus;
  amount: number;
  customerEmail: string | null;
  customerPhone: string | null;
  createdAt: string;
};

type BoothOption = { id: string; name: string };

const LIMIT = 50;

const STATUS_OPTIONS: Array<{ value: "all" | SessionStatus; label: string }> = [
  { value: "all", label: "Semua Status" },
  { value: "payment", label: "Menunggu Pembayaran" },
  { value: "paid", label: "Sudah Dibayar" },
  { value: "capturing", label: "Sedang Foto" },
  { value: "processing", label: "Memproses" },
  { value: "done", label: "Selesai" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "failed", label: "Gagal" },
];

export default function SessionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [booths, setBooths] = useState<BoothOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [boothFilter, setBoothFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    get<{ data: BoothOption[] }>("/booths")
      .then((res) => {
        if (!cancelled) setBooths(res.data.map((b) => ({ id: b.id, name: b.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    get<{ data: Row[]; pagination: { hasMore: boolean } }>("/admin/sessions", {
      params: {
        limit: LIMIT,
        offset,
        status: statusFilter === "all" ? undefined : statusFilter,
        boothId: boothFilter === "all" ? undefined : boothFilter,
        q: q.trim() || undefined,
      },
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data);
        setHasMore(res.pagination.hasMore);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offset, statusFilter, boothFilter, q]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Sessions</h2>
        <p className="text-sm text-muted-foreground">
          Session di seluruh booth — difilter dan dipaging langsung dari API.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="api-booth-filter">Booth</Label>
            <Select
              value={boothFilter}
              onValueChange={(v) => {
                setBoothFilter(v);
                setOffset(0);
              }}
            >
              <SelectTrigger id="api-booth-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Booth</SelectItem>
                {booths.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="api-status-filter">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setOffset(0);
              }}
            >
              <SelectTrigger id="api-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="api-search">Cari</Label>
            <Input
              id="api-search"
              placeholder="ID session, nomor HP, atau email"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </div>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : (
        <>
          <SessionsList rows={rows} booths={booths} />
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              ← Sebelumnya
            </Button>
            <span className="text-xs text-muted-foreground">
              Menampilkan {rows.length} session (offset {offset})
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Berikutnya →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
