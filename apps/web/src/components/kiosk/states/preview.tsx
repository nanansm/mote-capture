import { motion } from "framer-motion";
import { displayUrl } from "@/lib/storage/r2-client";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function PreviewState({
  compositeUrl,
  t,
}: {
  compositeUrl?: string;
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-brand-yellow/30 via-brand-cream to-brand-pink/30 px-8 py-6">
      <div className="flex flex-col items-center gap-6">
        <h2 className="text-4xl font-extrabold text-brand-green-dark">
          {t("kiosk.preview.title")}
        </h2>

        {compositeUrl ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: -1.5 }}
            transition={{ type: "spring", stiffness: 90, damping: 12 }}
            className="overflow-hidden rounded-3xl border-[14px] border-white bg-white shadow-2xl"
          >
            <img
              src={displayUrl(compositeUrl)}
              alt="Composite"
              className="block max-h-[60vh] w-auto"
            />
          </motion.div>
        ) : null}

        <p className="text-lg font-semibold text-brand-green-dark/80">
          {t("kiosk.preview.printing")}
        </p>
      </div>
    </div>
  );
}
