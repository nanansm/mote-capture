"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { KioskBootData } from "@capture/shared";
import { displayUrl } from "@/lib/storage/r2-client";
import { formatRupiah, cn } from "@/lib/utils";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];
type FrameOption = KioskBootData["frames"][number];

export function PilihFrameState({
  frames,
  onPick,
  onBack,
  t,
}: {
  frames: FrameOption[];
  onPick: (frame: FrameOption) => void;
  onBack: () => void;
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-brand-cream">
      <div className="flex items-center justify-between border-b border-brand-green-dark/10 px-8 py-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-green-dark shadow-sm hover:bg-white/80"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </button>
        <h2 className="text-3xl font-extrabold tracking-wide text-brand-green-dark">
          {t("kiosk.frame.title")}
        </h2>
        <span className="w-24" />
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {frames.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-lg text-brand-green-dark/60">{t("kiosk.frame.empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {frames.map((f, idx) => (
              <motion.button
                key={f.id}
                type="button"
                onClick={() => onPick(f)}
                whileTap={{ scale: 0.96 }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-2xl border-4 bg-white text-left shadow-md transition-shadow hover:shadow-xl",
                  f.tier === "premium"
                    ? "border-brand-orange"
                    : "border-brand-yellow",
                )}
              >
                {/* Landscape 4R frame is 1800×1200 = 3:2 ratio. Container
                    matches the aspect, image inside uses object-contain with
                    inner padding so branding ("MAJA PHOTOBOOTH") is never
                    cropped at any breakpoint. */}
                <div className="relative aspect-[3/2] w-full bg-brand-cream/60">
                  <div className="absolute inset-2 sm:inset-3">
                    {f.previewUrl ? (
                      <Image
                        src={displayUrl(f.previewUrl)}
                        alt={f.name}
                        fill
                        className="object-contain"
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-brand-green-dark/40">
                        no preview
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "absolute right-2 top-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm",
                      f.tier === "premium"
                        ? "bg-brand-orange text-white"
                        : "bg-brand-yellow text-brand-green-dark",
                    )}
                  >
                    {f.tier === "premium" ? t("kiosk.frame.premium") : t("kiosk.frame.regular")}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="truncate text-base font-semibold text-brand-green-dark">{f.name}</p>
                  <p className="shrink-0 text-sm font-bold text-brand-green-dark/80">{formatRupiah(f.price)}</p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-brand-green-dark/10 bg-white/70 px-8 py-3 text-center text-sm font-semibold text-brand-green-dark/70">
        {t("kiosk.frame.regular")} {formatRupiah(30000)}{"  ·  "}
        {t("kiosk.frame.premium")} {formatRupiah(40000)}
      </div>
    </div>
  );
}
