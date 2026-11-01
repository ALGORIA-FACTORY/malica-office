/**
 * Les dictionnaires de l'écran, une langue à la fois.
 *
 * ================================================================ POURQUOI
 *
 * Les trois langues pesaient ensemble dans le JavaScript initial — plus de
 * 200 Ko gzippés, dont les deux tiers qu'une personne ne lit jamais. Le budget
 * de la coque (350 Ko, scripts/budget-bundle.mjs) est celui d'un démarrage à
 * froid sous 3,5 s sur un téléphone d'entrée de gamme : chaque refus traduit
 * l'entamait trois fois.
 *
 * Le français reste dans le paquet initial : c'est la langue par défaut et le
 * repli de toute clé. Les autres se chargent quand la personne les choisit, et
 * l'écran ne change de langue qu'une fois le dictionnaire arrivé — jamais un
 * écran à moitié traduit.
 */
import type { Dict } from "@malica/socle/messages-fr";
import { fr } from "@malica/socle/messages-fr";
import type { Locale } from "@malica/socle/messages-langues";

const CHARGEURS: Record<Locale, () => Promise<Dict>> = {
  fr: () => Promise.resolve(fr),
  en: () => import("@malica/socle/messages-en").then((m) => m.en),
  ar: () => import("@malica/socle/messages-ar").then((m) => m.ar),
};

const charges = new Map<Locale, Dict>([["fr", fr]]);
const enCours = new Map<Locale, Promise<Dict>>();

/** Le dictionnaire de repli, toujours là. */
export const DICTIONNAIRE_DE_REPLI: Dict = fr;

/** Le dictionnaire de cette langue s'il est déjà chargé. */
export function dictionnaireCharge(locale: Locale): Dict | undefined {
  return charges.get(locale);
}

/**
 * Charge le dictionnaire d'une langue (une seule fois, même appelé deux fois
 * pendant le chargement). Un échec — hors ligne avant le premier chargement —
 * se propage : l'appelant garde la langue d'avant.
 */
export function chargerLaLangue(locale: Locale): Promise<Dict> {
  const deja = charges.get(locale);
  if (deja) return Promise.resolve(deja);
  const attente = enCours.get(locale);
  if (attente) return attente;
  const promesse = CHARGEURS[locale]()
    .then((dict) => {
      charges.set(locale, dict);
      return dict;
    })
    .finally(() => enCours.delete(locale));
  enCours.set(locale, promesse);
  return promesse;
}
