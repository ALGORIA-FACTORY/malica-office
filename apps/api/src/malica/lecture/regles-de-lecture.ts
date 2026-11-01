/**
 * Les règles de lecture d'un pack : comment ses pièces écrivent une date, un
 * matricule et un montant en lettres.
 *
 * ================================================================= POURQUOI
 *
 * Ces règles étaient écrites dans le code de lecture : les noms de mois et
 * l'ordre jour/mois/année dans `normalizeDate`, la forme du matricule fiscal
 * tunisien et ses étiquettes dans `matricule.ts`. Elles vivent désormais en
 * base, datées par pack (migration `20261116090000`), et ce module est leur
 * seul lecteur : la chaîne, le jugement et le sudoku les reçoivent de lui.
 *
 * Rien n'a de valeur par défaut (R4, corollaire) : une règle absente lève, et
 * la pièce garde ce que le chemin éprouvé sait faire — elle ne se lit pas
 * « tunisien » par repli.
 */
import type { FormatDuMatricule } from "@malica/socle/matricule";
import type {
  LexiqueDesLettres,
  NatureDuMot,
  UniteEnLettres,
} from "@malica/socle/montant-en-lettres";

import type { Requete } from "../../db.ts";

import type { ConventionDeDate } from "./token-plan.ts";

export interface ReglesDeLecture {
  readonly dates: ConventionDeDate;
  /** La forme de lecture du matricule fiscal, et la règle de sa lettre de contrôle. */
  readonly matricule: FormatDuMatricule;
  /** Le code de son format (`ref.identifiant_formats.kind`), tel que les grilles le nomment. */
  readonly codeDuMatricule: string;
  readonly lettres: LexiqueDesLettres;
}

/** Le format d'identifiant dont la forme de lecture est celle du matricule fiscal. */
const MATRICULE = "matricule_fiscal";

const EN_VIGUEUR = `valid_from <= $2::date and (valid_to is null or valid_to >= $2::date)`;

/** Les règles de lecture du pack, au jour dit (`AAAA-MM-JJ`). */
export async function lireLesReglesDeLecture(
  db: Requete,
  packId: string,
  jour: string,
): Promise<ReglesDeLecture> {
  const [conventions, mois, formats, controles, mots, unites] = await Promise.all([
    db.query<{
      ordre: ConventionDeDate["ordre"];
      siecle: number | null;
      lettres: boolean;
      suffixes: string[];
    }>(
      `select ordre, siecle_des_annees_courtes as siecle, annees_courtes_en_lettres as lettres,
              suffixes_ordinaux as suffixes
         from ref.conventions_de_date
        where pack_version_id = $1 and ${EN_VIGUEUR}
        order by valid_from desc limit 1`,
      [packId, jour],
    ),
    db.query<{ nom: string; mois: number }>(
      `select nom, mois from ref.mois_en_lettres
        where pack_version_id = $1 and ${EN_VIGUEUR} order by nom collate "C"`,
      [packId, jour],
    ),
    db.query<{
      noyau: number | null;
      groupes: string[] | null;
      separateur: string | null;
      etiquettes: string[] | null;
    }>(
      `select noyau_chiffres as noyau, groupes, separateur, etiquettes
         from ref.identifiant_formats
        where pack_version_id = $1 and kind = $3 and ${EN_VIGUEUR}
        order by valid_from desc limit 1`,
      [packId, jour, MATRICULE],
    ),
    db.query<{ poids: number[]; modulo: number; alphabet: string; effet: "avertit" | "bloque" }>(
      `select poids, modulo, alphabet, effet from ref.identifiant_controles
        where pack_version_id = $1 and kind = $3 and ${EN_VIGUEUR}
        order by valid_from desc limit 1`,
      [packId, jour, MATRICULE],
    ),
    db.query<{ mot: string; nature: NatureDuMot; valeur: string }>(
      `select mot, nature, valeur::text as valeur from ref.nombres_en_lettres
        where pack_version_id = $1 and ${EN_VIGUEUR} order by langue, mot collate "C"`,
      [packId, jour],
    ),
    db.query<UniteEnLettres>(
      `select mot, devise, unite from ref.devises_en_lettres
        where pack_version_id = $1 and ${EN_VIGUEUR} order by langue, mot collate "C"`,
      [packId, jour],
    ),
  ]);

  const convention = conventions.rows[0];
  if (!convention) throw new Error(`lecture : aucune convention de date au pack (${jour})`);
  const format = formats.rows[0];
  if (!format?.noyau || !format.groupes || !format.separateur || !format.etiquettes) {
    throw new Error(`lecture : aucune forme de lecture du matricule au pack (${jour})`);
  }
  const controle = controles.rows[0];

  return {
    dates: {
      ordre: convention.ordre,
      siecleDesAnneesCourtes: convention.siecle === null ? null : Number(convention.siecle),
      anneesCourtesEnLettres: convention.lettres,
      suffixesOrdinaux: convention.suffixes,
      mois: Object.fromEntries(mois.rows.map((m) => [m.nom, Number(m.mois)])),
    },
    matricule: {
      noyau: Number(format.noyau),
      groupes: format.groupes.map((g) => (g === "lettre" ? "lettre" : Number(g))),
      separateur: format.separateur,
      etiquettes: format.etiquettes,
      controle: controle
        ? {
            poids: controle.poids.map(Number),
            modulo: Number(controle.modulo),
            alphabet: controle.alphabet,
            effet: controle.effet,
          }
        : null,
    },
    codeDuMatricule: MATRICULE,
    lettres: {
      mots: mots.rows.map((m) => ({ mot: m.mot, nature: m.nature, valeur: Number(m.valeur) })),
      unites: unites.rows,
    },
  };
}
