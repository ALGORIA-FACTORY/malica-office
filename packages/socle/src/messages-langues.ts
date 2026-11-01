/**
 * Les langues de l'interface : leur code, leur nom, leur sens d'écriture.
 * Sans aucun libellé : l'écran les lit avant d'avoir chargé un dictionnaire.
 */

export const LOCALES = ["fr", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  ar: "العربية",
};

export const RTL_LOCALES: readonly Locale[] = ["ar"];
