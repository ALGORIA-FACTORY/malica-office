/**
 * Les dictionnaires de l'écran : une langue à la fois — le français compris —
 * et, dans chaque langue, la base d'abord, les espaces ensuite.
 *
 * ================================================================ POURQUOI
 *
 * Les trois langues pesaient ensemble dans le JavaScript initial — plus de
 * 200 Ko gzippés, dont les deux tiers qu'une personne ne lit jamais. Le budget
 * de la coque (scripts/budget-bundle.mjs) est celui d'un démarrage à
 * froid sous 3,5 s sur un téléphone d'entrée de gamme : chaque refus traduit
 * l'entamait trois fois.
 *
 * Le français restait dans le paquet initial, entier, comme repli de toute
 * clé : 74 Ko gzippés préchargés par chaque page, y compris pour une personne
 * qui lit l'arabe et charge ensuite le sien (audit web du 6 novembre 2026). Il
 * se charge désormais comme les autres, et en deux paquets
 * (`dictionnaires-par-espace.ts`) : la BASE — ce que lisent la vitrine, la
 * connexion, l'invitation, les erreurs — et les ESPACES (cabinet, PME, tour),
 * les quatre cinquièmes du poids. Rien ne s'affiche pour autant en clés :
 *
 *   - le serveur charge tout avant sa première page (`server.ts`), les
 *     épreuves avant leur premier rendu (`vitest.config.ts`, `setupFiles`) ;
 *   - le navigateur attend la base de la langue du premier rendu AVANT
 *     l'hydratation (`demarrage-client.tsx`) : ce rendu est celui du serveur ;
 *   - un espace attend ses paquets avant son premier écran
 *     (`chargerLesEspaces`, appelé par la garde de `_authenticated`) ; ensuite,
 *     chaque langue chargée vient avec eux ;
 *   - une autre langue ne s'affiche qu'une fois arrivée — jamais un écran à
 *     moitié traduit. L'anglais et l'arabe sont complets : ils n'ont pas
 *     besoin du français derrière eux.
 */
import type { Dict, MessageKey } from "@malica/socle/messages-fr";
import type { Locale } from "@malica/socle/messages-langues";

type Paquet = "base" | "espaces";
type Morceau = Partial<Dict>;

const CHARGEURS: Record<Locale, Record<Paquet, () => Promise<Morceau>>> = {
  fr: {
    base: () => import("virtual:dictionnaire/fr/base").then((m) => m.default),
    espaces: () => import("virtual:dictionnaire/fr/espaces").then((m) => m.default),
  },
  en: {
    base: () => import("virtual:dictionnaire/en/base").then((m) => m.default),
    espaces: () => import("virtual:dictionnaire/en/espaces").then((m) => m.default),
  },
  ar: {
    base: () => import("virtual:dictionnaire/ar/base").then((m) => m.default),
    espaces: () => import("virtual:dictionnaire/ar/espaces").then((m) => m.default),
  },
};

/**
 * Le dictionnaire de chaque langue, tel que chargé : la base, puis les espaces
 * VERSÉS DANS LE MÊME OBJET. Un écran déjà rendu lit donc les clés des espaces
 * dès leur arrivée, sans que le fournisseur de traductions ait à se refaire.
 */
const charges = new Map<Locale, Morceau>();
const paquetsCharges = new Map<Locale, Set<Paquet>>();
const enCours = new Map<string, Promise<void>>();
/** Vrai dès qu'un espace a été ouvert : chaque langue chargée ensuite vient avec ses espaces. */
let espacesVoulus = false;

function chargerUnPaquet(locale: Locale, paquet: Paquet): Promise<void> {
  if (paquetsCharges.get(locale)?.has(paquet)) return Promise.resolve();
  const cle = `${locale}/${paquet}`;
  const attente = enCours.get(cle);
  if (attente) return attente;
  const promesse = CHARGEURS[locale][paquet]()
    .then((morceau) => {
      const dict = charges.get(locale);
      // La langue ne compte pour « chargée » qu'avec sa base (`dictionnaireCharge`).
      if (dict) Object.assign(dict, morceau);
      else charges.set(locale, { ...morceau });
      const deja = paquetsCharges.get(locale) ?? new Set<Paquet>();
      deja.add(paquet);
      paquetsCharges.set(locale, deja);
    })
    .finally(() => enCours.delete(cle));
  enCours.set(cle, promesse);
  return promesse;
}

/** Le dictionnaire de repli — le français, quand sa base est chargée. */
export function dictionnaireDeRepli(): Morceau | undefined {
  return dictionnaireCharge("fr");
}

/**
 * Un libellé lu hors de l'arbre React — l'en-tête d'une route (`head`), qui se
 * rend avant que la langue de la personne soit connue : en français, la
 * langue par défaut ; dans la coque ouverte dans une autre langue, où le
 * français n'est pas chargé, dans celle-là. Jamais en dur dans le code.
 */
export function libelleHorsArbre(cle: MessageKey): string {
  const dict = dictionnaireDeRepli() ?? [...charges.values()][0];
  return dict?.[cle] ?? cle;
}

/** Le dictionnaire de cette langue si sa base est chargée. */
export function dictionnaireCharge(locale: Locale): Morceau | undefined {
  return paquetsCharges.get(locale)?.has("base") ? charges.get(locale) : undefined;
}

/**
 * Charge le dictionnaire d'une langue — sa base, et ses espaces si un espace
 * est ouvert — une seule fois, même appelé deux fois pendant le chargement.
 * Un échec — hors ligne avant le premier chargement — se propage : l'appelant
 * garde la langue d'avant.
 */
export async function chargerLaLangue(locale: Locale): Promise<Morceau> {
  await Promise.all([
    chargerUnPaquet(locale, "base"),
    ...(espacesVoulus ? [chargerUnPaquet(locale, "espaces")] : []),
  ]);
  return charges.get(locale)!;
}

/**
 * Ouvre les espaces : les paquets des langues déjà chargées, et de la langue
 * demandée, arrivent avant que la promesse se tienne — puis chaque langue
 * chargée ensuite les emporte avec elle.
 */
export async function chargerLesEspaces(locale: Locale): Promise<void> {
  espacesVoulus = true;
  const langues = new Set<Locale>([locale, ...charges.keys()]);
  await Promise.all([...langues].map((l) => chargerLaLangue(l)));
}
