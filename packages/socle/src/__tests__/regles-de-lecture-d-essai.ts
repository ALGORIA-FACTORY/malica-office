/**
 * Les règles de lecture du pack d'essai, telles que la base les porte.
 *
 * Rien n'est recopié à la main : elles viennent de l'instantané relevé en base
 * (`apps/api/src/scan/referentiel-d-essai.json`, par
 * `outils/relever-le-referentiel-d-essai.mjs`), que
 * `le-referentiel-d-essai-dit-vrai.test.ts` rejoue contre le pack. Le Socle les
 * reçoit en paramètre (R1) ; ses épreuves aussi.
 */
import { readFileSync } from "node:fs";

import type { FormatDuMatricule } from "../matricule.ts";
import type { LexiqueDesLettres } from "../montant-en-lettres.ts";

const RELEVE = JSON.parse(
  readFileSync(
    new URL("../../../../apps/api/src/scan/referentiel-d-essai.json", import.meta.url),
    "utf8",
  ),
) as { reglesDeLecture: { matricule: FormatDuMatricule; lettres: LexiqueDesLettres } };

/** La forme de lecture du matricule fiscal du pack d'essai, et sa lettre de contrôle. */
export const FORMAT_D_ESSAI: FormatDuMatricule = RELEVE.reglesDeLecture.matricule;

/** Les mots d'un montant en lettres du pack d'essai. */
export const LEXIQUE_D_ESSAI: LexiqueDesLettres = RELEVE.reglesDeLecture.lettres;
