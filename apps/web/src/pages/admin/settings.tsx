import { useEffect, useState } from "react";
import {
  SettingsPanel,
  type EmailSettings,
  type GeneralSettings,
} from "@/components/admin/general-settings";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/settings/page.tsx.
export default function SettingsPage() {
  const [email, setEmail] = useState<EmailSettings | null>(null);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ data: { email: EmailSettings; general: GeneralSettings } }>("/settings")
      .then((res) => {
        if (cancelled) return;
        setEmail(res.data.email);
        setGeneral(res.data.general);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Konfigurasi email notification dan parameter operasional umum.
        </p>
      </div>
      {email && general ? <SettingsPanel initialEmail={email} initialGeneral={general} /> : null}
    </div>
  );
}
