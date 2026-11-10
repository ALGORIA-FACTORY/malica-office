/**
 * Le sélecteur de langue — un bouton par langue, la langue active en négatif.
 *
 * Les langues viennent du module d'internationalisation (`@/i18n`), jamais d'une liste
 * écrite ici ; l'arabe s'affiche par son nom, les autres par leur code. Le bouton de la
 * langue active porte `aria-pressed`, et un libellé réservé aux lecteurs d'écran nomme le
 * groupe. Le changement de langue bascule aussi le sens de lecture (RTL), ailleurs.
 */
import { LOCALES, LOCALE_NAMES, useI18n, type Locale } from "@/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">{t("nav.language")}</span>
      <div className="flex border border-border">
        {LOCALES.map((l: Locale) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={locale === l}
            className={`px-2 py-1 text-xs uppercase tracking-wide transition-colors ${
              locale === l
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {l === "ar" ? LOCALE_NAMES.ar : l}
          </button>
        ))}
      </div>
    </div>
  );
}
