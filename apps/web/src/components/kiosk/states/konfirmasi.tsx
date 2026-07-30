import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ImageOff, Smartphone, Ticket } from "lucide-react";
import type { KioskBootData } from "@capture/shared";
import { displayUrl } from "@/lib/storage/r2-client";
import { formatRupiah } from "@/lib/utils";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];
type FrameOption = KioskBootData["frames"][number];

export function KonfirmasiState({
  frame,
  onBack,
  onChooseCashless,
  onChooseVoucher,
  busy,
  t,
}: {
  frame: FrameOption;
  onBack: () => void;
  onChooseCashless: () => void;
  onChooseVoucher: () => void;
  busy: boolean;
  t: T;
}) {
  const [previewBroken, setPreviewBroken] = useState(false);
  return (
    <div className="relative flex h-full w-full flex-col bg-brand-cream">
      <div className="flex items-center justify-between border-b border-brand-green-dark/10 px-8 py-4">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-green-dark shadow-sm hover:bg-white/80 disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </button>
        <h2 className="text-3xl font-extrabold tracking-wide text-brand-green-dark">
          {t("kiosk.confirm.title")}
        </h2>
        <span className="w-24" />
      </div>

      <div className="flex flex-1 flex-col gap-8 px-12 py-8 lg:flex-row">
        {/* Left: Frame Preview — responsive, object-contain so vertical AND
            horizontal frames don't get cropped. max-h-[70vh] keeps it from
            blowing up the column on tall displays. */}
        <div className="flex flex-1 items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative flex h-full max-h-[70vh] w-full items-center justify-center"
          >
            {frame.previewUrl && !previewBroken ? (
              <img
                src={displayUrl(frame.previewUrl)}
                alt={frame.name}
                width={800}
                height={1200}
                onError={() => setPreviewBroken(true)}
                className="h-auto max-h-[70vh] w-auto max-w-full rounded-2xl shadow-2xl"
                style={{ objectFit: "contain" }}
              />
            ) : (
              // Frame asset missing or 404 — show a neutral placeholder
              // instead of the browser's broken-image icon so the layout
              // still looks intentional.
              <div className="flex aspect-[3/4] w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-green-dark/20 bg-white shadow-inner">
                <ImageOff className="h-12 w-12 text-brand-green-dark/30" />
                <span className="text-sm text-brand-green-dark/40">{frame.name}</span>
              </div>
            )}
          </motion.div>
        </div>

        {/* Right: info + method picker */}
        <div className="flex flex-1 flex-col justify-center gap-8 lg:max-w-[600px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-green-dark/60">
              {frame.tier === "premium" ? t("kiosk.frame.premium") : t("kiosk.frame.regular")}
            </p>
            <h3 className="mt-2 break-words text-4xl font-extrabold leading-tight text-brand-green-dark">
              {frame.name}
            </h3>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-white px-6 py-5 shadow-lg">
            <span className="text-lg text-brand-green-dark/70">
              {t("kiosk.confirm.total")}
            </span>
            <span className="text-3xl font-extrabold text-brand-green-dark">
              {formatRupiah(frame.price)}
            </span>
          </div>

          <div>
            <p className="mb-4 text-lg font-semibold text-brand-green-dark">
              {t("kiosk.payment.method.title")}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <MethodButton
                icon={Ticket}
                label={t("kiosk.payment.method.voucher")}
                onClick={onChooseVoucher}
                disabled={busy}
              />
              <MethodButton
                icon={Smartphone}
                label={t("kiosk.payment.method.cashless")}
                onClick={onChooseCashless}
                disabled={busy}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MethodButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex aspect-square flex-col items-center justify-center gap-4 rounded-2xl border-2 border-transparent bg-white p-6 shadow-lg transition-all hover:scale-[1.03] hover:border-brand-yellow hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
    >
      <Icon className="h-20 w-20 stroke-[1.5] text-brand-green-dark transition-transform group-hover:scale-105" />
      <span className="text-xl font-bold text-brand-green-dark">{label}</span>
    </button>
  );
}
