/**
 * Un matricule fiscal d'essai, propre à chaque appel.
 *
 * Depuis le 20 octobre 2026, un matricule n'appartient qu'à UNE organisation
 * active de sa juridiction (`identity.un_matricule_une_societe`). Les épreuves
 * tournent en parallèle et semaient toutes « 1876543W/A/M/000 » : la seconde
 * à créer son organisation était refusée — à juste titre.
 *
 * Une épreuve qui ne JUGE pas le matricule en prend donc un à elle. La forme
 * reste celle du référentiel tunisien (sept chiffres, lettre de contrôle,
 * code de TVA, catégorie, établissement), pour que la création l'accepte.
 */
import { randomInt } from "node:crypto";

let compteur = 0;

export function matriculeDEssai(tva = "A", categorie = "M"): string {
  compteur = (compteur + 1) % 1000;
  const chiffres =
    String(randomInt(1_000, 9_999)).padStart(4, "0") + String(compteur).padStart(3, "0");
  const lettre = String.fromCharCode(65 + randomInt(0, 26));
  return `${chiffres}${lettre}/${tva}/${categorie}/000`;
}
