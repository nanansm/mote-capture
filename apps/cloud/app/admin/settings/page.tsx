import { getAllSettings } from "@/lib/settings/store";
import { SettingsPanel } from "@/components/admin/general-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const all = await getAllSettings();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Konfigurasi email notification dan parameter operasional umum.
        </p>
      </div>
      <SettingsPanel initialEmail={all.email} initialGeneral={all.general} />
    </div>
  );
}
