/**
 * Le cours de change d'une pièce en devise : la règle du pack, puis le cours
 * qu'elle désigne (31 octobre 2026).
 *
 * ================================================================= POURQUOI
 *
 * Une facture en euros d'un dossier tenu en dinars ne se proposait plus, faute
 * de cours (#142). Le cours est une DONNÉE (`parametrage.cours_de_change`,
 * importée par l'exploitation ou saisie par le cabinet), et la règle qui dit
 * lequel prendre vit au paramétrage daté du pack (`ref.socle_params`,
 * `change.*`) :
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

/** Les dates de la pièce dont le Socle sait prendre le cours (`change.date_retenue`). */
export const DATES_RETENUES = ["date_facture", "date_reception"] as const;
type DateRetenue = (typeof DATES_RETENUES)[number];

/** La règle de change du pack, en vigueur à la date de la pièce. */
export interface RegleDeChange {
  source: string;
  dateRetenue: DateRetenue;
  recul: number;
  ecart: string;
}

/** Un cours trouvé : `unite` unités de la devise valent `taux` de la devise du dossier. */
export interface CoursLu {
  id: string;
  date: string;
  taux: string;
  unite: number;
  source: string;
  /** Saisi par le cabinet qui supervise le dossier (ou par le dossier), sinon importé. */
  duCabinet: boolean;
}

/**
 * Ce que le jugement sait du change : la règle (nulle si le pack n'en porte
 * pas), le jour dont le cours se lit (nul si la date retenue manque), et le
 * cours applicable de chaque devise du référentiel autre que celle du
 * dossier (nul : aucun cours).
 */
export interface ChangeDuJugement {
  regle: RegleDeChange | null;
  jour: string | null;
  cours: ReadonlyMap<string, CoursLu | null>;
}

const CODES = ["change.source", "change.date_retenue", "change.recul_jours", "change.ecart"];

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
 * La règle de change du pack, au jour donné. Nulle si le pack n'en porte
 * aucune ; une règle incomplète ou inconnue du Socle est une erreur du
 * référentiel, et elle se dit (R4 : aucun repli).
 */
export async function lireLaRegleDeChange(
  db: Requete,
  pack: string,
  jour: string,
): Promise<RegleDeChange | null> {
  const { rows } = await db.query<{
    code: string;
    value_text: string | null;
    value_num: string | null;
    source_connue: boolean;
  }>(
    `select distinct on (p.code) p.code, p.value_text, p.value_num::text as value_num,
            exists (select 1 from ref.sources_de_cours s where s.code = p.value_text) as source_connue
       from ref.socle_params p
      where p.pack_version_id = $1 and p.code = any($2) and p.valid_from <= $3::date
        and (p.valid_to is null or p.valid_to >= $3::date)
      order by p.code, p.valid_from desc`,
    [pack, CODES, jour],
  );
  if (rows.length === 0) return null;
  const lu = new Map(rows.map((r) => [r.code, r]));
  const manquant = CODES.find((c) => !lu.has(c));
  if (manquant) throw refus(`Règle de change incomplète au référentiel : « ${manquant} » manque.`);
  const source = lu.get("change.source")!;
  const date = lu.get("change.date_retenue")!.value_text;
  const recul = Number(lu.get("change.recul_jours")!.value_num);
  const ecart = lu.get("change.ecart")!.value_text;
  if (!source.value_text || !source.source_connue)
    throw refus(`Source de cours inconnue du référentiel : « ${source.value_text ?? ""} ».`);
  if (!DATES_RETENUES.includes(date as DateRetenue))
    throw refus(`Date de cours inconnue du Socle : « ${date ?? ""} ».`);
  if (!Number.isInteger(recul) || recul < 0)
    throw refus(`Recul de cours invalide au référentiel : « ${String(recul)} ».`);
  if (!(REGLES_D_ECART as readonly (string | null)[]).includes(ecart))
    throw refus(`Règle d'écart de conversion inconnue du Socle : « ${ecart ?? ""} ».`);
  return { source: source.value_text, dateRetenue: date as DateRetenue, recul, ecart: ecart! };
}

/**
 * Ce que le jugement d'une pièce du dossier sait du change : la règle, le
 * jour, et le cours applicable de chaque devise autre que celle du dossier
 * (`app.cours_applicable`, une requête).
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
  const regle = await lireLaRegleDeChange(db, p.pack, p.jourDuParametrage);
  const jour = regle ? jourDuCours(regle, p.datePiece, p.recueLe) : null;
  if (!regle || !jour) return { regle, jour, cours: new Map() };
  const { rows } = await db.query<{
    devise: string;
    id: string | null;
    date_du_cours: string | null;
    taux: string | null;
    unite: number | null;
    source: string | null;
    du_cabinet: boolean | null;
  }>(
    `select d.code as devise, c.id, to_char(c.date_du_cours, 'YYYY-MM-DD') as date_du_cours,
            c.taux::text as taux, c.unite, c.source, c.du_cabinet
       from ref.devises d
       left join lateral app.cours_applicable($1, d.code, $2, $3::date, $4, $5) c on true
      where d.code <> $2
      order by d.code collate "C"`,
    [p.dossier, p.deviseDuDossier, jour, regle.source, regle.recul],
  );
  return {
    regle,
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
              duCabinet: r.du_cabinet === true,
            },
      ]),
    ),
  };
}
