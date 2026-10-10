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
    credentials: CredentialState;
    credentialsMeta: CredentialsMeta;
  };
};

// Kredensial Xendit + iPaymu diatur dari sini tanpa redeploy.
export default function PaymentsPage() {
  const [credentials, setCredentials] = useState<CredentialState | null>(null);
  const [meta, setMeta] = useState<CredentialsMeta | null>(null);

  const load = useCallback(() => {
    return get<SettingsResponse>("/settings")
      .then((res) => {
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
          Isi kredensial Xendit dan/atau iPaymu, tes koneksi, lalu pilih provider di tiap booth.
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

      {credentials && meta ? (
        <CredentialsPanel
          title="Kredensial iPaymu"
          description="Dipakai untuk QRIS iPaymu. Ambil dari dashboard iPaymu → menu Integrasi / API Key. Nilai sandbox dan production berbeda, jangan dicampur."
          meta={meta}
          initial={credentials}
          onSaved={load}
          clearLabel="Hapus kredensial iPaymu"
          fields={[
            {
              key: "ipaymu_mode",
              label: "Mode",
              hint: "Sandbox = uang bohongan untuk uji. Production = uang asli. Akun sandbox dan production iPaymu terpisah.",
              options: [
                { value: "production", label: "Production (uang asli)" },
                { value: "sandbox", label: "Sandbox (uji coba)" },
              ],
            },
            {
              key: "ipaymu_va",
              label: "Nomor VA",
              hint: "Angka saja, contoh 1179xxxxxxxxxxxx. Tertera di halaman API Key iPaymu.",
              plain: true,
            },
            {
              key: "ipaymu_api_key",
              label: "API Key",
              hint: "Rahasia. Jangan dikirim lewat chat/WA.",
            },
          ]}
        />
      ) : null}

      <PaymentsSettings />
    </div>
  );
}
