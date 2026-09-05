import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  LOCALES,
  MESSAGES,
  RTL_LOCALES,
  type Locale,
  type MessageKey,
} from "@regalica/socle/messages";

export { LOCALES, LOCALE_NAMES, RTL_LOCALES } from "@regalica/socle/messages";
export type { Locale, MessageKey } from "@regalica/socle/messages";

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

/**
 * La langue que la personne a choisie, lue hors de React — pour ce qui parle
 * avant le montage ou en dehors de l'arbre : une erreur réseau à traduire,
 * l'écran de secours. Sans choix, ou sans stockage, le français.
 */
export function localeRangee(): Locale {
  try {
    const rangee = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(rangee)) return rangee;
  } catch {
    // Stockage inaccessible — navigation privée, réglage du navigateur.
  }
  return DEFAULT_LOCALE;
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
        let raw = dict[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;

        /*
         * Le pluriel se choisit, il ne s'écrit pas entre parenthèses.
         *
         * « 1 document(s) » est un aveu : on n'a pas su accorder, alors on a
         * mis les deux. Aucune langue ne s'écrit comme ça, et l'arabe ne s'y
         * plie même pas — il compte SIX formes (aucun, un, deux, quelques,
         * beaucoup, autre), là où le français en a deux.
         *
         * `Intl.PluralRules` connaît ces règles pour chaque langue. Quand une
         * variable `count` est présente, on cherche la variante `clé#forme` ;
         * on retombe sur `clé#other`, puis sur la clé nue. Cette chaîne compte :
         * une langue à qui il manque une forme reçoit un pluriel correct au
         * lieu de la parenthèse.
         */
        const n = vars?.["count"];
        if (typeof n === "number") {
          const formes = [new Intl.PluralRules(locale).select(n), "other"];
          for (const forme of formes) {
            const variante = `${key}#${forme}` as MessageKey;
            const trouvee = dict[variante] ?? MESSAGES[DEFAULT_LOCALE][variante];
            if (trouvee !== undefined) {
              raw = trouvee;
              break;
            }
          }
        }

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
