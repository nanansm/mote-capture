import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { get } from "@/lib/api";
import { formatRupiah } from "@/lib/utils";

// Ported from apps/cloud/app/admin/dashboard/page.tsx. That page was a
// static Sprint-1 placeholder ("—" tiles, "Tersedia di Sprint 2" hints) with
// no query behind it — GET /api/admin/dashboard (apps/api/src/routes/
// admin-read.ts) now computes the real aggregates it was always meant to
// show, so the tiles/labels are kept but wired to live data.
type DashboardData = {
  activeBooths: number;
  availableFrames: number;
  transactionsThisMonth: number;
  revenueThisMonth: number;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    get<{ data: DashboardData }>("/admin/dashboard")
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = [
    {
      label: "Booth Aktif",
      value: loading ? "…" : String(data?.activeBooths ?? 0),
      hint: "Booth dengan status aktif saat ini.",
    },
    {
      label: "Frame Tersedia",
      value: loading ? "…" : String(data?.availableFrames ?? 0),
      hint: "Frame dengan status aktif saat ini.",
    },
    {
      label: "Transaksi Bulan Ini",
      value: loading ? "…" : String(data?.transactionsThisMonth ?? 0),
      hint: "Sesi yang sudah dibayar pada bulan berjalan.",
    },
    {
      label: "Pendapatan Bulan Ini",
      value: loading ? "…" : formatRupiah(data?.revenueThisMonth ?? 0),
      hint: "Total nominal sesi yang sudah dibayar bulan berjalan.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Ringkasan</p>
        <h2 className="mt-1 text-2xl font-semibold text-brand-green-dark">
          Selamat datang di Capture
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mulai dengan menambahkan booth dan frame. Angka di bawah diambil langsung dari data
          terbaru.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-brand-green-dark">{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
