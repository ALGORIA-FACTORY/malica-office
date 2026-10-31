/**
 * Le cours de change d'une pièce en devise : la règle, puis le cours qu'elle
 * désigne (31 octobre 2026 ; revue de #148).
 *
 * ================================================================= POURQUOI
 *
 * Une facture en euros d'un dossier tenu en dinars ne se proposait plus, faute
 * de cours (#142). Le cours est une DONNÉE (`parametrage.cours_de_change`,
 * importée par l'exploitation ou saisie par le cabinet), et la règle qui dit
 * lequel prendre se RÉSOUT comme tout paramétrage (R10) : ce que le cabinet a
 * arrêté pour le dossier, puis pour le cabinet, puis le défaut du pack
 * (`app.regle_de_change`) :
 *
 *   change.source        la source dont le cours fait foi (`ref.sources_de_cours`) ;
 *   change.date_retenue  la date de la pièce dont on prend le cours ;
 *   change.recul_jours   combien de jours on remonte au dernier cours publié ;
 *   change.ecart         où va l'écart d'arrondi (`convertirLExtrait`).
 *
 * INCERTAIN — à confirmer par un expert-comptable : la date retenue et le
 * recul. Ce sont des défauts livrés (R10), dits comme tels au référentiel.
 *
 * Le choix du cours parmi ceux qui existent est UNE règle, en base
 * (`app.cours_applicable`) : la même pour le jugement et pour la péremption
 * d'un jugement (`app.cours_du_jugement_a_jour`). Rien ici ne la refait.
 */
import { REGLES_D_ECART } from "@malica/socle/engines/fx/convertir-l-extrait";

import type { Requete } from "../db.ts";

/**
 * Les dates de la pièce dont le Socle sait prendre le cours : chacune a son
 * implémentation (`jourDuCours`). `ref.change_dates_retenues` les porte, et
 * une épreuve les confronte.
 */
export const DATES_RETENUES = ["date_facture", "date_reception"] as const;
type DateRetenue = (typeof DATES_RETENUES)[number];

/** La règle de change résolue pour le dossier, à la date de la pièce. */
export interface RegleDeChange {
  source: string;
  dateRetenue: DateRetenue;
  recul: number;
  ecart: string;
}

/** Les quatre codes d'une règle, tels qu'`app.regle_de_change` les rend. */
const CODES = ["change.source", "change.date_retenue", "change.recul_jours", "change.ecart"];
/** La règle telle que la base la résout : code → valeur (la question d'un jugement). */
type RegleBrute = Record<string, string | null>;

/** Un cours trouvé : `unite` unités de la devise valent `taux` de la devise du dossier. */
export interface CoursLu {
  id: string;
  date: string;
  taux: string;
  unite: number;
  source: string;
  /** Son origine (`ref.rangs_des_cours`) : import, saisie, dérogation du cabinet ou du dossier. */
  origine: string;
  /** Le motif d'une dérogation ou d'une correction ; nul sinon. */
  motif: string | null;
}

/**
 * Ce que le jugement sait du change : la règle (nulle si le référentiel n'en
 * porte pas) et ce qui a permis de la résoudre (le pack, le jour du
 * paramétrage, la règle brute), le jour dont le cours se lit (nul si la date
 * retenue manque), et le cours applicable de chaque devise du référentiel
 * autre que celle du dossier (nul : aucun cours).
 */
export interface ChangeDuJugement {
  regle: RegleDeChange | null;
  pack: string | null;
  jourDuParametrage: string | null;
  regleBrute: RegleBrute | null;
  jour: string | null;
  cours: ReadonlyMap<string, CoursLu | null>;
}

const refus = (message: string) => Object.assign(new Error(message), { code: "22023" });

/** Le jour dont le cours se lit, selon la règle : la date de la facture, ou de sa réception. */
export function jourDuCours(
  regle: RegleDeChange,
  datePiece: string | null,
  recueLe: string,
): string | null {
  return regle.dateRetenue === "date_facture" ? datePiece : recueLe;
}

/**
 * La règle, depuis ses quatre valeurs. Nulle si aucune n'existe ; une règle
 * incomplète, ou qu'un code que le Socle n'implémente pas, est une erreur du
 * référentiel, et elle se dit (R4 : aucun repli). Pure.
 */
function regleDepuis(brute: RegleBrute): RegleDeChange | null {
  if (Object.keys(brute).length === 0) return null;
  const manquant = CODES.find((c) => brute[c] === null || brute[c] === undefined);
  if (manquant) throw refus(`Règle de change incomplète au référentiel : « ${manquant} » manque.`);
  const date = brute["change.date_retenue"]!;
  const recul = Number(brute["change.recul_jours"]);
  const ecart = brute["change.ecart"]!;
  if (!(DATES_RETENUES as readonly string[]).includes(date))
    throw refus(`Date de cours inconnue du Socle : « ${date} ».`);
  if (!Number.isInteger(recul) || recul < 0)
    throw refus(`Recul de cours invalide au référentiel : « ${brute["change.recul_jours"]} ».`);
  if (!(REGLES_D_ECART as readonly string[]).includes(ecart))
    throw refus(`Règle d'écart de conversion inconnue du Socle : « ${ecart} ».`);
  return {
    source: brute["change.source"]!,
    dateRetenue: date as DateRetenue,
    recul,
    ecart,
  };
}

/**
 * La règle de change d'un dossier, résolue au jour du paramétrage : le
 * dossier, puis son cabinet, puis le pack (`app.regle_de_change`).
 */
async function lireLaRegleDeChange(
  db: Requete,
  dossier: string,
  pack: string,
  jour: string,
): Promise<{ regle: RegleDeChange | null; brute: RegleBrute }> {
  const { rows } = await db.query<{ code: string; valeur: string | null }>(
    `select code, valeur from app.regle_de_change($1, $2, $3::date)`,
    [dossier, pack, jour],
  );
  const brute: RegleBrute = Object.fromEntries(rows.map((r) => [r.code, r.valeur]));
  return { regle: regleDepuis(brute), brute };
}

/**
 * Le défaut du PACK seul, au jour donné — ce que relève l'instantané des
 * épreuves pures (`releve-du-referentiel.ts`), sans dossier.
 */
export async function lireLaRegleDuPack(
  db: Requete,
  pack: string,
  jour: string,
): Promise<RegleDeChange | null> {
  const { rows } = await db.query<{ code: string; valeur: string | null }>(
    `select distinct on (code) code, coalesce(value_text, value_num::integer::text) as valeur
       from ref.socle_params
      where pack_version_id = $1 and code like 'change.%' and valid_from <= $2::date
        and (valid_to is null or valid_to >= $2::date)
      order by code, valid_from desc`,
    [pack, jour],
  );
  return regleDepuis(Object.fromEntries(rows.map((r) => [r.code, r.valeur])));
}

/**
 * Ce que le jugement d'une pièce EN DEVISE sait du change : la règle du
 * dossier, le jour, et le cours applicable de chaque devise autre que celle
 * du dossier (`app.cours_applicable`, une requête). Une pièce dans la devise
 * du dossier ne le lit jamais (revue de #148) : une règle incomplète ne
 * l'arrête pas.
 */
export async function lireLeChange(
  db: Requete,
  p: {
    dossier: string;
    deviseDuDossier: string;
    pack: string;
    /** Le jour du paramétrage : la date de la pièce, à défaut sa réception. */
    jourDuParametrage: string;
    datePiece: string | null;
    recueLe: string;
  },
): Promise<ChangeDuJugement> {
  const { regle, brute } = await lireLaRegleDeChange(db, p.dossier, p.pack, p.jourDuParametrage);
  const base = { regle, pack: p.pack, jourDuParametrage: p.jourDuParametrage, regleBrute: brute };
  const jour = regle ? jourDuCours(regle, p.datePiece, p.recueLe) : null;
  if (!regle || !jour) return { ...base, jour, cours: new Map() };
  const { rows } = await db.query<{
    devise: string;
    id: string | null;
    date_du_cours: string | null;
    taux: string | null;
    unite: number | null;
    source: string | null;
    origine: string | null;
    motif: string | null;
  }>(
    `select d.code as devise, c.id, to_char(c.date_du_cours, 'YYYY-MM-DD') as date_du_cours,
            c.taux::text as taux, c.unite, c.source, c.origine, c.motif
       from ref.devises d
       left join lateral app.cours_applicable($1, d.code, $2, $3::date, $4, $5) c on true
      where d.code <> $2
      order by d.code collate "C"`,
    [p.dossier, p.deviseDuDossier, jour, regle.source, regle.recul],
  );
  return {
    ...base,
    jour,
    cours: new Map(
      rows.map((r) => [
        r.devise,
        r.id === null
          ? null
          : {
              id: r.id,
              date: r.date_du_cours!,
              taux: r.taux!,
              unite: Number(r.unite),
              source: r.source!,
              origine: r.origine!,
              motif: r.motif,
            },
      ]),
    ),
  };
}
