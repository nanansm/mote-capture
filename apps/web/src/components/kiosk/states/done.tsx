import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { motion } from "framer-motion";
import { Printer, Sparkles } from "lucide-react";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

// Kiosk dilayani agent dari http://localhost, jadi link share harus memakai
// domain publik. VITE_PUBLIC_URL menimpa default (rig uji / domain lain).
function publicOrigin(): string {
  const env = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, "");
  if (env) return env;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "https://capture.motekreatif.com";
  return window.location.origin;
}

export function shareUrlFor(token: string): string {
  return `${publicOrigin()}/share/${encodeURIComponent(token)}`;
}

export function DoneState({
  compositeUrl,
  downloadToken,
  countdown,
  onFinish,
  t,
}: {
  compositeUrl: string | null;
  downloadToken: string | null;
  countdown: number;
  onFinish: () => void;
  t: T;
}) {
  const shareUrl = downloadToken ? shareUrlFor(downloadToken) : null;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!shareUrl) return;
    let alive = true;
    QRCode.toDataURL(shareUrl, { errorCorrectionLevel: "M", margin: 2, width: 360 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [shareUrl]);

  // Background putih polos (tanpa gradient: aturan brand + aman di export).
  return (
    <div data-testid="state-done" className="flex h-full w-full flex-col items-center justify-center gap-6 bg-white px-8 py-6 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className="flex items-center gap-4"
      >
        <div className="rounded-full bg-brand-green-dark p-4 shadow-xl">
          <Sparkles className="h-10 w-10 text-brand-yellow" />
        </div>
        <h1 className="text-5xl font-extrabold text-brand-green-dark">{t("kiosk.done.title")}</h1>
      </motion.div>
      <div className="flex w-full max-w-5xl items-center justify-center gap-10">
        {compositeUrl ? (
          <img data-testid="done-composite" src={compositeUrl} alt="" className="max-h-[55vh] rounded-2xl border-8 border-white shadow-2xl" />
        ) : null}
        {shareUrl ? (
          <div className="flex flex-col items-center gap-3">
            {qr ? <img data-testid="done-qr" data-share-url={shareUrl} src={qr} alt="QR" className="h-64 w-64" /> : null}
            <p className="max-w-xs text-xl font-semibold text-brand-green-dark">{t("kiosk.done.scan")}</p>
          </div>
        ) : null}
      </div>
      <p className="inline-flex items-center gap-3 text-xl text-brand-green-dark/80">
        <Printer className="h-6 w-6" />
        {t("kiosk.done.printing")}
      </p>
      <button
        type="button"
        data-testid="done-finish"
        onClick={onFinish}
        className="rounded-full bg-brand-green-dark px-12 py-4 text-xl font-bold text-brand-yellow"
      >
        {t("kiosk.done.finish")}
      </button>
      <p className="text-base text-brand-green-dark/60">{t("kiosk.done.return", { n: countdown })}</p>
    </div>
  );
}
