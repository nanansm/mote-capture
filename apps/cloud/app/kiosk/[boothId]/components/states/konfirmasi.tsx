"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import type { KioskBootData } from "@capture/shared";
import { displayUrl } from "@/lib/storage/r2-client";
import { formatRupiah } from "@/lib/utils";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];
type FrameOption = KioskBootData["frames"][number];

export function KonfirmasiState({
  frame,
  onBack,
  onConfirm,
  busy,
  t,
}: {
  frame: FrameOption;
  onBack: () => void;
  onConfirm: () => void;
  busy: boolean;
  t: T;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-brand-cream">
      <div className="flex items-center justify-between border-b border-brand-green-dark/10 px-8 py-4">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-green-dark shadow-sm hover:bg-white/80 disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </button>
        <h2 className="text-3xl font-extrabold tracking-wide text-brand-green-dark">
          {t("kiosk.confirm.title")}
        </h2>
        <span className="w-24" />
      </div>

      <div className="flex flex-1 items-center justify-center px-8 py-10">
        <div className="grid w-full max-w-3xl gap-8 lg:grid-cols-2 lg:items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-3xl border-4 border-white bg-muted shadow-2xl"
          >
            {frame.previewUrl ? (
              <Image
                src={displayUrl(frame.previewUrl)}
                alt={frame.name}
                fill
                className="object-cover"
                sizes="(min-width:1024px) 360px, 80vw"
                unoptimized
              />
            ) : null}
          </motion.div>

          <div className="flex flex-col gap-6">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-brand-green-dark/60">
                {frame.tier === "premium" ? t("kiosk.frame.premium") : t("kiosk.frame.regular")}
              </p>
              <h3 className="mt-1 text-3xl font-extrabold text-brand-green-dark">{frame.name}</h3>
            </div>
            <div className="rounded-2xl border border-brand-green-dark/10 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between text-lg">
                <span className="font-semibold text-brand-green-dark/80">
                  {t("kiosk.confirm.total")}
                </span>
                <span className="text-3xl font-extrabold text-brand-green-dark">
                  {formatRupiah(frame.price)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-full bg-brand-green-dark px-10 py-6 text-2xl font-extrabold tracking-wider text-brand-yellow shadow-xl transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "..." : t("kiosk.confirm.pay_now")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
