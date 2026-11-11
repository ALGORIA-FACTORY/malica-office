/**
 * La langue de l'interface — le fournisseur de traductions et le hook `useI18n`.
 *
 * Fournit à tous les écrans la fonction `t(clé, variables)`, la langue active et son
 * sens d'écriture (gauche-droite ou droite-gauche, réglé sur la page). La langue choisie
 * est rangée dans le navigateur ; l'écran n'affiche une langue qu'une fois son
 * dictionnaire chargé, et retombe sur le français hors ligne. Le pluriel se choisit
 * par `Intl.PluralRules` quand une variable `count` est donnée, au lieu d'écrire
 * « document(s) ». Une clé absente se montre telle quelle : c'est un défaut visible.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Dict, MessageKey } from "@malica/socle/messages-fr";
import { remplirLeGabarit } from "@malica/socle/gabarit";
import { LOCALES, RTL_LOCALES, type Locale } from "@malica/socle/messages-langues";

import { CIBLE_COQUE } from "@/capabilities/coque";

import { chargerLaLangue, dictionnaireCharge, dictionnaireDeRepli } from "./dictionnaires";

export { LOCALES, LOCALE_NAMES } from "@malica/socle/messages-langues";
export type { Locale } from "@malica/socle/messages-langues";
export type { MessageKey } from "@malica/socle/messages-fr";

const STORAGE_KEY = "malica.locale";
const DEFAULT_LOCALE: Locale = "fr";

function dirFor(locale: Locale): "ltr" | "rtl" {
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
  // Dans la coque, rien n'est rendu côté serveur : la langue choisie peut être
  // lue tout de suite, et l'écran naît dans la bonne. Sur le site, le premier
  // rendu doit rester celui du serveur — on lit après l'hydratation.
  // Chaque choix est une nouvelle demande, même répété : une langue dont le
  // chargement a échoué (hors ligne) se recharge quand la personne la choisit
  // de nouveau, sans devoir passer par une autre.
  const [voulue, setVoulue] = useState<{ locale: Locale }>(() => ({
    locale: CIBLE_COQUE && typeof window !== "undefined" ? localeRangee() : DEFAULT_LOCALE,
  }));
  // La langue affichée est celle dont le dictionnaire est arrivé : l'écran
  // garde la précédente le temps du chargement (i18n/dictionnaires.ts).
  const [locale, setAffichee] = useState<Locale | null>(() =>
    dictionnaireCharge(voulue.locale) ? voulue.locale : null,
  );

  // Lecture après hydratation : jamais dans un initialiseur d'état.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) setVoulue({ locale: stored });
  }, []);

  useEffect(() => {
    let actuel = true;
    chargerLaLangue(voulue.locale)
      .then(() => {
        if (actuel) setAffichee(voulue.locale);
      })
      // Hors ligne avant le premier chargement : l'écran reste dans la langue
      // d'avant — le français au démarrage — plutôt que de ne rien montrer.
      .catch(() => {
        if (actuel) setAffichee((avant) => avant ?? DEFAULT_LOCALE);
      });
    return () => {
      actuel = false;
    };
  }, [voulue]);

  useEffect(() => {
    if (!locale) return;
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.setAttribute("dir", dirFor(locale));
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setVoulue({ locale: next });
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  // La coque ouverte dans une autre langue que le français attend son
  // dictionnaire (un fichier local, quelques millisecondes) : jamais un premier
  // écran en français pour une personne qui lit l'arabe.
  if (!locale) return null;

  return (
    <Traductions locale={locale} setLocale={setLocale}>
      {children}
    </Traductions>
  );
}

function Traductions({
  locale,
  setLocale,
  children,
}: {
  locale: Locale;
  setLocale: (next: Locale) => void;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(() => {
    // Le repli (le français) n'est là que s'il a été chargé : l'anglais et
    // l'arabe sont complets et n'en ont pas besoin (`dictionnaires.ts`).
    const repli: Partial<Dict> = dictionnaireDeRepli() ?? {};
    const dict: Partial<Dict> = dictionnaireCharge(locale) ?? repli;
    return {
      locale,
      dir: dirFor(locale),
      setLocale,
      t: (key, vars) => {
        let raw = dict[key] ?? repli[key] ?? key;

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
            const trouvee = dict[variante] ?? repli[variante];
            if (trouvee !== undefined) {
              raw = trouvee;
              break;
            }
          }
        }

        return vars ? remplirLeGabarit(raw, vars) : raw;
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
