import { useEffect, useState } from "react";
import { PaymentsSettings } from "@/components/admin/payments-settings";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/payments/page.tsx.
export default function PaymentsPage() {
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ data: { payment: { default_provider: string } } }>("/settings")
      .then((res) => {
        if (!cancelled) setDefaultProvider(res.data.payment.default_provider);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Payments</h2>
        <p className="text-sm text-muted-foreground">
          Atur provider pembayaran dan lihat audit trail webhook.
        </p>
      </div>
      {defaultProvider ? <PaymentsSettings defaultProvider={defaultProvider} /> : null}
    </div>
  );
}
