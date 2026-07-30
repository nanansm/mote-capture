import { useEffect, useState } from "react";
import { WhatsappSettings } from "@/components/admin/whatsapp-settings";
import { get } from "@/lib/api";

type WaSettings = { enabled: boolean; template: string };

// Ported from apps/cloud/app/admin/whatsapp/page.tsx. `instanceName` used to
// come from `env.EVOLUTION_INSTANCE_NAME` (a server-only secret) — the new
// admin-read API surface (apps/api/src/routes/admin-read.ts) never exposes
// that value, so the panel shows a generic label here instead of leaking
// infra config to the browser. See final report for this limitation.
export default function WhatsappPage() {
  const [settings, setSettings] = useState<WaSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ data: { whatsapp: WaSettings } }>("/settings")
      .then((res) => {
        if (!cancelled) setSettings(res.data.whatsapp);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">WhatsApp Settings</h2>
        <p className="text-sm text-muted-foreground">
          Atur template pesan otomatis dan cek koneksi ke Evolution API.
        </p>
      </div>
      {settings ? (
        <WhatsappSettings initial={settings} instanceName="Evolution API (dikonfigurasi di server)" />
      ) : null}
    </div>
  );
}
