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
 *
 * Le tirage est injectable : le jeu synthétique (`outils/jeu-synthetique/`)
 * doit rendre les MÊMES matricules à chaque génération, donc il passe son
 * générateur graine. Une seule forme de matricule fictif dans le dépôt.
 */
import { randomInt } from "node:crypto";

/** Un entier dans [min, max[ — la signature de `crypto.randomInt`. */
type Tirage = (min: number, max: number) => number;

let compteur = 0;

export function matriculeDEssai(tva = "A", categorie = "M", tirer: Tirage = randomInt): string {
  compteur = (compteur + 1) % 1000;
  const chiffres = String(tirer(1_000, 9_999)).padStart(4, "0") + String(compteur).padStart(3, "0");
  const lettre = String.fromCharCode(65 + tirer(0, 26));
  return `${chiffres}${lettre}/${tva}/${categorie}/000`;
}
