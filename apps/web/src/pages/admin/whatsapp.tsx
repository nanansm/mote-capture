import { useCallback, useEffect, useState } from "react";
import { WhatsappSettings } from "@/components/admin/whatsapp-settings";
import {
  CredentialsPanel,
  type CredentialState,
  type CredentialsMeta,
} from "@/components/admin/credentials-panel";
import { get } from "@/lib/api";

type WaSettings = { enabled: boolean; template: string };

type SettingsResponse = {
  data: {
    whatsapp: WaSettings;
    credentials: CredentialState;
    credentialsMeta: CredentialsMeta;
  };
};

// Ported from apps/cloud/app/admin/whatsapp/page.tsx. The instance name used to
// be a server-only secret the browser could never see, so this page showed a
// generic label; it is now an editable credential (non-secret, returned in
// full), so the panel shows the live value.
export default function WhatsappPage() {
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [credentials, setCredentials] = useState<CredentialState | null>(null);
  const [meta, setMeta] = useState<CredentialsMeta | null>(null);

  const load = useCallback(() => {
    return get<SettingsResponse>("/settings")
      .then((res) => {
        setSettings(res.data.whatsapp);
        setCredentials(res.data.credentials);
        setMeta(res.data.credentialsMeta);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const instanceName = credentials?.evolution_instance_name?.masked;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">WhatsApp Settings</h2>
        <p className="text-sm text-muted-foreground">
          Atur kredensial Evolution API, template pesan otomatis, dan cek koneksi.
        </p>
      </div>

      {credentials && meta ? (
        <CredentialsPanel
          title="Kredensial Evolution API"
          description="Dipakai untuk mengirim link download lewat WhatsApp. Kalau salah satu kosong, pengiriman WA jatuh ke mock — pesan tidak benar-benar terkirim."
          meta={meta}
          initial={credentials}
          onSaved={load}
          fields={[
            {
              key: "evolution_api_url",
              label: "API URL",
              plain: true,
              hint: "Contoh: https://nama-evolution.easypanel.host — tanpa garis miring di akhir.",
            },
            {
              key: "evolution_api_key",
              label: "API Key",
              hint: "Nilai header apikey pada Evolution API.",
            },
            {
              key: "evolution_instance_name",
              label: "Instance Name",
              plain: true,
              hint: "Nama instance yang sudah tersambung ke nomor WhatsApp.",
            },
          ]}
        />
      ) : null}

      {settings ? (
        <WhatsappSettings initial={settings} instanceName={instanceName || "(belum diisi)"} />
      ) : null}
    </div>
  );
}
