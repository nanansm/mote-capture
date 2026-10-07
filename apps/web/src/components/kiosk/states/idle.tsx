import { motion } from "framer-motion";
import type { useTranslation } from "@/lib/i18n/use-translation";
import { formatRupiah } from "@/lib/utils";

type T = ReturnType<typeof useTranslation>["t"];

export function IdleState({
  defaultPrice,
  onStart,
  blocked,
  lowSupply,
  t,
}: {
  defaultPrice: number;
  onStart: () => void;
  /** Kamera diketahui mati: uang tidak boleh masuk (PRD bagian 5). */
  blocked: boolean;
  lowSupply: boolean;
  t: T;
}) {
  return (
    <button
      type="button"
      data-testid="idle-start"
      onClick={blocked ? undefined : onStart}
      aria-disabled={blocked}
      className="relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden bg-gradient-to-br from-brand-yellow via-brand-cream to-brand-pink/40 text-left focus:outline-none"
    >
      <motion.div
        className="pointer-events-none absolute -top-32 -left-32 h-[26rem] w-[26rem] blob-yellow"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ repeat: Infinity, duration: 14, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] blob-pink"
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
        transition={{ repeat: Infinity, duration: 18, ease: "easeInOut" }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 px-8 text-center">
        <img
          src="/wlogogramsquare.webp"
          alt="Maja Photobooth"
          width={140}
          height={140}
          className="rounded-3xl shadow-xl"
        />
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-green-dark/70">
            Maja × Mote Kreatif
          </p>
          <h1 className="text-5xl font-extrabold leading-tight text-brand-green-dark sm:text-6xl">
            {t("kiosk.idle.tagline")}
          </h1>
          <p className="text-xl text-brand-green-dark/80">{t("kiosk.idle.subtitle")}</p>
          <p className="text-lg font-semibold text-brand-green-dark/70">
            {t("kiosk.idle.from_price", { price: formatRupiah(defaultPrice).replace("Rp", "").trim() })}
          </p>
        </div>

        {blocked ? (
          <div
            data-testid="idle-blocked"
            className="rounded-full bg-white px-12 py-6 text-2xl font-bold text-brand-green-dark shadow-xl"
          >
            {t("kiosk.idle.preparing")}
          </div>
        ) : (
          <>
            <motion.div
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
              className="rounded-full bg-brand-green-dark px-16 py-8 shadow-2xl"
            >
              <span className="text-4xl font-extrabold tracking-[0.15em] text-brand-yellow">
                {t("kiosk.idle.start_button")}
              </span>
            </motion.div>
            <p className="text-sm text-brand-green-dark/60">{t("kiosk.idle.tap_anywhere")}</p>
          </>
        )}
        {lowSupply ? (
          <p data-testid="idle-low-supply" className="text-sm font-semibold text-brand-orange">
            {t("kiosk.idle.low_supply")}
          </p>
        ) : null}
      </div>
    </button>
  );
}
