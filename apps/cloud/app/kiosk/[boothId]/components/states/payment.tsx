"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

export function PaymentState({
  qrString,
  amount,
  expiresAt,
  mockMode,
  onCancel,
  t,
}: {
  qrString?: string;
  amount?: number;
  expiresAt?: string;
  mockMode: boolean;
  onCancel: () => void;
  t: T;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!qrString) return;
    let active = true;
    QRCode.toDataURL(qrString, { errorCorrectionLevel: "M", margin: 2, width: 480 })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [qrString]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = useMemo(() => {
    if (!expiresAt) return null;
    const t = new Date(expiresAt).getTime() - now;
    return Math.max(0, t);
  }, [expiresAt, now]);

  const remainingDisplay = useMemo(() => {
    if (remainingMs == null) return "--:--";
    const totalSec = Math.floor(remainingMs / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [remainingMs]);

  return (
    <div className="relative flex h-full w-full flex-col bg-brand-cream">
      <div className="flex items-center justify-between border-b border-brand-green-dark/10 px-8 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-green-dark shadow-sm hover:bg-white/80"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.cancel")}
        </button>
        <h2 className="text-3xl font-extrabold tracking-wide text-brand-green-dark">
          {t("kiosk.payment.title")}
        </h2>
        <span className="w-24" />
      </div>

      <div className="flex flex-1 items-center justify-center px-8 py-8">
        <div className="grid w-full max-w-4xl items-center gap-10 lg:grid-cols-[auto,1fr]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto rounded-3xl bg-white p-6 shadow-2xl"
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QRIS"
                width={420}
                height={420}
                className="h-[420px] w-[420px] max-w-full rounded-2xl"
              />
            ) : (
              <div className="flex h-[420px] w-[420px] max-w-full items-center justify-center text-brand-green-dark">
                <Loader2 className="h-10 w-10 animate-spin" />
              </div>
            )}
          </motion.div>

          <div className="space-y-4">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-brand-green-dark/60">
                {t("kiosk.payment.scan")}
              </p>
              <p className="text-base text-brand-green-dark/80">{t("kiosk.payment.providers")}</p>
            </div>
            {amount ? (
              <p className="text-5xl font-extrabold text-brand-green-dark">{formatRupiah(amount)}</p>
            ) : null}
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-brand-green-dark" />
              <span className="text-lg font-semibold text-brand-green-dark">
                {t("kiosk.payment.waiting")}
              </span>
            </div>
            <div className="rounded-full bg-white px-5 py-3 text-lg font-mono text-brand-green-dark shadow-sm">
              {t("kiosk.payment.expires_in", { time: remainingDisplay })}
            </div>
            {mockMode ? (
              <p className="rounded-md bg-brand-yellow/30 px-3 py-2 text-xs font-semibold text-brand-green-dark">
                ⚠ {t("kiosk.payment.mock")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
