"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function CountdownState({
  step,
  number,
  flashing,
  t,
}: {
  step: 1 | 2 | 3;
  number: number;
  flashing: boolean;
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-brand-green-dark text-brand-yellow">
      <div className="px-8 py-4 text-center">
        <p className="text-xl font-bold uppercase tracking-[0.2em]">
          {t("kiosk.countdown.step", { n: step })}
        </p>
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        <div className="absolute inset-8 rounded-3xl border-4 border-dashed border-brand-yellow/40" />
        <AnimatePresence mode="popLayout">
          <motion.div
            key={number}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="text-[18rem] font-black leading-none drop-shadow-2xl"
          >
            {number > 0 ? number : t("kiosk.countdown.cheese")}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="pb-8 text-center text-2xl font-semibold text-brand-yellow/80">
        {t("kiosk.countdown.smile")}
      </p>

      <AnimatePresence>
        {flashing ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 z-50 bg-white"
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
