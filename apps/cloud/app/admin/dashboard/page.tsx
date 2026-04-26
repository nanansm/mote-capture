import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATS = [
  { label: "Booth Aktif", value: "—", hint: "Akan terisi setelah booth pertama" },
  { label: "Frame Tersedia", value: "—", hint: "Tambah frame di menu Frame" },
  { label: "Transaksi Bulan Ini", value: "—", hint: "Tersedia di Sprint 2" },
  { label: "Pendapatan Bulan Ini", value: "—", hint: "Tersedia di Sprint 2" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Sprint 1 · Foundation</p>
        <h2 className="mt-1 text-2xl font-semibold text-brand-green-dark">
          Selamat datang di Capture
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Mulai dengan menambahkan booth dan frame. Modul lain akan diaktifkan di sprint berikutnya.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((s) => (
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
