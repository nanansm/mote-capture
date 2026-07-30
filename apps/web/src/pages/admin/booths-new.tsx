import { BoothForm } from "@/components/admin/booth-form";

// Ported from apps/cloud/app/admin/booths/new/page.tsx — no data fetching
// needed, BoothForm posts to the API itself.
export default function BoothsNewPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Booth Baru</h2>
        <p className="text-sm text-muted-foreground">
          Daftarkan booth photobooth baru beserta provider pembayarannya.
        </p>
      </div>
      <BoothForm mode="create" />
    </div>
  );
}
