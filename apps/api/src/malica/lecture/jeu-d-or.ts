/**
 * Le jeu d'or — de vraies factures tunisiennes, et ce qu'elles disent.
 *
 * ================================================================= POURQUOI
 *
 * Le 5 octobre 2026, le diagnostic des essais réels a montré que les tests du
 * dépôt étaient bons, nombreux, verts — et écrits sur des factures INVENTÉES.
 * C'est ce choix, pas leur qualité, qui a laissé passer quatre défauts : un
 * montant tronqué à l'espace des milliers, une date en lettres jamais lue, un
 * timbre jamais affiché, quatre motifs empilés dont un seul visible.
 *
 * Ce fichier porte donc des pièces RÉELLES, avec leur plan de jetons tel que
 * l'œil l'a relevé — pas un plan recomposé à la main pour illustrer une idée.
 * Chaque cas nomme sa provenance, pour qu'on puisse retrouver l'original et
 * vérifier que le banc ne raconte pas une histoire plus commode que la pièce.
 *
 * ============================================================= LA DISCIPLINE
 *
 * Un cas porte trois choses, et la distinction est le cœur du dispositif :
 *
 *   `tokens`      ce que l'œil a lu. Donnée brute, jamais retouchée.
 *   `designation` ce que le modèle qui désigne DOIT renvoyer. C'est une
 *                 attente, pas une mesure : elle décrit la bonne réponse.
 *   `attendu`     les valeurs que la relecture doit produire, relues au plan.
 *
 * Le banc pur (`jeu-d-or.test.ts`, dans `npm test`) joue `designation` et
 * vérifie `attendu` : il prouve que la RELECTURE est juste, sans appeler aucun
 * modèle, donc à chaque exécution et gratuitement.
 *
 * Que le modèle produise bien cette `designation` est une autre question —
 * elle se mesure contre le vrai modèle, et c'est l'affaire de l'épreuve
 * réelle. Les deux garanties sont distinctes et toutes deux nécessaires : une
 * relecture juste sur une désignation fausse rend un montant faux.
 */
import type { PageToken } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

export interface CasDOr {
  /** Le nom du cas, qui apparaît dans le rapport du banc. */
  nom: string;
  /** D'où vient cette pièce : sans quoi le cas n'est pas vérifiable. */
  provenance: string;
  /** Décimales de la devise de la pièce. */
  decimales: number;
  /** Ce que l'œil a relevé. */
  tokens: PageToken[];
  /** Ce que le désignateur doit renvoyer. */
  designation: VisionSelection;
  /**
   * Les valeurs attendues, par chemin dans l'extrait. `null` veut dire « le
   * produit ne doit rien écrire », ce qui est une attente aussi forte qu'une
   * valeur : inventer vaut aussi faux que tronquer.
   */
  attendu: Record<string, string | null>;
  /**
   * Ce que la pièce IMPRIME, en clair. Ne sert à aucune assertion : sert à
   * l'humain qui relira ce fichier dans six mois et devra juger si `attendu`
   * dit vrai sans avoir la pièce sous les yeux.
   */
  imprime: Record<string, string>;
}

const ref = (ordinal: number, ordinalEnd?: number) =>
  ordinalEnd === undefined ? { page: 1, ordinal } : { page: 1, ordinal, ordinalEnd };

const JETONS_LOYER: PageToken[] = [
  { page: 1, ordinal: 0, text: "Mme", x0: 0.1285, y0: 0.0675, x1: 0.1587, y1: 0.0805 },
  { page: 1, ordinal: 1, text: "Leila", x0: 0.1687, y0: 0.0675, x1: 0.219, y1: 0.0805 },
  { page: 1, ordinal: 2, text: "BEN", x0: 0.229, y0: 0.0675, x1: 0.2592, y1: 0.0805 },
  { page: 1, ordinal: 3, text: "SALEM", x0: 0.2692, y0: 0.0675, x1: 0.3195, y1: 0.0805 },
  { page: 1, ordinal: 4, text: "8,", x0: 0.1305, y0: 0.103, x1: 0.1464, y1: 0.117 },
  { page: 1, ordinal: 5, text: "Rue", x0: 0.1543, y0: 0.103, x1: 0.1782, y1: 0.117 },
  { page: 1, ordinal: 6, text: "Ibn", x0: 0.1861, y0: 0.103, x1: 0.21, y1: 0.117 },
  { page: 1, ordinal: 7, text: "Khaldoun", x0: 0.2179, y0: 0.103, x1: 0.2815, y1: 0.117 },
  { page: 1, ordinal: 8, text: "2092", x0: 0.1295, y0: 0.1185, x1: 0.159, y1: 0.1335 },
  { page: 1, ordinal: 9, text: "El", x0: 0.1664, y0: 0.1185, x1: 0.1811, y1: 0.1335 },
  { page: 1, ordinal: 10, text: "Manar", x0: 0.1885, y0: 0.1185, x1: 0.2254, y1: 0.1335 },
  { page: 1, ordinal: 11, text: "II", x0: 0.2328, y0: 0.1185, x1: 0.2475, y1: 0.1335 },
  { page: 1, ordinal: 12, text: "-", x0: 0.2549, y0: 0.1185, x1: 0.2623, y1: 0.1335 },
  { page: 1, ordinal: 13, text: "Tunis", x0: 0.2696, y0: 0.1185, x1: 0.3065, y1: 0.1335 },
  { page: 1, ordinal: 14, text: "Matricule", x0: 0.1285, y0: 0.1365, x1: 0.1961, y1: 0.1515 },
  { page: 1, ordinal: 15, text: "fiscal", x0: 0.2036, y0: 0.1365, x1: 0.2487, y1: 0.1515 },
  { page: 1, ordinal: 16, text: ":", x0: 0.2562, y0: 0.1365, x1: 0.2638, y1: 0.1515 },
  {
    page: 1,
    ordinal: 17,
    text: "1456987L/A/P/000",
    x0: 0.2713,
    y0: 0.1365,
    x1: 0.3915,
    y1: 0.1515,
  },
  { page: 1, ordinal: 18, text: "Tél", x0: 0.1265, y0: 0.1555, x1: 0.1496, y1: 0.1685 },
  { page: 1, ordinal: 19, text: ":", x0: 0.1573, y0: 0.1555, x1: 0.1649, y1: 0.1685 },
  { page: 1, ordinal: 20, text: "98", x0: 0.1726, y0: 0.1555, x1: 0.188, y1: 0.1685 },
  { page: 1, ordinal: 21, text: "456", x0: 0.1957, y0: 0.1555, x1: 0.2188, y1: 0.1685 },
  { page: 1, ordinal: 22, text: "123", x0: 0.2264, y0: 0.1555, x1: 0.2495, y1: 0.1685 },
  { page: 1, ordinal: 23, text: "ALGORIA", x0: 0.6265, y0: 0.1395, x1: 0.7048, y1: 0.1525 },
  { page: 1, ordinal: 24, text: "FACTORY", x0: 0.716, y0: 0.1395, x1: 0.7944, y1: 0.1525 },
  { page: 1, ordinal: 25, text: "SUARL", x0: 0.8055, y0: 0.1395, x1: 0.8615, y1: 0.1525 },
  { page: 1, ordinal: 26, text: "Immeuble", x0: 0.4225, y0: 0.1545, x1: 0.4831, y1: 0.1695 },
  { page: 1, ordinal: 27, text: "Le", x0: 0.4906, y0: 0.1545, x1: 0.5058, y1: 0.1695 },
  { page: 1, ordinal: 28, text: "Prestige,", x0: 0.5133, y0: 0.1545, x1: 0.5814, y1: 0.1695 },
  { page: 1, ordinal: 29, text: "Rue", x0: 0.589, y0: 0.1545, x1: 0.6117, y1: 0.1695 },
  { page: 1, ordinal: 30, text: "du", x0: 0.6193, y0: 0.1545, x1: 0.6344, y1: 0.1695 },
  { page: 1, ordinal: 31, text: "Lac", x0: 0.642, y0: 0.1545, x1: 0.6647, y1: 0.1695 },
  { page: 1, ordinal: 32, text: "Biwa,", x0: 0.6723, y0: 0.1545, x1: 0.7101, y1: 0.1695 },
  { page: 1, ordinal: 33, text: "Les", x0: 0.7177, y0: 0.1545, x1: 0.7404, y1: 0.1695 },
  { page: 1, ordinal: 34, text: "Berges", x0: 0.748, y0: 0.1545, x1: 0.7934, y1: 0.1695 },
  { page: 1, ordinal: 35, text: "du", x0: 0.8009, y0: 0.1545, x1: 0.8161, y1: 0.1695 },
  { page: 1, ordinal: 36, text: "Lac", x0: 0.8237, y0: 0.1545, x1: 0.8464, y1: 0.1695 },
  { page: 1, ordinal: 37, text: "1", x0: 0.8539, y0: 0.1545, x1: 0.8615, y1: 0.1695 },
  { page: 1, ordinal: 38, text: "1053", x0: 0.7825, y0: 0.1755, x1: 0.8141, y1: 0.1885 },
  { page: 1, ordinal: 39, text: "Tunis", x0: 0.822, y0: 0.1755, x1: 0.8615, y1: 0.1885 },
  { page: 1, ordinal: 40, text: "MF", x0: 0.6795, y0: 0.1925, x1: 0.6964, y1: 0.2075 },
  { page: 1, ordinal: 41, text: ":", x0: 0.7048, y0: 0.1925, x1: 0.7132, y1: 0.2075 },
  {
    page: 1,
    ordinal: 42,
    text: "1876543W/A/M/000",
    x0: 0.7216,
    y0: 0.1925,
    x1: 0.8565,
    y1: 0.2075,
  },
  { page: 1, ordinal: 43, text: "Tunis,", x0: 0.6745, y0: 0.2345, x1: 0.7177, y1: 0.2495 },
  { page: 1, ordinal: 44, text: "le", x0: 0.7248, y0: 0.2345, x1: 0.7392, y1: 0.2495 },
  { page: 1, ordinal: 45, text: "1", x0: 0.7464, y0: 0.2345, x1: 0.7536, y1: 0.2495 },
  { page: 1, ordinal: 46, text: "septembre", x0: 0.7608, y0: 0.2345, x1: 0.8255, y1: 0.2495 },
  { page: 1, ordinal: 47, text: "2026", x0: 0.8327, y0: 0.2345, x1: 0.8615, y1: 0.2495 },
  { page: 1, ordinal: 48, text: "FACTURE", x0: 0.2084, y0: 0.2585, x1: 0.2953, y1: 0.2855 },
  { page: 1, ordinal: 49, text: "DE", x0: 0.3077, y0: 0.2585, x1: 0.3326, y1: 0.2855 },
  { page: 1, ordinal: 50, text: "LOYER", x0: 0.345, y0: 0.2585, x1: 0.4071, y1: 0.2855 },
  { page: 1, ordinal: 51, text: "-", x0: 0.4195, y0: 0.2585, x1: 0.4319, y1: 0.2855 },
  { page: 1, ordinal: 52, text: "SEPTEMBRE", x0: 0.4443, y0: 0.2585, x1: 0.5561, y1: 0.2855 },
  { page: 1, ordinal: 53, text: "2026", x0: 0.5685, y0: 0.2585, x1: 0.6182, y1: 0.2855 },
  { page: 1, ordinal: 54, text: "N°", x0: 0.6306, y0: 0.2585, x1: 0.6554, y1: 0.2855 },
  { page: 1, ordinal: 55, text: "L-2026-09", x0: 0.6678, y0: 0.2585, x1: 0.7796, y1: 0.2855 },
  { page: 1, ordinal: 56, text: "Désignation", x0: 0.1345, y0: 0.3045, x1: 0.2295, y1: 0.3195 },
  { page: 1, ordinal: 57, text: "Quantité", x0: 0.4355, y0: 0.3095, x1: 0.5045, y1: 0.3225 },
  { page: 1, ordinal: 58, text: "Prix", x0: 0.5245, y0: 0.3095, x1: 0.5578, y1: 0.3265 },
  { page: 1, ordinal: 59, text: "unitaire", x0: 0.5662, y0: 0.3095, x1: 0.6328, y1: 0.3265 },
  { page: 1, ordinal: 60, text: "HT", x0: 0.6412, y0: 0.3095, x1: 0.6578, y1: 0.3265 },
  { page: 1, ordinal: 61, text: "(DT)", x0: 0.6662, y0: 0.3095, x1: 0.6995, y1: 0.3265 },
  { page: 1, ordinal: 62, text: "Montant", x0: 0.7125, y0: 0.3125, x1: 0.7792, y1: 0.3275 },
  { page: 1, ordinal: 63, text: "HT", x0: 0.7888, y0: 0.3125, x1: 0.8078, y1: 0.3275 },
  { page: 1, ordinal: 64, text: "(DT)", x0: 0.8174, y0: 0.3125, x1: 0.8555, y1: 0.3275 },
  { page: 1, ordinal: 65, text: "Loyer", x0: 0.1314, y0: 0.3349, x1: 0.1709, y1: 0.3531 },
  { page: 1, ordinal: 66, text: "mensuel", x0: 0.1788, y0: 0.3349, x1: 0.2342, y1: 0.3531 },
  { page: 1, ordinal: 67, text: "local", x0: 0.2421, y0: 0.3349, x1: 0.2816, y1: 0.3531 },
  { page: 1, ordinal: 68, text: "à", x0: 0.2895, y0: 0.3349, x1: 0.2974, y1: 0.3531 },
  { page: 1, ordinal: 69, text: "usage", x0: 0.3053, y0: 0.3349, x1: 0.3449, y1: 0.3531 },
  { page: 1, ordinal: 70, text: "de", x0: 0.3528, y0: 0.3349, x1: 0.3686, y1: 0.3531 },
  { page: 1, ordinal: 71, text: "bureaux", x0: 0.1334, y0: 0.3528, x1: 0.1864, y1: 0.3712 },
  { page: 1, ordinal: 72, text: "-", x0: 0.1939, y0: 0.3528, x1: 0.2015, y1: 0.3712 },
  { page: 1, ordinal: 73, text: "Immeuble", x0: 0.209, y0: 0.3528, x1: 0.2696, y1: 0.3712 },
  { page: 1, ordinal: 74, text: "Le", x0: 0.2771, y0: 0.3528, x1: 0.2923, y1: 0.3712 },
  { page: 1, ordinal: 75, text: "Prestige,", x0: 0.2998, y0: 0.3528, x1: 0.3679, y1: 0.3712 },
  { page: 1, ordinal: 76, text: "3e", x0: 0.3755, y0: 0.3528, x1: 0.3906, y1: 0.3712 },
  { page: 1, ordinal: 77, text: "étage", x0: 0.1339, y0: 0.3713, x1: 0.1717, y1: 0.3887 },
  { page: 1, ordinal: 78, text: "(Sept.", x0: 0.1793, y0: 0.3713, x1: 0.2247, y1: 0.3887 },
  { page: 1, ordinal: 79, text: "2026)", x0: 0.2323, y0: 0.3713, x1: 0.2701, y1: 0.3887 },
  { page: 1, ordinal: 80, text: "Quote-part", x0: 0.1354, y0: 0.4021, x1: 0.2124, y1: 0.4219 },
  { page: 1, ordinal: 81, text: "charges", x0: 0.2201, y0: 0.4021, x1: 0.274, y1: 0.4219 },
  { page: 1, ordinal: 82, text: "communes", x0: 0.2817, y0: 0.4021, x1: 0.3433, y1: 0.4219 },
  { page: 1, ordinal: 83, text: "(syndic,", x0: 0.351, y0: 0.4021, x1: 0.4126, y1: 0.4219 },
  { page: 1, ordinal: 84, text: "ascenseur,", x0: 0.1319, y0: 0.4209, x1: 0.2102, y1: 0.4391 },
  { page: 1, ordinal: 85, text: "gardiennage)", x0: 0.2181, y0: 0.4209, x1: 0.3121, y1: 0.4391 },
  { page: 1, ordinal: 86, text: "1", x0: 0.4925, y0: 0.3605, x1: 0.5035, y1: 0.3715 },
  { page: 1, ordinal: 87, text: "1", x0: 0.4925, y0: 0.4185, x1: 0.5035, y1: 0.4295 },
  { page: 1, ordinal: 88, text: "2", x0: 0.6215, y0: 0.3615, x1: 0.6296, y1: 0.3745 },
  { page: 1, ordinal: 89, text: "800,000", x0: 0.6377, y0: 0.3615, x1: 0.6945, y1: 0.3745 },
  { page: 1, ordinal: 90, text: "2", x0: 0.7805, y0: 0.3635, x1: 0.7888, y1: 0.3765 },
  { page: 1, ordinal: 91, text: "800,000", x0: 0.7972, y0: 0.3635, x1: 0.8555, y1: 0.3765 },
  { page: 1, ordinal: 92, text: "220,000", x0: 0.6325, y0: 0.4195, x1: 0.6955, y1: 0.4325 },
  { page: 1, ordinal: 93, text: "220,000", x0: 0.7925, y0: 0.4215, x1: 0.8555, y1: 0.4345 },
  { page: 1, ordinal: 94, text: "Total", x0: 0.4285, y0: 0.473, x1: 0.4729, y1: 0.485 },
  { page: 1, ordinal: 95, text: "HT", x0: 0.4818, y0: 0.473, x1: 0.4995, y1: 0.485 },
  { page: 1, ordinal: 96, text: "TVA", x0: 0.4315, y0: 0.5, x1: 0.4556, y1: 0.518 },
  { page: 1, ordinal: 97, text: "19", x0: 0.4637, y0: 0.5, x1: 0.4797, y1: 0.518 },
  { page: 1, ordinal: 98, text: "%", x0: 0.4878, y0: 0.5, x1: 0.4958, y1: 0.518 },
  { page: 1, ordinal: 99, text: "(base", x0: 0.5039, y0: 0.5, x1: 0.5441, y1: 0.518 },
  { page: 1, ordinal: 100, text: "3", x0: 0.5521, y0: 0.5, x1: 0.5601, y1: 0.518 },
  { page: 1, ordinal: 101, text: "020,000)", x0: 0.5682, y0: 0.5, x1: 0.6325, y1: 0.518 },
  { page: 1, ordinal: 102, text: "Droit", x0: 0.4255, y0: 0.5295, x1: 0.4658, y1: 0.5425 },
  { page: 1, ordinal: 103, text: "de", x0: 0.4739, y0: 0.5295, x1: 0.49, y1: 0.5425 },
  { page: 1, ordinal: 104, text: "timbre", x0: 0.4981, y0: 0.5295, x1: 0.5465, y1: 0.5425 },
  { page: 1, ordinal: 105, text: "Total", x0: 0.4275, y0: 0.5595, x1: 0.4769, y1: 0.5725 },
  { page: 1, ordinal: 106, text: "TTC", x0: 0.4868, y0: 0.5595, x1: 0.5165, y1: 0.5725 },
  { page: 1, ordinal: 107, text: "3", x0: 0.7525, y0: 0.4755, x1: 0.7611, y1: 0.4885 },
  { page: 1, ordinal: 108, text: "020,000", x0: 0.7697, y0: 0.4755, x1: 0.8298, y1: 0.4885 },
  { page: 1, ordinal: 109, text: "DT", x0: 0.8383, y0: 0.4755, x1: 0.8555, y1: 0.4885 },
  { page: 1, ordinal: 110, text: "573,800", x0: 0.7665, y0: 0.5055, x1: 0.8302, y1: 0.5185 },
  { page: 1, ordinal: 111, text: "DT", x0: 0.8393, y0: 0.5055, x1: 0.8575, y1: 0.5185 },
  { page: 1, ordinal: 112, text: "1,000", x0: 0.7835, y0: 0.5355, x1: 0.8291, y1: 0.5485 },
  { page: 1, ordinal: 113, text: "DT", x0: 0.8383, y0: 0.5355, x1: 0.8565, y1: 0.5485 },
  { page: 1, ordinal: 114, text: "3", x0: 0.7545, y0: 0.5635, x1: 0.7631, y1: 0.5765 },
  { page: 1, ordinal: 115, text: "594,800", x0: 0.7717, y0: 0.5635, x1: 0.8318, y1: 0.5765 },
  { page: 1, ordinal: 116, text: "DT", x0: 0.8403, y0: 0.5635, x1: 0.8575, y1: 0.5765 },
  { page: 1, ordinal: 117, text: "Arrêtée", x0: 0.1205, y0: 0.5935, x1: 0.1718, y1: 0.6105 },
  { page: 1, ordinal: 118, text: "la", x0: 0.1791, y0: 0.5935, x1: 0.1937, y1: 0.6105 },
  { page: 1, ordinal: 119, text: "présente", x0: 0.2011, y0: 0.5935, x1: 0.2596, y1: 0.6105 },
  { page: 1, ordinal: 120, text: "facture", x0: 0.267, y0: 0.5935, x1: 0.3182, y1: 0.6105 },
  { page: 1, ordinal: 121, text: "à", x0: 0.3256, y0: 0.5935, x1: 0.3329, y1: 0.6105 },
  { page: 1, ordinal: 122, text: "la", x0: 0.3402, y0: 0.5935, x1: 0.3549, y1: 0.6105 },
  { page: 1, ordinal: 123, text: "somme", x0: 0.3622, y0: 0.5935, x1: 0.3988, y1: 0.6105 },
  { page: 1, ordinal: 124, text: "de", x0: 0.4061, y0: 0.5935, x1: 0.4208, y1: 0.6105 },
  { page: 1, ordinal: 125, text: ":", x0: 0.4281, y0: 0.5935, x1: 0.4354, y1: 0.6105 },
  { page: 1, ordinal: 126, text: "Trois", x0: 0.4427, y0: 0.5935, x1: 0.4794, y1: 0.6105 },
  { page: 1, ordinal: 127, text: "mille", x0: 0.4867, y0: 0.5935, x1: 0.5233, y1: 0.6105 },
  { page: 1, ordinal: 128, text: "cinq", x0: 0.5306, y0: 0.5935, x1: 0.5599, y1: 0.6105 },
  { page: 1, ordinal: 129, text: "cent", x0: 0.5672, y0: 0.5935, x1: 0.5965, y1: 0.6105 },
  {
    page: 1,
    ordinal: 130,
    text: "quatre-vingt-quatorze",
    x0: 0.6039,
    y0: 0.5935,
    x1: 0.7576,
    y1: 0.6105,
  },
  { page: 1, ordinal: 131, text: "dinars", x0: 0.765, y0: 0.5935, x1: 0.8089, y1: 0.6105 },
  { page: 1, ordinal: 132, text: "et", x0: 0.8162, y0: 0.5935, x1: 0.8309, y1: 0.6105 },
  { page: 1, ordinal: 133, text: "huit", x0: 0.8382, y0: 0.5935, x1: 0.8675, y1: 0.6105 },
  { page: 1, ordinal: 134, text: "cents", x0: 0.1175, y0: 0.61, x1: 0.1578, y1: 0.624 },
  { page: 1, ordinal: 135, text: "millimes.", x0: 0.1659, y0: 0.61, x1: 0.2385, y1: 0.624 },
  { page: 1, ordinal: 136, text: "Retenue", x0: 0.1155, y0: 0.6425, x1: 0.1657, y1: 0.6575 },
  { page: 1, ordinal: 137, text: "à", x0: 0.1729, y0: 0.6425, x1: 0.1801, y1: 0.6575 },
  { page: 1, ordinal: 138, text: "la", x0: 0.1873, y0: 0.6425, x1: 0.2016, y1: 0.6575 },
  { page: 1, ordinal: 139, text: "source", x0: 0.2088, y0: 0.6425, x1: 0.2518, y1: 0.6575 },
  { page: 1, ordinal: 140, text: "sur", x0: 0.259, y0: 0.6425, x1: 0.2805, y1: 0.6575 },
  { page: 1, ordinal: 141, text: "loyers", x0: 0.2877, y0: 0.6425, x1: 0.3308, y1: 0.6575 },
  { page: 1, ordinal: 142, text: "à", x0: 0.3379, y0: 0.6425, x1: 0.3451, y1: 0.6575 },
  { page: 1, ordinal: 143, text: "opérer", x0: 0.3523, y0: 0.6425, x1: 0.3953, y1: 0.6575 },
  { page: 1, ordinal: 144, text: "par", x0: 0.4025, y0: 0.6425, x1: 0.424, y1: 0.6575 },
  { page: 1, ordinal: 145, text: "le", x0: 0.4312, y0: 0.6425, x1: 0.4456, y1: 0.6575 },
  { page: 1, ordinal: 146, text: "locataire.", x0: 0.4527, y0: 0.6425, x1: 0.5245, y1: 0.6575 },
  { page: 1, ordinal: 147, text: "Règlement", x0: 0.119, y0: 0.6735, x1: 0.1895, y1: 0.6905 },
  { page: 1, ordinal: 148, text: "par", x0: 0.1973, y0: 0.6735, x1: 0.2208, y1: 0.6905 },
  { page: 1, ordinal: 149, text: "virement", x0: 0.2287, y0: 0.6735, x1: 0.2913, y1: 0.6905 },
  { page: 1, ordinal: 150, text: "—", x0: 0.2992, y0: 0.6735, x1: 0.307, y1: 0.6905 },
  { page: 1, ordinal: 151, text: "RIB", x0: 0.3148, y0: 0.6735, x1: 0.3383, y1: 0.6905 },
  { page: 1, ordinal: 152, text: ":", x0: 0.3462, y0: 0.6735, x1: 0.354, y1: 0.6905 },
  { page: 1, ordinal: 153, text: "04", x0: 0.3618, y0: 0.6735, x1: 0.3775, y1: 0.6905 },
  { page: 1, ordinal: 154, text: "012", x0: 0.3853, y0: 0.6735, x1: 0.4088, y1: 0.6905 },
  { page: 1, ordinal: 155, text: "0098765432101", x0: 0.4167, y0: 0.6735, x1: 0.5185, y1: 0.6905 },
  { page: 1, ordinal: 156, text: "77", x0: 0.5263, y0: 0.6735, x1: 0.542, y1: 0.6905 },
  { page: 1, ordinal: 157, text: "(Banque", x0: 0.5498, y0: 0.6735, x1: 0.6047, y1: 0.6905 },
  { page: 1, ordinal: 158, text: "Méridienne", x0: 0.6125, y0: 0.6735, x1: 0.6908, y1: 0.6905 },
  { page: 1, ordinal: 159, text: "(fictive))", x0: 0.6987, y0: 0.6735, x1: 0.777, y1: 0.6905 },
  { page: 1, ordinal: 160, text: "Signature", x0: 0.5585, y0: 0.7155, x1: 0.6295, y1: 0.7285 },
  { page: 1, ordinal: 161, text: "Mine", x0: 0.5925, y0: 0.7355, x1: 0.6259, y1: 0.7485 },
  { page: 1, ordinal: 162, text: "Leila", x0: 0.6343, y0: 0.7355, x1: 0.676, y1: 0.7485 },
  { page: 1, ordinal: 163, text: "BEN", x0: 0.6844, y0: 0.7355, x1: 0.7094, y1: 0.7485 },
  { page: 1, ordinal: 164, text: "SALEM", x0: 0.7178, y0: 0.7355, x1: 0.7595, y1: 0.7485 },
  { page: 1, ordinal: 165, text: "8,", x0: 0.6215, y0: 0.75, x1: 0.6334, y1: 0.758 },
  { page: 1, ordinal: 166, text: "Rue", x0: 0.6393, y0: 0.75, x1: 0.6572, y1: 0.758 },
  { page: 1, ordinal: 167, text: "Ibn", x0: 0.6631, y0: 0.75, x1: 0.681, y1: 0.758 },
  { page: 1, ordinal: 168, text: "Khaldoun", x0: 0.6869, y0: 0.75, x1: 0.7345, y1: 0.758 },
  { page: 1, ordinal: 169, text: "MF", x0: 0.6215, y0: 0.76, x1: 0.6323, y1: 0.768 },
  { page: 1, ordinal: 170, text: ":", x0: 0.6376, y0: 0.76, x1: 0.643, y1: 0.768 },
  { page: 1, ordinal: 171, text: "1456987L/A/P/000", x0: 0.6484, y0: 0.76, x1: 0.7345, y1: 0.768 },
  { page: 1, ordinal: 172, text: "Tél", x0: 0.6305, y0: 0.77, x1: 0.6476, y1: 0.778 },
  { page: 1, ordinal: 173, text: ":", x0: 0.6533, y0: 0.77, x1: 0.6589, y1: 0.778 },
  { page: 1, ordinal: 174, text: "98", x0: 0.6646, y0: 0.77, x1: 0.676, y1: 0.778 },
  { page: 1, ordinal: 175, text: "456", x0: 0.6817, y0: 0.77, x1: 0.6988, y1: 0.778 },
  { page: 1, ordinal: 176, text: "123", x0: 0.7044, y0: 0.77, x1: 0.7215, y1: 0.778 },
];

/**
 * Facture de loyer de bureaux, septembre 2026 — la pièce qui a tout révélé.
 *
 * Elle est exemplaire par accident : elle porte quatre montants dont DEUX sont
 * coupés par l'espace des milliers et deux non, une date en toutes lettres, et
 * un droit de timbre. Les quatre défauts de lecture du 5 octobre tiennent dans
 * cette seule page.
 *
 * Son arithmétique boucle au millime, et c'est ce qui en fait une preuve :
 *
 *   2 800,000 + 220,000           = 3 020,000  HT
 *   3 020,000 × 19 %              =   573,800  TVA
 *   3 020,000 + 573,800 + 1,000   = 3 594,800  TTC
 *
 * La dernière ligne est celle qui a corrigé le produit : l'équation du dépôt
 * était « TTC = HT + TVA », sans les droits hors TVA. Sur cette facture elle
 * tombe à 3 593,800 — faux d'exactement le dinar de timbre. Une facture
 * tunisienne parfaitement valide violait donc une contrainte du solveur, et
 * c'est ce qu'on aurait pris pour une anomalie de la pièce.
 */
const LOYER_SEPTEMBRE_2026: CasDOr = {
  nom: "loyer de bureaux, septembre 2026",
  provenance:
    "essai réel du 4 octobre 2026 · pièce 73ae6059-7a81-459e-9795-f6fa21e5dd89 sur le staging · " +
    "plan de jetons relevé tel quel dans capture.token_plan, 177 jetons",
  decimales: 3,
  tokens: JETONS_LOYER,
  designation: {
    document_kind: "facture_achat",
    currency: "TND",
    // « Mme Leila BEN SALEM » : quatre jetons, un seul champ.
    issuer: ref(0, 3),
    // « 1 septembre 2026 » : trois jetons. L'ancienne consigne interdisait la
    // plage sur une date, et `normalizeDate` ne connaissait aucun mois en
    // lettres. Deux verrous indépendants sur le même champ.
    document_date: ref(45, 47),
    references: {
      numero: ref(55),
      matricule_fiscal: ref(17),
      matricule_fiscal_client: ref(42),
    },
    lines: [
      {
        label: "TVA 19%",
        tax_code: "TVA19",
        base_ht: ref(107, 108),
        vat_amount: ref(110),
        // La pièce ne porte qu'un TTC, global : aucun TTC par taux.
        ttc: null,
      },
    ],
    articles: [
      {
        designation: ref(65, 79),
        quantity: ref(86),
        // « 2 800,000 » : DEUX jetons. C'est ici que le produit lisait 2,000.
        unit_price_ht: ref(88, 89),
        unit_price_ttc: null,
        total_ht: ref(90, 91),
        tax_code: "TVA19",
      },
      {
        designation: ref(80, 85),
        quantity: ref(87),
        // « 220,000 » : un seul jeton, et il était déjà lu juste. Le cas doit
        // le prouver aussi : une correction qui casserait les montants courts
        // pour sauver les longs ne serait pas une correction.
        unit_price_ht: ref(92),
        unit_price_ttc: null,
        total_ht: ref(93),
        tax_code: "TVA19",
      },
    ],
    other_charges: [{ code: "DROIT_TIMBRE", amount: ref(112) }],
    totals: {
      // « 3 020,000 » et « 3 594,800 » : deux jetons chacun.
      base_ht: ref(107, 108),
      vat: ref(110),
      ttc: ref(114, 115),
    },
    overall_confidence: 0.82,
  } as unknown as VisionSelection,
  imprime: {
    "articles[0].designation":
      "Loyer mensuel local à usage de bureaux - Immeuble Le Prestige, 3e étage (Sept. 2026)",
    "articles[0].unit_price_ht": "2 800,000",
    "articles[0].total_ht": "2 800,000",
    "articles[1].total_ht": "220,000",
    "totals.base_ht": "3 020,000",
    "totals.vat": "573,800",
    "other_charges[0].amount": "1,000 (droit de timbre)",
    "totals.ttc": "3 594,800",
    document_date: "Tunis, le 1 septembre 2026",
  },
  attendu: {
    /*
     * Le SENS, en tête des attentes — et il y manquait.
     *
     * Le 5 octobre 2026, l'épreuve de coût a montré `deepseek-chat` rendre
     * « facture_vente » sur cette facture d'achat. L'instrument comptait zéro
     * valeur fausse, parce que `document_kind` n'était pas dans cette liste.
     *
     * C'est pourtant la plus grave des erreurs possibles : aucune arithmétique
     * ne la rattrape — le sens n'est pas un montant — et la pièce part dans le
     * mauvais journal, en vente au lieu d'achat. Les matricules s'inversent avec
     * elle, si bien que le contrôle du destinataire trouve tout cohérent.
     */
    document_kind: "facture_achat",
    issuer: "Mme Leila BEN SALEM",
    document_date: "2026-09-01",
    "articles[0].quantity": "1.000",
    "articles[0].unit_price_ht": "2800.000",
    "articles[0].total_ht": "2800.000",
    "articles[1].unit_price_ht": "220.000",
    "articles[1].total_ht": "220.000",
    "lines[0].base_ht": "3020.000",
    "lines[0].vat_amount": "573.800",
    "other_charges[0].amount": "1.000",
    "totals.base_ht": "3020.000",
    "totals.vat": "573.800",
    "totals.ttc": "3594.800",
  },
};

/**
 * Le jeu d'or. Une pièce aujourd'hui ; la cible est cinquante, validées par un
 * expert-comptable. Chaque pièce ajoutée y reste : une correction sans son cas
 * au banc se réintroduit à la première refonte, et c'est déjà arrivé.
 */
export const JEU_D_OR: CasDOr[] = [LOYER_SEPTEMBRE_2026];
