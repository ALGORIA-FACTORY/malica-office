/**
 * Le droit de timbre d'une pièce, au barème DATÉ (réglage `timbre.bareme`,
 * option `bareme_date`, décidée par le CEO le 31 octobre 2026).
 *
 * ================================================================= LA RÈGLE
 *
 * Le droit attendu se lit à la date de la pièce, selon la catégorie de son
 * émetteur (`ref.categories_de_bareme`) :
 *
 *   - la catégorie au droit standard paie le droit de `ref.fiscal_charges`,
 *     que `referentiel.fiscalCharges` lit déjà à la date de la pièce ;
 *   - une autre catégorie (les grandes surfaces) paie la tranche de
 *     `ref.baremes_des_droits` qui couvre le TTC imprimé — la plus basse quand
 *     deux se touchent (« de 50 à 100 », puis « au-delà de 100 ») — et, hors de
 *     ses tranches, le droit standard.
 *
 * La catégorie de l'émetteur, c'est le cabinet qui la donne, en classant le
 * tiers du dossier (`tiers.auxiliaires.categorie_de_bareme`), reconnu par son
 * matricule fiscal. Un émetteur que personne n'a classé n'est pas deviné : un
 * timbre au droit standard suit la règle générale ; un timbre au tarif d'une
 * autre catégorie passe avec la réserve nommée « catégorie de l'émetteur à
 * préciser » ; un timbre qui n'est le tarif d'aucune catégorie reste bloqué
 * par le moteur (`FISCAL_CHARGE_MISMATCH`), au droit standard.
 *
 * L'option `fixe_1d` garde le droit standard seul : le référentiel tel quel.
 *
 * Aucun montant, aucune catégorie ni aucun code de droit n'est écrit ici (R4) :
 * le barème, ses catégories et le droit qu'il tarife sont au référentiel.
 * INCERTAIN (à confirmer par un expert-comptable) : l'assiette des tranches
 * (le TTC imprimé), et le droit standard sous la première tranche — la
 * migration `20261111090000` les nomme.
 */
import { D } from "@malica/socle/domain/decimal";
import { normaliserMatricule, type FormatDuMatricule } from "@malica/socle/matricule";

import type { Requete } from "../db.ts";

import type { ReglagesResolus } from "./reglages-comptables.ts";

/** Le réglage que ce module applique, et ses deux options. */
const REGLAGE = "timbre.bareme";
const OPTIONS = ["bareme_date", "fixe_1d"] as const;
type OptionDuTimbre = (typeof OPTIONS)[number];

/** Une tranche du barème d'un droit, pour une catégorie d'émetteur, au jour dit. */
interface TrancheDuBareme {
  /** Le droit tarifé (`ref.fiscal_charges.code`). */
  droit: string;
  categorie: string;
  /** Les bornes, dans la devise du pack ; `a` nulle : sans plafond. */
  de: string;
  a: string | null;
  montant: string;
}

/** Le barème au jour de la pièce : la catégorie au droit standard, et les tranches. */
export interface BaremeDesDroits {
  standard: string;
  tranches: readonly TrancheDuBareme[];
}

/** Ce que la proposition sait du timbre d'une pièce sous `bareme_date`. */
export interface TimbreDeLaPiece {
  bareme: BaremeDesDroits;
  /** La catégorie de l'émetteur, donnée par le cabinet ; nulle : non classé. */
  categorie: string | null;
}

/** La réserve que porte un timbre au tarif d'une catégorie que rien ne confirme. */
export interface CategorieAPreciser {
  code: "categorie_d_emetteur";
  /** Le droit imprimé (`ref.fiscal_charges.code`). */
  droit: string;
  /** La catégorie dont le tarif est celui que la pièce imprime. */
  categorie: string;
  /** Le montant imprimé. */
  montant: string;
}

/** L'option du dossier ; nulle quand le pack ne porte pas le réglage. */
export function optionDuTimbre(r: ReglagesResolus): OptionDuTimbre | null {
  const v = r.get(REGLAGE);
  if (v === undefined) return null;
  const option = OPTIONS.find((o) => o === v);
  if (!option) throw new Error("reglage.timbre.illisible");
  return option;
}

/** Le barème des droits au jour dit (`ref.baremes_des_droits`, `ref.categories_de_bareme`). */
export async function lireLeBaremeDesDroits(
  db: Requete,
  pack: string,
  jour: string,
): Promise<BaremeDesDroits> {
  const [{ rows: standards }, { rows: tranches }] = await Promise.all([
    db.query<{ code: string }>(`select code from ref.categories_de_bareme where standard`),
    db.query<TrancheDuBareme>(
      `select b.droit, b.categorie, b.montant_de::text as de, b.montant_a::text as a,
              b.montant_du_droit::text as montant
         from ref.baremes_des_droits b
        where b.pack_version_id = $1 and b.valid_from <= $2::date
          and (b.valid_to is null or b.valid_to >= $2::date)
        order by b.droit, b.categorie, b.montant_de`,
      [pack, jour],
    ),
  ]);
  const standard = standards[0]?.code;
  if (!standard) throw new Error("reglage.timbre.categorie_standard_absente");
  return { standard, tranches };
}

/**
 * La catégorie que le cabinet a donnée à l'émetteur, reconnu par son matricule
 * parmi les tiers du dossier ; nulle quand aucun tiers classé ne le porte, ou
 * quand deux le portent avec deux catégories (rien ne se devine).
 */
export async function categorieDeLEmetteur(
  db: Requete,
  dossier: string,
  matricule: string | null | undefined,
  /** La forme de lecture du matricule du pack (`lireLesReglesDeLecture`). */
  format: FormatDuMatricule,
): Promise<string | null> {
  const cle = normaliserMatricule(matricule, format).cle;
  if (!cle) return null;
  const { rows } = await db.query<{ identifiant_fiscal: string; categorie: string }>(
    `select identifiant_fiscal, categorie_de_bareme as categorie from tiers_v
      where tenant_id = $1 and identifiant_fiscal is not null and categorie_de_bareme is not null`,
    [dossier],
  );
  const categories = new Set(
    rows
      .filter((t) => normaliserMatricule(t.identifiant_fiscal, format).cle === cle)
      .map((t) => t.categorie),
  );
  return categories.size === 1 ? [...categories][0]! : null;
}

/**
 * Les droits du pack, au barème de la pièce : le montant fixe de chaque droit
 * tarifé est celui de la catégorie de l'émetteur, et la réserve est dite quand
 * la catégorie n'est pas connue. Pure. Le moteur du Socle compare ensuite le
 * droit imprimé à ce montant, comme toujours.
 */
export function droitsAuBareme<
  T extends { code: string; documentKind: string; fixedAmount: string | null },
>(p: {
  droits: readonly T[];
  imprimes: ReadonlyArray<{ code: string; amount: string }>;
  sens: string;
  /** Le TTC imprimé, dans la devise du dossier. */
  ttc: string;
  timbre: TimbreDeLaPiece;
}): { droits: T[]; reserves: CategorieAPreciser[] } {
  const { bareme, categorie } = p.timbre;
  const reserves: CategorieAPreciser[] = [];
  const attendus = new Map<string, string>();
  for (const imprime of p.imprimes) {
    const regle = p.droits.find((d) => d.code === imprime.code && d.documentKind === p.sens);
    const tranches = bareme.tranches.filter((t) => t.droit === imprime.code);
    if (!regle?.fixedAmount || tranches.length === 0) continue;
    const standard = regle.fixedAmount;
    const tarif = (c: string) =>
      c === bareme.standard
        ? standard
        : (tranches
            .filter(
              (t) =>
                t.categorie === c &&
                D(p.ttc).gte(D(t.de)) &&
                (t.a === null || D(p.ttc).lte(D(t.a))),
            )
            .sort((x, y) => D(x.de).comparedTo(D(y.de)))[0]?.montant ?? standard);
    if (categorie !== null) {
      attendus.set(imprime.code, tarif(categorie));
      continue;
    }
    // Non classé : la règle générale, sinon le tarif d'une catégorie, en réserve.
    const autre = D(imprime.amount).eq(D(standard))
      ? undefined
      : [...new Set(tranches.map((t) => t.categorie))].find((c) =>
          D(tarif(c)).eq(D(imprime.amount)),
        );
    if (autre) {
      attendus.set(imprime.code, tarif(autre));
      reserves.push({
        code: "categorie_d_emetteur",
        droit: imprime.code,
        categorie: autre,
        montant: imprime.amount,
      });
    }
  }
  return {
    droits: p.droits.map((d) =>
      d.documentKind === p.sens && attendus.has(d.code)
        ? { ...d, fixedAmount: attendus.get(d.code)! }
        : d,
    ),
    reserves,
  };
}
