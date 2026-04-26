"use client";

import { useCallback, useEffect, useState } from "react";
import { dictionary, type DictionaryKey, type Lang } from "./dictionary";

const STORAGE_KEY = "kiosk-lang";

function readStoredLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    if (v === "id" || v === "en") return v;
  } catch {
    // ignore
  }
  return null;
}

export function useTranslation(initial?: Lang) {
  const [lang, setLangState] = useState<Lang>(initial ?? "id");

  useEffect(() => {
    const stored = readStoredLang();
    if (stored) setLangState(stored);
  }, []);

  const setLang = useCallback((v: Lang) => {
    setLangState(v);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, v);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: DictionaryKey, vars?: Record<string, string | number>) => {
      const tpl = dictionary[lang][key] ?? dictionary.id[key] ?? key;
      if (!vars) return tpl;
      return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
        const v = vars[k];
        return v === undefined ? `{${k}}` : String(v);
      });
    },
    [lang],
  );

  return { t, lang, setLang };
}
