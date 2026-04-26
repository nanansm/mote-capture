import { BoothForm } from "@/components/admin/booth-form";

export default function NewBoothPage() {
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
