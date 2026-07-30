import type { Lang } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";

export function LanguageToggle({
  lang,
  setLang,
  className,
}: {
  lang: Lang;
  setLang: (v: Lang) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed right-6 top-6 z-30 inline-flex overflow-hidden rounded-full border border-brand-green-dark/20 bg-white/90 p-1 shadow-lg backdrop-blur",
        className,
      )}
      role="group"
      aria-label="Language toggle"
    >
      {(["id", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-semibold uppercase tracking-wider transition-colors",
            lang === l
              ? "bg-brand-green-dark text-brand-yellow"
              : "text-brand-green-dark hover:bg-brand-cream",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
