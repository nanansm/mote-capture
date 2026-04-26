"use client";

import { motion } from "framer-motion";
import { displayUrl } from "@/lib/storage/r2-client";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function ProcessingState({
  photos,
  t,
}: {
  photos: string[];
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-brand-cream px-8">
      <div className="flex flex-col items-center gap-10 text-center">
        <h2 className="text-4xl font-extrabold text-brand-green-dark">
          {t("kiosk.processing.title")}
        </h2>
        <p className="text-lg text-brand-green-dark/70">{t("kiosk.processing.subtitle")}</p>

        <div className="flex items-end gap-4">
          {photos.slice(0, 3).map((url, i) => (
            <motion.div
              key={`${url}-${i}`}
              initial={{ opacity: 0, y: 30, rotate: 0 }}
              animate={{ opacity: 1, y: 0, rotate: i === 0 ? -3 : i === 2 ? 3 : 0 }}
              transition={{ delay: i * 0.25, type: "spring", stiffness: 120 }}
              className="h-44 w-32 overflow-hidden rounded-xl border-4 border-white bg-muted shadow-xl"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl(url)} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            </motion.div>
          ))}
        </div>

        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ y: [0, -8, 0] }}
              transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }}
              className="block h-3 w-3 rounded-full bg-brand-green-dark"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
