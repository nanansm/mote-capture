import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { useTranslation } from "@/lib/i18n/use-translation";

type T = ReturnType<typeof useTranslation>["t"];

const ID_PHONE_RE = /^(\+?62|0|8)[\d\s\-]{6,}$/;

export function InputKontakState({
  onSubmit,
  onSkip,
  busy,
  t,
}: {
  onSubmit: (data: { phone: string; email?: string }) => void;
  onSkip: () => void;
  busy: boolean;
  t: T;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!ID_PHONE_RE.test(phone.trim())) {
      setError(t("kiosk.contact.invalid_phone"));
      return;
    }
    onSubmit({ phone: phone.trim(), email: email.trim() || undefined });
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-brand-cream px-6 py-8">
      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-2xl"
      >
        <div className="space-y-1 text-center">
          <h2 className="text-3xl font-extrabold text-brand-green-dark">{t("kiosk.contact.title")}</h2>
          <p className="text-sm text-brand-green-dark/70">{t("kiosk.contact.subtitle")}</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-brand-green-dark">
              {t("kiosk.contact.phone")}
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08123456789"
              className="block w-full rounded-xl border-2 border-brand-green-dark/15 bg-brand-cream/60 px-4 py-4 text-lg font-medium focus:border-brand-green-dark focus:outline-none"
              required
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-brand-green-dark">
              {t("kiosk.contact.email")}
            </span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kamu@email.com"
              className="block w-full rounded-xl border-2 border-brand-green-dark/15 bg-brand-cream/60 px-4 py-4 text-lg font-medium focus:border-brand-green-dark focus:outline-none"
              disabled={busy}
            />
          </label>
        </div>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-full bg-brand-green-dark px-6 py-4 text-xl font-extrabold tracking-wider text-brand-yellow shadow-xl active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : t("kiosk.contact.send")}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="rounded-full border-2 border-brand-green-dark/30 px-6 py-4 text-base font-bold text-brand-green-dark hover:bg-white"
          >
            {t("kiosk.contact.skip")}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
