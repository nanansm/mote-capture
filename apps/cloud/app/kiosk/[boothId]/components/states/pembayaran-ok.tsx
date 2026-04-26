"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function PembayaranOkState({
  onStart,
  t,
}: {
  onStart: () => void;
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-green-light/40 via-brand-cream to-brand-yellow/30">
      <div className="flex flex-col items-center gap-8 text-center">
        <motion.div
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          className="rounded-full bg-brand-green-dark p-6 shadow-2xl"
        >
          <CheckCircle2 className="h-24 w-24 text-brand-yellow" strokeWidth={2.5} />
        </motion.div>

        <div className="space-y-3 px-6">
          <h1 className="text-5xl font-extrabold text-brand-green-dark">{t("kiosk.paid.title")}</h1>
          <p className="text-xl text-brand-green-dark/80">{t("kiosk.paid.subtitle")}</p>
        </div>

        <motion.button
          type="button"
          onClick={onStart}
          whileTap={{ scale: 0.97 }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ scale: { repeat: Infinity, duration: 2.2, ease: "easeInOut" } }}
          className="rounded-full bg-brand-green-dark px-16 py-8 shadow-2xl"
        >
          <span className="text-3xl font-extrabold tracking-[0.12em] text-brand-yellow">
            {t("kiosk.paid.start_capture")}
          </span>
        </motion.button>
      </div>
    </div>
  );
}
