import { useCallback, useEffect, useState } from "react";
import { PaymentsSettings } from "@/components/admin/payments-settings";
import {
  CredentialsPanel,
  type CredentialState,
  type CredentialsMeta,
} from "@/components/admin/credentials-panel";
import { get } from "@/lib/api";

type SettingsResponse = {
  data: {
    payment: { default_provider: string };
    credentials: CredentialState;
    credentialsMeta: CredentialsMeta;
  };
};

// Ported from apps/cloud/app/admin/payments/page.tsx, plus the Xendit
// credential panel so keys can be rotated without a redeploy.
export default function PaymentsPage() {
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialState | null>(null);
  const [meta, setMeta] = useState<CredentialsMeta | null>(null);

  const load = useCallback(() => {
    return get<SettingsResponse>("/settings")
      .then((res) => {
        setDefaultProvider(res.data.payment.default_provider);
        setCredentials(res.data.credentials);
        setMeta(res.data.credentialsMeta);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Payments</h2>
        <p className="text-sm text-muted-foreground">
          Atur provider pembayaran, kredensial Xendit, dan lihat audit trail webhook.
        </p>
      </div>

      {credentials && meta ? (
        <CredentialsPanel
          title="Kredensial Xendit"
          description="Secret key dipakai untuk membuat QR pembayaran. Webhook token dipakai untuk memverifikasi callback Xendit — kalau salah, semua notifikasi bayar ditolak."
          meta={meta}
          initial={credentials}
          onSaved={load}
          fields={[
            {
              key: "xendit_secret_key",
              label: "Secret Key",
              hint: "Dashboard Xendit → Settings → API Keys. Diawali xnd_production_ atau xnd_development_.",
            },
            {
              key: "xendit_webhook_token",
              label: "Webhook Verification Token",
              hint: "Dashboard Xendit → Settings → Webhooks → Verification token.",
            },
          ]}
        />
      ) : null}

      {defaultProvider ? <PaymentsSettings defaultProvider={defaultProvider} /> : null}
    </div>
  );
}
