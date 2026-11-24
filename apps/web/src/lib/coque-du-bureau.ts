/**
 * La coque de bureau de l'espace PME (maquette desktop validée le 24 novembre 2026) : la rubrique
 * du fil d'Ariane, et les deux raccourcis clavier de la barre latérale.
 *
 * Le téléphone n'en voit rien : le fil d'Ariane et les touches ne vivent qu'au poste de bureau
 * (`useBureau`, la même borne que la feuille `styles-pme-bureau-coque.css`).
 */
import type { MessageKey } from "@/i18n";

/** Les rubriques de la barre latérale ; le fil d'Ariane nomme celle de l'écran ouvert. */
export type Rubrique = "societe" | "bibliotheque" | "echeances" | "prive" | "reglages" | "malica";

export const LIBELLE_DE_RUBRIQUE: Record<Rubrique, MessageKey> = {
  societe: "pme.nav.home",
  bibliotheque: "pme.home.bibliotheque",
  echeances: "pme.nav.echeances",
  prive: "pme.nav.coffre",
  reglages: "pme.reglages.titre",
  malica: "malica.chat.her",
};

/** Le début de chemin de chaque rubrique ; tout le reste de l'espace PME est « Société ». */
const RUBRIQUES: readonly (readonly [string, Rubrique])[] = [
  ["/pme/list", "bibliotheque"],
  ["/pme/dossier", "bibliotheque"],
  ["/pme/piece", "bibliotheque"],
  ["/pme/a-lire", "bibliotheque"],
  ["/pme/echeances", "echeances"],
  ["/pme/coffre", "prive"],
  ["/pme/reglages", "reglages"],
  ["/pme/bouton-plus", "reglages"],
  ["/pme/malica", "malica"],
];

export function rubriqueDuChemin(chemin: string): Rubrique {
  return RUBRIQUES.find(([debut]) => chemin.startsWith(debut))?.[1] ?? "societe";
}

/**
 * Les deux raccourcis : N ajoute une pièce, M ouvre Malica. Lus par la POSITION de la touche
 * (`KeyboardEvent.code`) et non par le caractère : sur un clavier arabe, la touche N rend « ى »,
 * et le raccourci doit rester la même touche.
 */
export type RaccourciDuBureau = "ajouter" | "malica";

const TOUCHES: Record<RaccourciDuBureau, string> = { ajouter: "KeyN", malica: "KeyM" };

/** La lettre gravée sur la touche, pour l'étiquette `<kbd>` et `aria-keyshortcuts`. */
export function lettreDuRaccourci(raccourci: RaccourciDuBureau): string {
  return TOUCHES[raccourci].slice("Key".length);
}

/** Là où une lettre tapée est du texte, ou appartient à une fenêtre ouverte par-dessus. */
const SAISIE_OU_FENETRE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="dialog"], [aria-modal="true"]';

export interface ToucheEnfoncee {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

/**
 * Le raccourci qu'une touche déclenche, ou rien. Rien quand le focus est dans un champ ou dans
 * une fenêtre, quand une touche de modification est tenue (⌘N ouvre une fenêtre du navigateur),
 * pendant une composition (saisie arabe ou accentuée) et quand la touche est maintenue.
 */
export function raccourciDuBureau(e: ToucheEnfoncee): RaccourciDuBureau | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.repeat || e.isComposing || e.defaultPrevented) return null;
  const cible = e.target;
  if (
    cible !== null &&
    typeof (cible as Element).closest === "function" &&
    (cible as Element).closest(SAISIE_OU_FENETRE)
  )
    return null;
  const trouve = (Object.keys(TOUCHES) as RaccourciDuBureau[]).find((r) => TOUCHES[r] === e.code);
  return trouve ?? null;
}
