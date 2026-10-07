import { motion } from "framer-motion";
import { RotateCcw, ArrowRight } from "lucide-react";
import { KIOSK_TIMING } from "@capture/shared";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function ReviewShotState({
  slot,
  thumbUrl,
  canRetake,
  secondsLeft,
  busy,
  onRetake,
  onNext,
  t,
}: {
  slot: number;
  thumbUrl: string | null;
  canRetake: boolean;
  secondsLeft: number;
  busy: boolean;
  onRetake: () => void;
  onNext: () => void;
  t: T;
}) {
  return (
    <div data-testid="state-review" data-slot={slot} className="relative flex h-full w-full flex-col items-center justify-center gap-6 bg-brand-cream px-8 py-6">
      <p className="text-xl font-bold uppercase tracking-[0.2em] text-brand-green-dark">
        {t("kiosk.review.title", { n: slot, total: KIOSK_TIMING.PHOTO_COUNT })}
      </p>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex max-h-[60vh] w-full max-w-3xl items-center justify-center overflow-hidden rounded-3xl border-8 border-white bg-white shadow-2xl"
      >
        {thumbUrl ? (
          <img data-testid="review-photo" src={thumbUrl} alt={`Foto ${slot}`} className="max-h-[58vh] w-full object-contain" />
        ) : null}
      </motion.div>
      <div className="flex items-center gap-6">
        {canRetake ? (
          <button
            type="button"
            data-testid="retake"
            disabled={busy}
            onClick={onRetake}
            className="inline-flex items-center gap-3 rounded-full bg-white px-10 py-5 text-2xl font-bold text-brand-green-dark shadow-xl disabled:opacity-60"
          >
            <RotateCcw className="h-7 w-7" />
            {t("kiosk.review.retake")}
          </button>
        ) : null}
        <button
          type="button"
          data-testid="review-next"
          disabled={busy}
          onClick={onNext}
          className="inline-flex items-center gap-3 rounded-full bg-brand-green-dark px-10 py-5 text-2xl font-extrabold text-brand-yellow shadow-xl disabled:opacity-60"
        >
          {t("kiosk.review.next")}
          <ArrowRight className="h-7 w-7" />
        </button>
      </div>
      <p className="text-sm text-brand-green-dark/60">{t("kiosk.review.auto", { n: secondsLeft })}</p>
    </div>
  );
}
