import { AlertTriangle, Clock } from "lucide-react";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function BoothBusyState({ releasesAt, onOk, t }: { releasesAt: string | null; onOk: () => void; t: T }) {
  const time = releasesAt
    ? new Date(releasesAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : "-";
  return (
    <div data-testid="state-busy" className="flex h-full w-full flex-col items-center justify-center gap-6 bg-white px-8 text-center">
      <Clock className="h-20 w-20 text-brand-orange" />
      <h1 className="text-4xl font-extrabold text-brand-green-dark">{t("kiosk.busy.title")}</h1>
      <p data-testid="busy-time" className="max-w-xl text-xl text-brand-green-dark/80">{t("kiosk.busy.subtitle", { time })}</p>
      <button type="button" data-testid="busy-ok" onClick={onOk} className="rounded-full bg-brand-green-dark px-12 py-4 text-xl font-bold text-brand-yellow">
        {t("kiosk.busy.ok")}
      </button>
    </div>
  );
}

export function CallStaffState({ reason, onStaff, t }: { reason: string | null; onStaff: () => void; t: T }) {
  return (
    <div data-testid="state-call-staff" data-reason={reason ?? ""} className="flex h-full w-full flex-col items-center justify-center gap-6 bg-white px-8 text-center">
      <AlertTriangle className="h-20 w-20 text-brand-orange" />
      <h1 className="text-4xl font-extrabold text-brand-green-dark">{t("kiosk.staff.title")}</h1>
      <p className="max-w-xl text-xl text-brand-green-dark/80">{t("kiosk.staff.subtitle")}</p>
      <button type="button" data-testid="call-staff-open" onClick={onStaff} className="rounded-full bg-brand-green-dark px-12 py-4 text-xl font-bold text-brand-yellow">
        {t("kiosk.staff.button")}
      </button>
    </div>
  );
}
