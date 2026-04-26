import { getSetting } from "@/lib/settings/store";
import { WhatsappSettings } from "@/components/admin/whatsapp-settings";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function WhatsappPage() {
  const settings = await getSetting("whatsapp");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">WhatsApp Settings</h2>
        <p className="text-sm text-muted-foreground">
          Atur template pesan otomatis dan cek koneksi ke Evolution API.
        </p>
      </div>
      <WhatsappSettings initial={settings} instanceName={env.EVOLUTION_INSTANCE_NAME} />
    </div>
  );
}
