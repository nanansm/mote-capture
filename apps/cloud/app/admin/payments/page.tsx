import { getSetting } from "@/lib/settings/store";
import { PaymentsSettings } from "@/components/admin/payments-settings";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const settings = await getSetting("payment");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Payments</h2>
        <p className="text-sm text-muted-foreground">
          Atur provider pembayaran dan lihat audit trail webhook.
        </p>
      </div>
      <PaymentsSettings defaultProvider={settings.default_provider} />
    </div>
  );
}
