/**
 * La devise des épreuves de lecture : des décimales choisies par l'épreuve, et
 * les marques que porte le référentiel.
 *
 * Les marques sont celles des codes de `ref.devises` et des lignes de
 * `ref.devises_marques` (migration `20261030140000_les_marques_de_devise`).
 * Elles sont recopiées ici pour que les épreuves pures tournent sans base ;
 * `les-marques-de-devise-viennent-du-referentiel.test.ts` vérifie, en base,
 * que la copie et le référentiel disent la même chose.
 */
import type { DeviseLue } from "./normaliser-montants.ts";

export const MARQUES_D_ESSAI: readonly string[] = [
  "D.T",
  "D.T.",
  "DINAR",
  "DINARS",
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

export const deviseDEssai = (decimales: number): DeviseLue => ({
  decimales,
  marques: MARQUES_D_ESSAI,
});
