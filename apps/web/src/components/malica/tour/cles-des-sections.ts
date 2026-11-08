/**
 * Les noms des sections de réglage de la tour, sans leurs cartes.
 *
 * La garde d'adresse de `tour.$section.tsx` (`beforeLoad`) reste dans la
 * partie du fichier de route que le routeur charge d'emblée, sur TOUTES les
 * pages. Elle lisait `SECTIONS`, qui importe les onze cartes : 40 Ko de la
 * tour partaient avec la vitrine (mesuré le 7 novembre 2026). Elle ne lit
 * plus que ces noms ; `sections.ts` vérifie, à la compilation, qu'il a une
 * section pour chacun et pas une de plus.
 */
const CLES_DES_SECTIONS = [
  "grille",
  "paiement",
  "emetteur",
  "facturation",
  "relances",
  "calendrier",
  "licences",
  "acces",
  "nuit",
  "modeles",
  "compte",
] as const;

export type CleDeSection = (typeof CLES_DES_SECTIONS)[number];

export function estUneSection(s: string): s is CleDeSection {
  return (CLES_DES_SECTIONS as readonly string[]).includes(s);
}
