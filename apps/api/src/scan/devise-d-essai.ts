/**
 * La devise des épreuves de lecture : des décimales choisies par l'épreuve, le
 * séparateur décimal et les marques que porte le référentiel.
 *
 * Les marques sont celles des codes de `ref.devises` et des lignes de
 * `ref.devises_marques` (migration `20261030140000_les_marques_de_devise`).
 * Elles sont recopiées ici pour que les épreuves pures tournent sans base ;
 * `les-marques-de-devise-viennent-du-referentiel.test.ts` vérifie, en base,
 * que la copie et le référentiel disent la même chose. Le séparateur décimal
 * vient de l'instantané du référentiel (`referentiel-d-essai.json`), vérifié
 * en base lui aussi.
 */
import type { DeviseLue } from "@malica/socle/montant-imprime";

import { DEVISES_D_ESSAI, DEVISE_D_ESSAI } from "./referentiel-d-essai.ts";

export const MARQUES_D_ESSAI: readonly string[] = [
  "D.T",
  "D.T.",
  "DINAR",
  "DINARS",
  "D.N.T",
  "D.N.T.",
  "DNT",
  "DNT.",
  "DT",
  "DT.",
  "EUR",
  "TND",
  "TND.",
  "XOF",
  "د.ت",
  "د.ت.",
  "€",
];

/**
 * Une devise d'épreuve : l'exposant que l'épreuve choisit, le séparateur
 * décimal de la devise du dossier d'essai, sauf si l'épreuve en nomme un.
 */
export const deviseDEssai = (
  decimales: number,
  separateurDecimal = DEVISES_D_ESSAI[DEVISE_D_ESSAI]!.separateurDecimal,
): DeviseLue => ({
  decimales,
  separateurDecimal,
  marques: MARQUES_D_ESSAI,
});
