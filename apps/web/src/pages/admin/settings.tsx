import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, CreditCard, MessageSquare, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PaymentAccountsManager, usePaymentAccounts } from "@/components/admin/payment-accounts";
import { WhatsappSettings } from "@/components/admin/whatsapp-settings";
import {
  CredentialsPanel,
  type CredentialState,
  type CredentialsMeta,
} from "@/components/admin/credentials-panel";
import {
  SettingsPanel,
  type EmailSettings,
  type GeneralSettings,
} from "@/components/admin/general-settings";
import { get } from "@/lib/api";

type WaSettings = { enabled: boolean; template: string };

type SettingsData = {
  whatsapp: WaSettings;
  credentials: CredentialState;
  credentialsMeta: CredentialsMeta;
  email: EmailSettings;
  general: GeneralSettings;
};

const SECTIONS = ["payment", "whatsapp", "general"] as const;
type SectionId = (typeof SECTIONS)[number];

const WA_KEYS = ["evolution_api_url", "evolution_api_key", "evolution_instance_name"];

// Satu halaman Settings, tiap bagian bisa dibuka/tutup. `?section=` membuka
// bagian tertentu (dipakai redirect dari /admin/payments & /admin/whatsapp).
export default function SettingsPage() {
  const [params] = useSearchParams();
  const want = params.get("section") as SectionId | null;
  const initialOpen: SectionId = want && SECTIONS.includes(want) ? want : "payment";

  const [data, setData] = useState<SettingsData | null>(null);
  const load = useCallback(
    () =>
      get<{ data: SettingsData }>("/settings")
        .then((res) => setData(res.data))
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const { accounts } = usePaymentAccounts();
  const connected = (accounts ?? []).filter((a) => a.lastTest?.ok).length;

  const waConfigured = Boolean(
    data && WA_KEYS.every((k) => data.credentials[k] && data.credentials[k]!.source !== "none"),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="sr-only">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Pengaturan bersama semua booth. Frame dan harga diatur per booth di menu{" "}
          <Link to="/admin/booths" className="font-medium text-brand-green-dark underline">
            Booth
          </Link>
          .
        </p>
      </div>

      <Section
        id="payment"
        icon={<CreditCard className="h-5 w-5" />}
        title="Pembayaran QRIS"
        summary="Akun Xendit / iPaymu. Tiap booth memilih satu akun di tab Info & Pembayaran."
        status={
          accounts === null ? null : accounts.length === 0 ? (
            <Badge variant="warn">Belum ada akun</Badge>
          ) : (
            <Badge variant={connected ? "success" : "outline"}>
              {accounts.length} akun · {connected} terhubung
            </Badge>
          )
        }
        defaultOpen={initialOpen === "payment"}
      >
        <PaymentAccountsManager />
        <p className="pt-3 text-sm">
          <Link to="/admin/payments/transactions" className="text-brand-green-dark underline">
            Lihat riwayat transaksi →
          </Link>
        </p>
      </Section>

      <Section
        id="whatsapp"
        icon={<MessageSquare className="h-5 w-5" />}
        title="WhatsApp"
        summary="Kirim link download foto ke pelanggan lewat Evolution API."
        status={
          data ? (
            !waConfigured ? (
              <Badge variant="warn">Belum diisi</Badge>
            ) : data.whatsapp.enabled ? (
              <Badge variant="success">Aktif</Badge>
            ) : (
              <Badge variant="secondary">Nonaktif</Badge>
            )
          ) : null
        }
        defaultOpen={initialOpen === "whatsapp"}
      >
        {data ? (
          <div className="space-y-6">
            <CredentialsPanel
              title="Kredensial Evolution API"
              description="Kalau salah satu kosong, pesan WA tidak benar-benar terkirim (mode uji)."
              meta={data.credentialsMeta}
              initial={data.credentials}
              onSaved={load}
              fields={[
                {
                  key: "evolution_api_url",
                  label: "API URL",
                  plain: true,
                  hint: "Contoh: https://wa.domainmu.com, tanpa garis miring di akhir.",
                },
                { key: "evolution_api_key", label: "API Key", hint: "Nilai header apikey pada Evolution API." },
                {
                  key: "evolution_instance_name",
                  label: "Instance Name",
                  plain: true,
                  hint: "Nama instance yang sudah tersambung ke nomor WhatsApp.",
                },
              ]}
            />
            <WhatsappSettings
              initial={data.whatsapp}
              instanceName={data.credentials.evolution_instance_name?.masked || "(belum diisi)"}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        )}
      </Section>

      <Section
        id="general"
        icon={<SlidersHorizontal className="h-5 w-5" />}
        title="Umum & Email"
        summary="Notifikasi email dan parameter operasional."
        status={null}
        defaultOpen={initialOpen === "general"}
      >
        {data ? (
          <SettingsPanel initialEmail={data.email} initialGeneral={data.general} />
        ) : (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        )}
      </Section>
    </div>
  );
}

function Section({
  id,
  icon,
  title,
  summary,
  status,
  defaultOpen,
  children,
}: {
  id: SectionId;
  icon: ReactNode;
  title: string;
  summary: string;
  status: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details
      id={`section-${id}`}
      data-testid={`settings-${id}`}
      open={defaultOpen}
      className="group rounded-lg border bg-card shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg p-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="text-brand-green-dark">{icon}</span>
        <span className="flex-1">
          <span className="block font-semibold text-brand-green-dark">{title}</span>
          <span className="block text-sm text-muted-foreground">{summary}</span>
        </span>
        {status}
        <ChevronDown
          aria-hidden
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t p-4">{children}</div>
    </details>
  );
}
