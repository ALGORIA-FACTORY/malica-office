import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { LOCALES, MESSAGES, RTL_LOCALES, type Locale, type MessageKey } from "./messages";

export { LOCALES, LOCALE_NAMES, RTL_LOCALES } from "./messages";
export type { Locale, MessageKey } from "./messages";

const STORAGE_KEY = "regalica.locale";
const DEFAULT_LOCALE: Locale = "fr";

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

type Vars = Record<string, string | number>;

interface I18nValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (next: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Lecture après hydratation : jamais dans un initialiseur d'état.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) setLocaleState(stored);
  }, []);

  useEffect(() => {
    const dir = dirFor(locale);
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("dir", dir);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = MESSAGES[locale];
    return {
      locale,
      dir: dirFor(locale),
      setLocale,
      t: (key, vars) => {
        const raw = dict[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
        if (!vars) return raw;
        return Object.entries(vars).reduce(
          (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
          raw,
        );
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n doit être utilisé dans I18nProvider");
  return ctx;
}
