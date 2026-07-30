import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KIOSK_TIMING } from "@capture/shared";
import type { CountdownPhase } from "@/lib/kiosk/state-machine";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

// Bridge runs locally on the booth Mini PC and exposes a /live-preview proxy.
// VITE_BRIDGE_URL lets us point a remote test rig at a different host;
// default matches the bridge's hard-coded port (see local-server.ts).
const BRIDGE_URL =
  (import.meta.env.VITE_BRIDGE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:9876";

export function CountdownState({
  step,
  number,
  phase,
  flashing,
  t,
}: {
  step: 1 | 2 | 3;
  number: number;
  phase: CountdownPhase;
  flashing: boolean;
  t: T;
}) {
  const [previewSrc, setPreviewSrc] = useState<string>("");
  const [previewOk, setPreviewOk] = useState<boolean>(true);
  const failsRef = useRef(0);

  // Poll the bridge's live-view proxy. Cache-bust with a timestamp so the
  // browser doesn't serve a stale frame. After a few consecutive load
  // failures we drop the <img> and fall back to the dashed-frame placeholder
  // (camera disconnected, bridge offline, etc.) — better than a flickering
  // broken-image icon over the countdown text.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setPreviewSrc(`${BRIDGE_URL}/live-preview?t=${Date.now()}`);
    };
    tick();
    const id = window.setInterval(tick, KIOSK_TIMING.LIVE_PREVIEW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col bg-brand-green-dark text-brand-yellow">
      {previewOk && previewSrc ? (
        <img
          src={previewSrc}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
          onLoad={() => {
            failsRef.current = 0;
          }}
          onError={() => {
            failsRef.current += 1;
            if (failsRef.current >= 5) setPreviewOk(false);
          }}
        />
      ) : null}
      {/* Darken the preview so the yellow countdown text stays legible */}
      <div className="absolute inset-0 bg-brand-green-dark/55" />

      <div className="relative z-10 px-8 py-4 text-center">
        <p className="text-xl font-bold uppercase tracking-[0.2em] drop-shadow">
          {t("kiosk.countdown.step", { n: step })}
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
                {t("kiosk.countdown.step", { n: step })}
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
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [1, 1.08, 1], opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="text-[20vw] font-black leading-none drop-shadow-2xl"
            >
              {t("kiosk.countdown.cheese")}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-10 flex items-center justify-center gap-3 pb-8">
        {[1, 2, 3].map((i) => (
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
