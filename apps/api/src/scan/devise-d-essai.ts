/**
 * Les devises des épreuves de lecture, telles que `lireLesDevises` les rend :
 * exposant, séparateur décimal, marques imprimées de chaque devise.
 *
 * Rien n'y est recopié à la main : tout vient de l'instantané du référentiel
 * (`referentiel-d-essai.json`), que `le-referentiel-d-essai-dit-vrai.test.ts`
 * rejoue en base. Une épreuve peut choisir l'exposant de la devise du dossier
 * — c'est ce qu'elle éprouve —, jamais ses marques.
 */
import type { DeviseLue } from "@malica/socle/montant-imprime";

import {
  DEVISES_D_ESSAI,
  DEVISE_D_ESSAI,
  MARQUES_D_ESSAI,
  REGLES_DE_LECTURE_D_ESSAI,
} from "./referentiel-d-essai.ts";

/** Toutes les devises du référentiel d'essai, comme `lireLesDevises`. */
export const DEVISES_LUES_D_ESSAI: readonly DeviseLue[] = Object.entries(DEVISES_D_ESSAI).map(
  ([code, d]) => ({
    code,
    decimales: d.exposant,
    separateurDecimal: d.separateurDecimal,
    marques: MARQUES_D_ESSAI,
  }),
);

/**
 * Une devise d'épreuve : la devise du dossier d'essai, à l'exposant que
 * l'épreuve choisit, et au séparateur décimal qu'elle nomme le cas échéant.
 */
export const deviseDEssai = (
  decimales: number,
  separateurDecimal = DEVISES_D_ESSAI[DEVISE_D_ESSAI]!.separateurDecimal,
): DeviseLue => ({
  code: DEVISE_D_ESSAI,
  decimales,
  separateurDecimal,
  marques: MARQUES_D_ESSAI,
});

/**
 * Ce que la relecture au plan de jetons reçoit (`buildExtractFromTokenPlan`) :
 * toutes les devises, celle du dossier d'essai à l'exposant choisi.
 */
export const devisesDEssai = (decimales: number) => ({
  devises: DEVISES_LUES_D_ESSAI.map((d) => (d.code === DEVISE_D_ESSAI ? { ...d, decimales } : d)),
  deviseDuDossier: DEVISE_D_ESSAI,
  // La convention de date et la forme du matricule du pack d'essai.
  regles: REGLES_DE_LECTURE_D_ESSAI,
});
