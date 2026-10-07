import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KIOSK_TIMING } from "@capture/shared";
import type { CountdownPhase } from "@/lib/kiosk/state-machine";
import { agent } from "@/lib/kiosk/agent";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function CountdownState({
  step,
  number,
  phase,
  flashing,
  retaking,
  t,
}: {
  step: number;
  number: number;
  phase: CountdownPhase;
  flashing: boolean;
  retaking: boolean;
  t: T;
}) {
  // Live view = satu stream MJPEG dari agent (PRD bagian 9), bukan polling
  // JPEG. Stream putus: sembunyikan <img>, countdown tetap jalan (shutter
  // tidak bergantung pada preview).
  const [previewOk, setPreviewOk] = useState<boolean>(true);
  const total = KIOSK_TIMING.PHOTO_COUNT;

  return (
    <div data-testid="state-countdown" data-slot={step} data-phase={phase} className="relative flex h-full w-full flex-col bg-brand-green-dark text-brand-yellow">
      {previewOk ? (
        <img
          data-testid="live-preview"
          src={agent.previewUrl()}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
          onError={() => setPreviewOk(false)}
        />
      ) : null}
      {/* Darken the preview so the yellow countdown text stays legible */}
      <div className="absolute inset-0 bg-brand-green-dark/55" />

      <div className="relative z-10 px-8 py-4 text-center">
        <p className="text-xl font-bold uppercase tracking-[0.2em] drop-shadow">
          {retaking ? t("kiosk.countdown.retake", { n: step }) : t("kiosk.countdown.photo", { n: step, total })}
        </p>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center">
        <div className="absolute inset-8 rounded-3xl border-4 border-dashed border-brand-yellow/50" />

        <AnimatePresence mode="popLayout">
          {phase === "GET_READY" ? (
            <motion.div
              key="get-ready"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.2, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="text-center drop-shadow-2xl"
            >
              <div className="text-[12vw] font-black leading-none">
                {t("kiosk.countdown.get_ready")}
              </div>
              <div className="mt-4 text-2xl font-semibold text-brand-yellow/85">
                {t("kiosk.countdown.photo", { n: step, total })}
              </div>
            </motion.div>
          ) : phase === "COUNTDOWN" ? (
            <motion.div
              key={`num-${number}`}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="text-[30vw] font-black leading-none drop-shadow-2xl"
            >
              {number}
            </motion.div>
          ) : (
            <motion.div
              key="cheese"
              data-testid="countdown-hold"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [1, 1.08, 1], opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="text-[20vw] font-black leading-none drop-shadow-2xl"
            >
              {t("kiosk.countdown.hold")}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-10 flex items-center justify-center gap-3 pb-8">
        {Array.from({ length: total }, (_, k) => k + 1).map((i) => (
          <span
            key={i}
            className={
              "block h-3 w-3 rounded-full " +
              (i < step
                ? "bg-brand-yellow"
                : i === step
                  ? "bg-brand-yellow animate-pulse"
                  : "bg-brand-yellow/30")
            }
          />
        ))}
      </div>

      <p className="relative z-10 pb-8 text-center text-2xl font-semibold text-brand-yellow/85">
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
