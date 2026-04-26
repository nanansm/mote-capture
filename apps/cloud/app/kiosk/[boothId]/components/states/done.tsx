"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function DoneState({
  countdown,
  t,
}: {
  countdown: number;
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-brand-yellow/40 via-brand-cream to-brand-green-light/30 px-8 py-6">
      {/* Confetti sparkles */}
      {[...Array(14)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: -20, x: (i - 7) * 30, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], y: 200 + i * 20 }}
          transition={{
            duration: 3,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeIn",
          }}
          className="pointer-events-none absolute top-10 text-2xl"
        >
          {["✨", "🎉", "💛", "📸", "💚"][i % 5]}
        </motion.div>
      ))}

      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className="z-10 flex flex-col items-center gap-6 text-center"
      >
        <div className="rounded-full bg-brand-green-dark p-5 shadow-2xl">
          <Sparkles className="h-16 w-16 text-brand-yellow" />
        </div>
        <h1 className="text-5xl font-extrabold text-brand-green-dark">{t("kiosk.done.title")}</h1>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-brand-green-dark">{t("kiosk.done.printed")}</p>
          <p className="text-base text-brand-green-dark/80">{t("kiosk.done.softfile")}</p>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-orange">
            {t("kiosk.done.tag")}
          </p>
        </div>
        <p className="text-sm text-brand-green-dark/60">
          {t("kiosk.done.return", { n: countdown })}
        </p>
      </motion.div>
    </div>
  );
}
