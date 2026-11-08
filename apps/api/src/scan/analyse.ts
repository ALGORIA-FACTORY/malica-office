/**
 * 3B — Juger une pièce lue, côté serveur.
 *
 * Relit ce que la base porte — la dernière lecture, les jetons cités, le
 * paramétrage daté —, normalise les montants depuis le texte IMPRIMÉ, contrôle,
 * rend le verdict, et le pose dans `capture.analyses` (append-only : le dernier
 * passage fait foi).
 *
 * Tout passe par la connexion de l'appelant : ce que la RLS ne lui montre pas
 * n'existe pas ici, et une pièce d'un autre tenant répond comme une pièce qui
 * n'existe nulle part (D29).
 *
 * ============================================================== LE TEXTE IMPRIMÉ
 *
 * Les montants de l'extraction (« 1234.560 ») sont déjà passés par le solveur
 * de la lecture. La normalisation repart de ce que la pièce IMPRIME : les
 * jetons cités pour chaque champ, réassemblés dans leur ordre de lecture. C'est
 * ce qui règle le piège des montants coupés en deux jetons (« 1 » et
 * « 234,560 ») : ils se réunissent ici, par leurs citations.
 *
 * ============================================================== LA DATE QUI FAIT FOI
 *
 * Taux, seuils et pack se lisent à la date de la PIÈCE — à défaut, à sa date
 * de réception —, jamais à la date du jour.
 */

import { PackUnavailable } from "@malica/socle/juridictions/tn";
import {
  deviseDeLaPiece,
  type DeviseLue,
  type MarqueDeDevise,
} from "@malica/socle/montant-imprime";
import { depuisUniteMineure, enUnitesExactes } from "@malica/socle/somme-decimale";

import type { Requete } from "../db.ts";
import { dateDeLaPiece } from "../depots/dates.ts";

/*
 * Les deux noms des matricules ne sont plus écrits ici : ils viennent de la
 * liste unique que l'invite de désignation impose au modèle. Une clé relue à
 * la main et un renommage ailleurs, et la lecture devenait muette — le sens de
 * la pièce et la détection de doublon tombaient à `null` sans que rien ne le
 * dise. C'est le motif récurrent de ce dépôt, et il se ferme par le lien.
 */
import { REFERENCES_QUI_TRANCHENT_LE_SENS } from "../fabrique/recette.ts";
import { lireLesReglesDeLecture } from "../malica/lecture/regles-de-lecture.ts";
import { texteDuMontantCite, type PageToken } from "../malica/lecture/token-plan.ts";
import { consigner } from "../observabilite/journal.ts";

import {
  controlerPiece,
  rendreVerdict,
  cleDeDoublon,
  type ContexteControle,
  type PieceAControler,
  type ResultatControle,
} from "./controles.ts";
import { lireLeChange, type ChangeDuJugement } from "./cours-de-change.ts";
import { partiesSelonLeSens } from "./parties-selon-le-sens.ts";
import { normaliserMontants, type ResultatNormalisation } from "./normaliser-montants.ts";
import {
  lireLesReglagesComptables,
  reglageDesAvoirs,
  reglageDImmobilisation,
} from "./reglages-comptables.ts";

const [NOM_MATRICULE_EMETTEUR, NOM_MATRICULE_CLIENT] = REFERENCES_QUI_TRANCHENT_LE_SENS;

/** Une règle métier qui refuse : son message va jusqu'à l'appelant. */
const refus = (message: string) => Object.assign(new Error(message), { code: "22023" });

const PARAMETRES = [
  "lecture.confiance_reserve",
  "lecture.confiance_bloquante",
  "lecture.tolerance_arrondi_mineure",
  // Au-dela de cet ecart entre la date de la piece et sa reception, la piece
  // est SIGNALEE. Rien ne distinguait une date confirmee d une date acceptee
  // sans la lire, et une facture de janvier confirmee en mars part dans la
  // declaration de mars.
  "piece.ecart_date_jours",
] as const;

/** La bande du haut de la première page, où s'imprime le titre du document. */
export const HAUT_DE_PAGE = 0.25;

/**
 * Le paramétrage daté de la lecture : décimales, seuils de confiance,
 * tolérance d'arrondi. Un paramètre absent est une erreur, jamais un défaut.
 */
export async function lireParametres(
  db: Requete,
  pack: string,
  date: string,
): Promise<Record<(typeof PARAMETRES)[number], number>> {
  const { rows } = await db.query<{ code: string; value_num: string }>(
    `select distinct on (code) code, value_num from ref.socle_params
      where pack_version_id = $1 and code = any($2) and valid_from <= $3::date
        and (valid_to is null or valid_to >= $3::date)
      order by code, valid_from desc`,
    [pack, PARAMETRES, date],
  );
  const p = Object.fromEntries(rows.map((r) => [r.code, Number(r.value_num)]));
  const manquant = PARAMETRES.find((c) => !(c in p));
  if (manquant) throw refus(`Paramètre « ${manquant} » absent du paramétrage au ${date}.`);
  return p as Record<(typeof PARAMETRES)[number], number>;
}

/**
 * Toutes les devises du référentiel, telles que les lecteurs de montants les
 * lisent (`@malica/socle/montant-imprime`) :
 *
 *   — l'exposant et le séparateur décimal, de `ref.devises` (3 et « , » pour
 *     le dinar, 2 pour l'euro, 0 pour le franc CFA) ;
 *   — les marques de TOUTES les devises, chacune avec la sienne : les codes
 *     de `ref.devises` et les marques imprimées de `ref.devises_marques`
 *     (« D.T. », « د.ت », « € », « F CFA »). C'est ce qui permet de dire
 *     qu'une pièce imprime « 100,00 € » et non des dinars.
 *
 * La relecture au plan de jetons, le jugement et la proposition passent tous
 * par ici, et décident de la devise de la pièce par une seule règle
 * (`deviseDeLaPiece`). Un référentiel sans devise est une erreur.
 */
export async function lireLesDevises(db: Requete): Promise<DeviseLue[]> {
  const [{ rows: devises }, { rows: marques }] = await Promise.all([
    db.query<{ code: string; exposant: number; separateur_decimal: string }>(
      `select code, exposant, separateur_decimal from ref.devises order by code collate "C"`,
    ),
    db.query<MarqueDeDevise>(
      `select marque, devise from (
         select code as marque, code as devise from ref.devises
          union
         select marque, devise from ref.devises_marques
       ) m order by marque collate "C", devise collate "C"`,
    ),
  ]);
  if (devises.length === 0) throw new Error("Aucune devise au référentiel.");
  return devises.map((d) => ({
    code: d.code,
    decimales: d.exposant,
    separateurDecimal: d.separateur_decimal,
    marques,
  }));
}

/**
 * L'exposant d'UNE devise (`ref.devises`) : la seule source des décimales
 * d'un montant (revue de #148 — `money.decimals`, l'exposant du pack, en
 * doublait une et s'appliquait à toute devise). Une devise inconnue lève.
 */
export async function exposantDeLaDevise(db: Requete, devise: string): Promise<number> {
  const { rows } = await db.query<{ exposant: number }>(
    `select exposant from ref.devises where code = $1`,
    [devise],
  );
  if (!rows[0]) throw new Error(`devise inconnue du référentiel : ${devise}`);
  return Number(rows[0].exposant);
}

/** L'exposant de la devise d'un pack (`ref.jurisdiction_packs.currency`). */
export async function exposantDuPack(db: Requete, pack: string): Promise<number> {
  const { rows } = await db.query<{ exposant: number }>(
    `select d.exposant from ref.jurisdiction_packs p
       join ref.devises d on d.code = p.currency
      where p.id = $1`,
    [pack],
  );
  if (!rows[0]) throw new Error(`pack inconnu, ou sa devise absente du référentiel : ${pack}`);
  return Number(rows[0].exposant);
}

/**
 * Ce que le titre imprimé d'une pièce dit de sa nature (`ref.titres_de_piece`),
 * dans l'ordre du référentiel. Le contrôle de la nature les lit ; aucune liste
 * de titres n'est écrite en TypeScript.
 */
export async function lireLesTitres(db: Requete): Promise<ContexteControle["titres"]> {
  const { rows } = await db.query<ContexteControle["titres"][number]>(
    `select motif, document_type as "documentType", statut, refus
       from ref.titres_de_piece order by rang`,
  );
  return rows;
}

/** Les mots d'un achat dont la TVA peut être exclue, au jour de la pièce. */
export async function lireLesExclusionsDeDeduction(
  db: Requete,
  pack: string,
  jour: string,
): Promise<ContexteControle["exclusionsDeDeduction"]> {
  const { rows } = await db.query<ContexteControle["exclusionsDeDeduction"][number]>(
    `select motif, famille, base_legale from ref.exclusions_de_deduction
      where pack_version_id = $1 and valid_from <= $2::date
        and (valid_to is null or valid_to >= $2::date)
      order by famille collate "C", motif collate "C"`,
    [pack, jour],
  );
  return rows;
}

/**
 * Les mots qui désignent un bien SUSCEPTIBLE d'être immobilisé
 * (`ref.biens_immobilisables`), en vigueur au jour de la pièce, dans un ordre
 * total (binaire : l'ordre ne dépend pas de la langue de la base). Le
 * contrôle `immobilisation_a_trancher` les lit ; aucun mot n'est écrit en
 * TypeScript.
 */
export async function lireLesBiensImmobilisables(
  db: Requete,
  pack: string,
  jour: string,
): Promise<ContexteControle["biensImmobilisables"]> {
  const { rows } = await db.query<ContexteControle["biensImmobilisables"][number]>(
    `select motif, famille from ref.biens_immobilisables
      where pack_version_id = $1 and valid_from <= $2::date
        and (valid_to is null or valid_to >= $2::date)
      order by famille collate "C", motif collate "C"`,
    [pack, jour],
  );
  return rows;
}

/**
 * Le dossier est-il non assujetti à la TVA, d'après sa fiche fiscale en
 * vigueur ? Sa TVA est alors un coût (ANO-LIVE-001) : la même lecture que la
 * proposition d'écriture.
 */
export async function nonAssujetti(db: Requete, dossier: string): Promise<boolean> {
  const { rows } = await db.query<{ regime_tva: string | null }>(
    `select f.regime_tva from identity.fiches_fiscales f
      where f.tenant_id = $1 and f.valid_to is null
      order by f.valid_from desc limit 1`,
    [dossier],
  );
  return rows[0]?.regime_tva === "non_assujetti";
}

export interface Analyse {
  id: string;
  verdict: string;
  motifs: Array<Pick<ResultatControle, "code" | "statut" | "motif">>;
  controles: ResultatControle[];
  normalisation: ResultatNormalisation;
}

/**
 * Ce qu'une lecture porte, tel que la base le relit pour la juger.
 *
 * ================================================================= POURQUOI
 *
 * Le jugement était tissé dans les requêtes : on ne pouvait le jouer qu'avec
 * une base. Le 30 octobre 2026, il a fallu MESURER combien de pièces
 * reçoivent une écriture juste (`mesure-des-propositions.test.ts`) — sur la
 * vraie chaîne, pas sur une copie qui dériverait. La chaîne est donc coupée
 * en deux : ce qui lit (`analyserPiece`), ce qui juge (`jugerLaLecture`).
 */
export interface LectureAJuger {
  payload: PayloadLu;
  /** Le texte IMPRIMÉ d'un champ cité, jetons réassemblés ; null s'il n'est pas cité. */
  imprime: (champ: string) => string | null;
  /** Le haut de la première page, où s'imprime le titre du document. */
  titre: string | null;
  /** Le sens CONFIRMÉ par une personne, s'il l'a été. */
  sensDit: string | null;
  /** La date de la pièce : lue, à défaut donnée par une personne. */
  date: string | null;
  recueLe: string;
  confianceParChamp: Record<string, number>;
  doublonDe: string | null;
}

/** Ce que le référentiel daté dit, pour juger cette lecture-là. */
export interface ReferentielDuJugement {
  parametres: Record<(typeof PARAMETRES)[number], number>;
  /** Toutes les devises du référentiel (`lireLesDevises`). */
  devises: readonly DeviseLue[];
  /** TOUS les taux de TVA en vigueur à la date de la pièce, par code. */
  taux: ReadonlyMap<string, string>;
  /** La devise du dossier, celle de ses livres et de ses droits fixés. */
  deviseDuDossier: string;
  /** Les droits que le paramétrage FIXE (le timbre…), en écriture décimale, par code. */
  droitsFixes: ReadonlyMap<string, string>;
  /**
   * Les codes des droits qui entrent dans la base de la TVA
   * (`ref.fiscal_charges.taxable` : le FODEC). La normalisation les y admet.
   */
  droitsTaxables: ReadonlySet<string>;
  tenant: ContexteControle["tenant"];
  typesDocument: ContexteControle["typesDocument"];
  /** Ce que le titre imprimé dit de la nature de la pièce (`lireLesTitres`). */
  titres: ContexteControle["titres"];
  /** Les mots d'un bien susceptible d'être immobilisé (`lireLesBiensImmobilisables`). */
  biensImmobilisables: ContexteControle["biensImmobilisables"];
  exclusionsDeDeduction: ContexteControle["exclusionsDeDeduction"];
  /** Le seuil et le traitement d'un bien de faible valeur, arrêtés pour le dossier. */
  immobilisation: ContexteControle["immobilisation"];
  /** Le traitement d'un avoir, arrêté pour le dossier (`reglageDesAvoirs`). */
  avoirs: ContexteControle["avoirs"];
  mentionsObligatoires: ContexteControle["mentionsObligatoires"];
  doublonProbable: string | null;
  /** La règle de change et les cours applicables (`lireLeChange`). */
  change: ChangeDuJugement | null;
  /** La forme de lecture du matricule fiscal du pack (`lireLesReglesDeLecture`). */
  formatDuMatricule: ContexteControle["formatDuMatricule"];
}

/** La part de l'extraction que le jugement relit. */
interface PayloadLu {
  issuer?: string | null;
  document_date?: string | null;
  document_kind?: string | null;
  currency?: string | null;
  lines?: Array<{ tax_code?: string | null }>;
  articles?: Array<{
    designation?: string | null;
    quantity?: string | null;
    unit_price_ht?: string | null;
    unit_price_ttc?: string | null;
    total_ht?: string | null;
    tax_code?: string | null;
  }>;
  other_charges?: Array<{ code?: string | null }>;
  references?: Record<string, string>;
  totals?: { ttc?: string | null };
}

/** Le sens retenu : celui que la personne a dit, à défaut celui de la lecture. */
const sensRetenu = (l: Pick<LectureAJuger, "sensDit" | "payload">): string | null =>
  l.sensDit ?? l.payload.document_kind ?? null;

/**
 * Normaliser les montants d'une lecture, depuis le texte IMPRIMÉ de ses
 * champs cités et le référentiel daté. Pure.
 */
function normaliserLaLecture(l: LectureAJuger, r: ReferentielDuJugement): ResultatNormalisation {
  const { payload, imprime: brut } = l;
  const p = r.parametres;
  const lignes = payload.lines ?? [];
  const droits = payload.other_charges ?? [];
  const sansTaux = lignes.find((x) => !x.tax_code || !r.taux.has(x.tax_code));
  const dateRef = l.date ?? l.recueLe;

  /**
   * Ce que la pièce imprime, et rien de retenu : la raison seule — et la
   * devise de la pièce quand elle s'est décidée.
   */
  const rien = (raison: string, devise: string | null): ResultatNormalisation => ({
    etat: "illisible",
    devise,
    parConvention: false,
    montants: {
      bases: lignes.map(() => ({ ht: null, taux: "" })),
      tva: null,
      autres: droits.map(() => null),
      ttc: null,
    },
    /*
     * Ce que la pièce imprime, même ici — surtout ici.
     *
     * La pièce continue d'imprimer ses totaux : les déclarer absents
     * ajouterait un reproche faux à un reproche juste (5 octobre 2026).
     *
     * Sans ligne par taux, la base imprimée est le HT global du pied :
     * une facture qui ne ventile pas sa TVA porte quand même sa base.
     */
    imprime: {
      bases:
        lignes.length === 0
          ? [brut("totals.base_ht")]
          : lignes.map(
              (_, i) =>
                brut(`lines[${i}].base_ht`) ??
                (lignes.length === 1 ? brut("totals.base_ht") : null),
            ),
      tva: brut("totals.vat"),
      autres: droits.map((_, i) => brut(`other_charges[${i}].amount`)),
      ttc: brut("totals.ttc"),
    },
    confiance: 0,
    conventions: [],
    lecturesValides: 0,
    /*
     * Aucun total n'a été écarté ici : on s'arrête AVANT la moindre
     * lecture de montant. Dire le contraire ferait porter à la pièce un
     * défaut qu'elle n'a pas.
     */
    totalNonLu: null,
    ligneNonLue: null,
    deduits: [],
    fermes: [],
    raison,
  });

  /*
   * L'EXPOSANT EST CELUI DE LA DEVISE DE LA PIÈCE (30 octobre 2026).
   *
   * Les montants se lisaient aux décimales du PACK (`money.decimals`, trois
   * pour la Tunisie), quelle que soit la devise imprimée : « 1 234,56 € »
   * s'y lisait en millimes. L'exposant vient de `ref.devises`, pour la devise
   * de la pièce ; une devise qu'il ne connaît pas ne se lit pas.
   *
   * ET LA DEVISE DE LA PIÈCE SE CONFRONTE À CE QU'ELLE IMPRIME (revue de la
   * PR 144) : « 100,00 € » sans devise lue partait en 100,000 DINARS. La règle
   * est `deviseDeLaPiece`, la même qu'à la relecture : une marque étrangère
   * décide d'une devise non lue, contredit une devise lue, et seule une pièce
   * qui n'imprime AUCUNE marque prend celle du dossier.
   */
  const textes = [
    ...lignes.map((_, i) => brut(`lines[${i}].base_ht`)),
    brut("totals.base_ht"),
    brut("totals.vat"),
    brut("totals.ttc"),
    ...droits.map((_, i) => brut(`other_charges[${i}].amount`)),
  ];
  const decidee = deviseDeLaPiece(
    payload.currency,
    textes,
    r.devises[0]?.marques ?? [],
    r.deviseDuDossier,
  );
  if (decidee.code === null) return rien(decidee.raison, null);
  const devise = decidee.code;
  const deLaPiece = r.devises.find((d) => d.code === devise);
  if (!deLaPiece) return rien(`devise « ${devise} » inconnue du référentiel`, null);
  const lecture = { ...deLaPiece, toleranceMineure: p["lecture.tolerance_arrondi_mineure"] };
  // Un droit fixé l'est dans la devise du dossier : il n'ancre rien sur une
  // pièce libellée dans une autre. Converti sur ses chiffres, jamais par un
  // flottant : un droit plus précis que la devise est une erreur du
  // référentiel, et elle se dit au lieu de s'arrondir.
  const enMineur = (fixe: string | undefined) =>
    fixe !== undefined && devise === r.deviseDuDossier
      ? Number(enUnitesExactes(fixe, lecture.decimales))
      : undefined;
  // Le chemin de citation de chaque montant : `fermes` nomme les champs ainsi.
  const chemins: Record<string, string> = {
    pied0: "totals.base_ht",
    htTotal: "totals.base_ht",
    tva: "totals.vat",
    ttc: "totals.ttc",
    ...Object.fromEntries(
      lignes.map((_, i) => [
        `ht${i}`,
        brut(`lines[${i}].base_ht`) !== null || lignes.length > 1
          ? `lines[${i}].base_ht`
          : "totals.base_ht",
      ]),
    ),
    ...Object.fromEntries(droits.map((_, i) => [`autre${i}`, `other_charges[${i}].amount`])),
  };
  const autres = droits.map((d, i) => {
    const b = brut(`other_charges[${i}].amount`);
    const attendu = d.code ? enMineur(r.droitsFixes.get(d.code)) : undefined;
    // Le référentiel dit si le droit entre dans la base de la TVA.
    const taxable = d.code ? r.droitsTaxables.has(d.code) : false;
    // Un droit nommé dont le montant n'est pas cité reste dans l'équation :
    // il ne s'y retient que si le paramétrage le fixe et que la facture le
    // prouve (`normaliser-montants.ts`, « ce que la facture prouve »).
    if (attendu !== undefined) return { brut: b, attendu, taxable };
    return taxable ? { brut: b, taxable } : (b ?? { brut: null });
  });

  /*
   * ============================================= LE TAUX QUE LA FACTURE PROUVE
   *
   * Sans ligne par taux lue, ou avec un code que le paramétrage ignore
   * (« TVA_19 » pour « TVA19 »), la pièce restait sans écriture. Sur une
   * facture qui imprime sa base, sa TVA et son total, un taux se PROUVE à
   * deux conditions :
   *
   *   — sous lui, et sous lui seul, la facture entière tient : la TVA vaut
   *     arrondi(HT × taux), le total la somme ;
   *   — aucun MÉLANGE des autres taux en vigueur ne donne la même TVA. Revue
   *     de la PR 142 : 1 000 à 7 % et 1 000 à 19 % font 260 sur 2 000, soit
   *     13 % — un taux du paramétrage, et pourtant deux lignes. Un rapport
   *     TVA ÷ HT compris entre deux autres taux est toujours un mélange
   *     possible ; seul le taux le plus haut en vigueur, ou le plus bas, ne
   *     l'est pas.
   *
   * Le total doit être LU : sans lui, le taux serait une seconde valeur
   * déduite, et une pièce n'en porte jamais deux. Sinon : « taux de TVA à
   * préciser », et rien n'est proposé.
   */
  if (lignes.length === 0 || (lignes.length === 1 && sansTaux)) {
    const ht = brut("lines[0].base_ht") ?? brut("totals.base_ht");
    const tva = brut("totals.vat");
    const ttc = brut("totals.ttc");
    const lu = sansTaux?.tax_code ?? null;
    if (ht === null || tva === null || ttc === null)
      return rien(
        "taux de TVA à préciser : la base, la TVA et le total ne sont pas tous lus",
        devise,
      );
    const tiennent = [...r.taux].flatMap(([code, taux]) => {
      const n = normaliserMontants(
        {
          bases: [{ ht, taux, pied: brut("totals.base_ht") }],
          tva,
          autres,
          ttc,
          chemins: {
            ...chemins,
            ht0: brut("lines[0].base_ht") !== null ? "lines[0].base_ht" : "totals.base_ht",
          },
        },
        lecture,
      );
      // Le taux se PROUVE par une TVA et un total lus, jamais par une valeur déduite.
      return n.etat === "tranche" &&
        n.deduits.length === 0 &&
        n.totalNonLu === null &&
        n.montants.tva !== null
        ? [{ code, taux, n }]
        : [];
    });
    const valeurs = [...r.taux.values()].map(Number);
    const extreme = (taux: string) =>
      Number(taux) === Math.max(...valeurs) || Number(taux) === Math.min(...valeurs);
    if (tiennent.length !== 1 || !extreme(tiennent[0]!.taux))
      return rien(
        tiennent.length === 0
          ? `taux de TVA à préciser : aucun taux du paramétrage au ${dateRef} ne fait tenir la facture`
          : `taux de TVA à préciser : ${tiennent.map((t) => t.code).join(", ")} ou un mélange de taux`,
        devise,
      );
    const [{ code, n }] = tiennent as [(typeof tiennent)[number]];
    return {
      ...n,
      deduits: [
        {
          champ: "lines[0].tax_code",
          valeur: code,
          formule: `taux = TVA ÷ HT : seul taux du paramétrage au ${dateRef} qui fait tenir la facture, et qu'aucun mélange des autres ne donne`,
          operandes: { ht, tva, ttc, imprime: lu ?? "" },
        },
      ],
      raison: `${n.raison} ; le taux ${code} est déduit de la TVA et de la base imprimées`,
    };
  }
  if (sansTaux)
    return rien(
      `taux « ${sansTaux.tax_code ?? "—"} » inconnu du paramétrage au ${dateRef}`,
      devise,
    );

  return normaliserMontants(
    {
      bases: lignes.map((x, i) => ({
        ht: brut(`lines[${i}].base_ht`) ?? (lignes.length === 1 ? brut("totals.base_ht") : null),
        taux: r.taux.get(x.tax_code!)!,
        // Le HT du pied, si la ligne ne se lit pas (29 octobre 2026).
        pied: lignes.length === 1 ? brut("totals.base_ht") : null,
      })),
      // Plusieurs taux : le HT du pied prouve une base illisible.
      htTotal: lignes.length > 1 ? brut("totals.base_ht") : null,
      tva: brut("totals.vat"),
      autres,
      ttc: brut("totals.ttc"),
      chemins,
    },
    lecture,
  );
}

/**
 * Juger une lecture : ses montants normalisés, ses contrôles motivés, son
 * verdict. Pure — c'est la chaîne même qu'`analyserPiece` pose en base.
 */
export function jugerLaLecture(
  l: LectureAJuger,
  r: ReferentielDuJugement,
): {
  normalisation: ResultatNormalisation;
  controles: ResultatControle[];
  verdict: string;
  motifs: Analyse["motifs"];
} {
  const normalisation = normaliserLaLecture(l, r);
  const refs = l.payload.references ?? {};
  const aControler: PieceAControler = {
    documentKind: sensRetenu(l),
    titre: l.titre,
    emetteur: {
      nom: l.payload.issuer || null,
      identifiantFiscal: refs[NOM_MATRICULE_EMETTEUR] ?? null,
    },
    destinataire: { nom: null, identifiantFiscal: refs[NOM_MATRICULE_CLIENT] ?? null },
    numero: refs["numero"] ?? null,
    date: l.date,
    montants: normalisation,
    confianceParChamp: l.confianceParChamp,
    reception: { doublonDe: l.doublonDe, recueLe: l.recueLe },
    // Le sens CONFIRMÉ par la personne (20 octobre 2026), qu'il redise la
    // lecture ou la corrige : c'est lui qui est retenu (voir plus haut).
    sensConfirme: l.sensDit !== null,
    articles: (l.payload.articles ?? []).flatMap((a) =>
      a.designation?.trim()
        ? [
            {
              designation: a.designation,
              quantite: a.quantity ?? null,
              prixUnitaireHt: a.unit_price_ht ?? null,
              totalHt: a.total_ht ?? null,
              prixUnitaireTtc: a.unit_price_ttc ?? null,
              tauxDeTva: (a.tax_code ? r.taux.get(a.tax_code) : undefined) ?? null,
            },
          ]
        : [],
    ),
  };
  const contexte: ContexteControle = {
    tenant: r.tenant,
    typesDocument: r.typesDocument,
    titres: r.titres,
    biensImmobilisables: r.biensImmobilisables,
    exclusionsDeDeduction: r.exclusionsDeDeduction,
    immobilisation: r.immobilisation,
    avoirs: r.avoirs,
    mentionsObligatoires: r.mentionsObligatoires,
    seuilConfianceReserve: r.parametres["lecture.confiance_reserve"],
    seuilConfianceBloquant: r.parametres["lecture.confiance_bloquante"],
    ecartDateJours: r.parametres["piece.ecart_date_jours"],
    doublonProbable: r.doublonProbable,
    deviseDuDossier: r.deviseDuDossier,
    change: r.change,
    formatDuMatricule: r.formatDuMatricule,
  };
  const controles = controlerPiece(aControler, contexte);
  const { verdict, motifs } = rendreVerdict(controles);
  return { normalisation, controles, verdict, motifs };
}

/**
 * La version des règles du jugement : avec l'empreinte des référentiels de
 * mots (`versionDuJugement`), elle est posée sur chaque analyse
 * (`capture.analyses.regles`).
 *
 * ================================================================= POURQUOI
 *
 * Le 30 octobre 2026 (PR 142), le Socle a appris à déduire ce que la facture
 * prouve et propose bien plus souvent. Mais `capture.analyses` est en ajout
 * seul et le dernier passage fait foi : une pièce jugée la veille gardait son
 * ancien verdict, et le cabinet lisait « le Socle ne propose rien » là où les
 * règles du jour proposaient. Rien ne disait qu'un jugement était périmé.
 *
 * Elle vit ICI, et nulle part ailleurs : `<date>.<empreinte>`, la date du
 * changement de règles et les douze premiers caractères de l'empreinte de ce
 * que `jugerLaLecture` (normalisation, contrôles, verdict) rend sur le témoin
 * de mesure (`empreinteDesJugements`, `mesure-des-propositions.ts`).
 *
 * ========================================================= ON NE L'OUBLIE PAS
 *
 * Une version qu'il faut penser à changer est une version qu'on oubliera : les
 * jugements d'avant passeraient pour à jour. L'empreinte la lie au jugement
 * lui-même — `les-regles-du-jugement-suivent-le-jugement.test.ts` échoue dès
 * que le jugement change sur le témoin sans qu'elle change, et donne la
 * valeur à écrire. Une analyse posée avant ce marqueur le porte NUL : elle
 * est périmée par définition.
 */
export const REGLES_DU_JUGEMENT = "2026-11-01.447e5ce908be";

/*
 * Les référentiels de MOTS que le jugement compare au texte imprimé, et que la
 * recette complète au fil des cas : un titre de pièce, un bien susceptible
 * d'être immobilisé. Une ligne ajoutée change le jugement d'une pièce DÉJÀ
 * jugée sans changer le code — revue de #173 : le motif « copieur »
 * (20261114090000) laissait une pièce jugée avant en charge, sans réserve, et
 * l'ouverture la disait à jour. Leur empreinte entre donc dans la version que
 * chaque jugement porte (`versionDuJugementSql`).
 *
 * Les valeurs DATÉES du pack (taux, droits, mentions) n'y sont pas : un
 * changement s'y écrit par une nouvelle période, et le jugement d'une pièce
 * d'avant n'a pas à bouger. Les réglages du cabinet et les cours suivent leur
 * propre preuve (`app.reglages_du_jugement_a_jour`, `app.cours_du_jugement_a_jour`) ;
 * les natures de vente se lisent à la proposition, jamais figées au jugement.
 */
const REFERENTIELS_DU_JUGEMENT = [
  "ref.biens_immobilisables",
  "ref.exclusions_de_deduction",
  "ref.titres_de_piece",
] as const;

/**
 * La version d'un jugement, en SQL, à partir d'un paramètre qui porte
 * `REGLES_DU_JUGEMENT` : `<règles>+<empreinte des référentiels>`. Une requête
 * sur deux tables de quelques dizaines de lignes, sans clé de pièce : le même
 * coût pour une ouverture que pour un lot.
 */
export function versionDuJugementSql(regles: string): string {
  const lignes = REFERENTIELS_DU_JUGEMENT.map(
    (t) => `select '${t}:' || r::text as t from ${t} r`,
  ).join(" union all ");
  return `(${regles} || '+' || (select substr(md5(coalesce(string_agg(x.t, E'\\n' order by x.t collate "C"), '')), 1, 12)
                                   from (${lignes}) x))`;
}

/** La version que porte un jugement rendu maintenant (`versionDuJugementSql`). */
export async function versionDuJugement(db: Requete): Promise<string> {
  const { rows } = await db.query<{ version: string }>(
    `select ${versionDuJugementSql("$1::text")} as version`,
    [REGLES_DU_JUGEMENT],
  );
  return rows[0]!.version;
}

/** Le jugement d'une pièce, tel qu'il se pose : une ligne de `capture.analyses`. */
interface JugementDeLaPiece {
  tenantId: string;
  pieceId: string;
  extractionId: string;
  pack: string;
  /** La version sous laquelle il est rendu (`versionDuJugement`). */
  regles: string;
  normalisation: ResultatNormalisation;
  controles: ResultatControle[];
  verdict: string;
  motifs: Analyse["motifs"];
  cle: ReturnType<typeof cleDeDoublon>;
}

/** Juger une pièce lue et poser le jugement. Un nouveau passage s'ajoute toujours. */
export async function analyserPiece(db: Requete, pieceId: string): Promise<Analyse> {
  const j = await jugerLaPiece(db, pieceId);
  const analyse = await poserLeJugement(db, j);
  await tracerLeJugement(db, j, analyse.id, { chemin: "analyse" });
  return analyse;
}

/**
 * Rejuger une pièce aux règles du jour, sans rien ajouter si rien ne change.
 *
 * Le jugement est recalculé par la même chaîne qu'`analyserPiece`, puis
 * comparé au dernier posé : même lecture, même pack, même verdict, mêmes
 * motifs, mêmes contrôles, mêmes montants normalisés, même clé de doublon.
 * Différent, une analyse NOUVELLE s'ajoute (R7) ; l'ancienne reste, datée,
 * pour qui veut savoir ce qui a été dit.
 *
 * Identique, l'analyse ne bouge pas (R7) : si elle a été rendue sous d'autres
 * règles, le constat « revérifiée sous les règles du jour » s'inscrit à côté
 * (`capture.analyses_verifiees`), une fois. Sans lui, une pièce ancienne que
 * les règles du jour jugent pareil restait périmée, et chaque ouverture —
 * la file du cabinet comprise — refaisait tout le jugement (revue de la PR 143).
 * Le rejouer n'ajoute rien.
 */
export async function rejugerLaPiece(
  db: Requete,
  pieceId: string,
  /** Le rejeu « à blanc » (`rejugerLesPieces`, `essai`) : tout s'annule, et le journal le dit. */
  options: { essai?: boolean } = {},
): Promise<{ change: boolean; verifie: boolean }> {
  const j = await jugerLaPiece(db, pieceId);
  const { rows } = await db.query<{ id: string; regles: string | null; identique: boolean }>(
    `select a.id, a.regles,
            a.extraction_id = $2 and a.pack_version_id = $3 and a.verdict = $4
            and a.motifs = $5::jsonb and a.controles = $6::jsonb
            and a.normalisation = $7::jsonb
            and a.doublon_numero is not distinct from $8
            and a.doublon_mf is not distinct from $9
            and a.doublon_lu is not distinct from $10 as identique
       from capture.analyses a
      where a.piece_id = $1
      order by a.created_at desc limit 1`,
    [
      pieceId,
      j.extractionId,
      j.pack,
      j.verdict,
      JSON.stringify(j.motifs),
      JSON.stringify(j.controles),
      JSON.stringify(j.normalisation),
      j.cle.numero,
      j.cle.mf,
      j.cle.lu,
    ],
  );
  const derniere = rows[0];
  const essai = options.essai ?? false;
  if (!derniere?.identique) {
    const posee = await poserLeJugement(db, j);
    await tracerLeJugement(db, j, posee.id, { chemin: "rejeu", change: true, essai });
    return { change: true, verifie: false };
  }
  await tracerLeJugement(db, j, derniere.id, { chemin: "rejeu", change: false, essai });
  if (derniere.regles === j.regles) return { change: false, verifie: false };
  const { rows: verifiee } = await db.query<{ inscrite: boolean }>(
    `select public.analyse_verifier($1, $2) as inscrite`,
    [derniere.id, j.regles],
  );
  return { change: false, verifie: verifiee[0]!.inscrite };
}

async function jugerLaPiece(db: Requete, pieceId: string): Promise<JugementDeLaPiece> {
  const { rows: pieces } = await db.query<{
    tenant_id: string;
    doublon_de: string | null;
    recue_le: string;
    document_kind: string | null;
    document_kind_statut: string;
  }>(
    `select p.tenant_id, p.doublon_de, to_char(v.recue_le, 'YYYY-MM-DD') as recue_le,
            p.document_kind, p.document_kind_statut
       from capture.pieces p join pieces_v v on v.id = p.id
      where p.id = $1`,
    [pieceId],
  );
  const piece = pieces[0];
  if (!piece) throw new Error("piece.introuvable");

  const { rows: extractions } = await db.query<{
    id: string;
    payload: Record<string, unknown>;
    confiance_par_champ: Record<string, number>;
  }>(
    `select id, payload, confiance_par_champ from capture.extractions
      where piece_id = $1 order by created_at desc limit 1`,
    [pieceId],
  );
  const extraction = extractions[0];
  if (!extraction) throw refus("Cette pièce n'a pas encore été lue : il n'y a rien à juger.");
  /*
   * LE NOM DIT PAR LA PERSONNE L'EMPORTE SUR LE NOM LU (3 novembre 2026).
   *
   * Recette, facture MyTek : la lecture a pris le logo stylisé, lu « MITEK »,
   * pour le nom de l'émetteur. La correction est une précision (R7) ; le
   * jugement, la clé de doublon et l'écriture proposée la lisent ici, une fois.
   */
  const { rows: nomsDits } = await db.query<{ nom: string | null }>(
    `select app.emetteur_dit($1) as nom`,
    [pieceId],
  );
  const nomDit = nomsDits[0]?.nom ?? null;
  const payload = (
    nomDit ? { ...extraction.payload, issuer: nomDit } : extraction.payload
  ) as PayloadLu;
  /*
   * LE SENS DIT PAR LA PERSONNE L'EMPORTE SUR LE SENS LU (21 octobre 2026).
   *
   * Recette « vie réelle », ANO-LIVE-002/004 : un ticket d'achat lu « vente »,
   * ou lu sans sens, restait bloqué même après que le dirigeant eut répondu
   * « Un achat » — sa réponse ne comptait que si elle redisait la lecture.
   * Le dirigeant sait s'il a payé ou encaissé ; la lecture le devine.
   */
  const sensDit =
    piece.document_kind_statut === "confirme" && piece.document_kind !== null
      ? piece.document_kind
      : null;

  const { rows: orgs } = await db.query<{
    name: string;
    legal_id: string | null;
    jurisdiction: string;
    currency: string;
  }>(`select name, legal_id, jurisdiction, currency from identity.organizations where id = $1`, [
    piece.tenant_id,
  ]);
  const org = orgs[0];
  if (!org) throw new Error("piece.introuvable");

  /*
   * La date lue d'abord ; à défaut, celle que la personne a donnée
   * (`precisions`, R7) — sans quoi une pièce datée à la main restait jugée
   * « date à saisir » et rangée au barème du jour de sa réception.
   */
  const { rows: dites } = await db.query<{ valeur: string }>(
    `select valeur from capture.precisions
      where piece_id = $1 and champ = 'document_date'
      order by decided_at desc limit 1`,
    [pieceId],
  );
  const datePiece = dateDeLaPiece(payload.document_date, dites[0]?.valeur ?? null);
  const dateRef = datePiece ?? piece.recue_le;

  const { rows: packs } = await db.query<{ id: string }>(
    `select id from ref.jurisdiction_packs
      where jurisdiction = $1 and effective_from <= $2::date
      order by effective_from desc limit 1`,
    [org.jurisdiction, dateRef],
  );
  const pack = packs[0]?.id;
  // Le plus souvent une date mal lue : la proposition le dit par son code
  // (`date_hors_referentiel`), tout autre appelant par la clé du refus.
  if (!pack) throw Object.assign(new PackUnavailable(org.jurisdiction, dateRef), { code: "22023" });

  const p = await lireParametres(db, pack, dateRef);
  const { matricule: formatDuMatricule } = await lireLesReglesDeLecture(db, pack, dateRef);

  /*
   * Le texte imprimé de chaque champ cité, jetons réassemblés dans l'ordre.
   *
   * ================================ UNE PROMESSE QUI N'ÉTAIT PAS TENUE
   *
   * L'en-tête de ce fichier annonce depuis le 24 août que ce mécanisme règle
   * « le piège des montants coupés en deux jetons (« 1 » et « 234,560 ») : ils
   * se réunissent ici, par leurs citations ». C'était faux, et c'est resté
   * faux six semaines.
   *
   * La requête ne joignait que `c.token_id`, soit le PREMIER jeton de la
   * plage. Il n'y avait qu'une citation par champ, donc le `join(" ")`
   * ci-dessous ne joignait jamais rien, et la normalisation recevait « 3 » là
   * où la pièce imprimait « 3 020,000 ».
   *
   * Depuis `20261005120000`, la citation porte `ordinal_end`. On joint donc
   * l'INTERVALLE, et la promesse devient un mécanisme. Pour une citation sans
   * plage, `coalesce` ramène l'intervalle au seul jeton cité : le comportement
   * des citations déjà en base ne change pas.
   *
   * Le texte de chaque citation se lit comme au plan de jetons
   * (`texteDuMontantCite`) : la parenthèse qui ferme un MOT coupé par la plage
   * — « (base 3 020,000) » cité « 3 020,000) » — se retire, et elle seule
   * (revue de la PR 144). Le plan entier est donc relu : c'est lui qui le dit.
   *
   * Le plan et les citations sont ceux de LA LECTURE JUGÉE : une relecture
   * de nuit porte son propre plan (17 novembre 2026), et mêler les deux
   * citerait des jetons d'une autre lecture. Un plan sans lecture nommée
   * (antérieur, ou banc d'essai) reste celui de la pièce.
   */
  const [{ rows: cites }, { rows: plan }] = await Promise.all([
    db.query<{ field: string; page: number; ordinal: number; fin: number }>(
      `select c.field, d.page, d.ordinal, coalesce(c.ordinal_end, d.ordinal) as fin
         from capture.citations c
         join capture.token_plan d on d.id = c.token_id
        where c.piece_id = $1 and coalesce(c.extraction_id, $2) = $2
        order by c.field, d.page, d.ordinal`,
      [pieceId, extraction.id],
    ),
    db.query<PageToken>(
      `select page, ordinal, text, x0::float8 as x0, y0::float8 as y0, x1::float8 as x1,
              y1::float8 as y1
         from capture.token_plan
        where piece_id = $1 and coalesce(extraction_id, $2) = $2 order by page, ordinal`,
      [pieceId, extraction.id],
    ),
  ]);
  const imprime = new Map<string, string[]>();
  for (const c of cites) {
    const texte = texteDuMontantCite(plan, { page: c.page, ordinal: c.ordinal, ordinalEnd: c.fin });
    if (texte !== null) imprime.set(c.field, [...(imprime.get(c.field) ?? []), texte]);
  }

  const { rows: haut } = await db.query<{ text: string }>(
    `select text from capture.token_plan
      where piece_id = $1 and coalesce(extraction_id, $3) = $3
        and page = (select min(page) from capture.token_plan
                     where piece_id = $1 and coalesce(extraction_id, $3) = $3)
        and y0 <= $2
      order by y0, x0`,
    [pieceId, HAUT_DE_PAGE, extraction.id],
  );

  /*
   * LES PARTIES SELON LE SENS CONFIRMÉ (5 novembre 2026, option A du dirigeant).
   *
   * Le sens corrigé après la lecture ne relit pas l'image : la lecture se rejoue sur ses
   * jetons, avec le sens confirmé, et le matricule du dossier place les parties
   * (`parties-selon-le-sens.ts`). Sans sens confirmé, la lecture fait foi.
   */
  const lues = payload.references ?? {};
  const places = await partiesSelonLeSens(db, {
    tenantId: piece.tenant_id,
    packId: pack,
    jour: dateRef,
    documentKind: piece.document_kind,
    documentKindStatut: piece.document_kind_statut,
    plan,
    lues: {
      emetteur: lues[NOM_MATRICULE_EMETTEUR] ?? null,
      client: lues[NOM_MATRICULE_CLIENT] ?? null,
    },
    dossier: { matricule: org.legal_id, raisonSociale: org.name },
    devise: (await lireLesDevises(db)).find((d) => d.code === org.currency),
    formatDuMatricule,
  });
  const payloadJuge: PayloadLu = places
    ? {
        ...payload,
        references: Object.fromEntries([
          ...Object.entries(lues).filter(
            ([k]) => k !== NOM_MATRICULE_EMETTEUR && k !== NOM_MATRICULE_CLIENT,
          ),
          ...(places.emetteur ? [[NOM_MATRICULE_EMETTEUR, places.emetteur]] : []),
          ...(places.client ? [[NOM_MATRICULE_CLIENT, places.client]] : []),
        ]) as Record<string, string>,
      }
    : payload;

  const lecture: LectureAJuger = {
    payload: payloadJuge,
    imprime: (champ) => imprime.get(champ)?.join(" ") ?? null,
    titre: haut.length > 0 ? haut.map((t) => t.text).join(" ") : null,
    sensDit,
    date: datePiece,
    recueLe: piece.recue_le,
    confianceParChamp: extraction.confiance_par_champ ?? {},
    doublonDe: piece.doublon_de,
  };

  // Tous les taux en vigueur à la date de la pièce : ceux que la lecture
  // nomme, et ceux parmi lesquels un taux non lu se retrouve.
  const { rows: taux } = await db.query<{ code: string; rate: string }>(
    `select distinct on (code) code, rate from ref.tva_rates
      where pack_version_id = $1 and valid_from <= $2::date
        and (valid_to is null or valid_to >= $2::date)
      order by code, valid_from desc`,
    [pack, dateRef],
  );

  // Les droits fixés par le paramétrage (le droit de timbre…) : leur valeur
  // attendue ancre l'échelle des montants quand l'égalité la laisse ouverte.
  const codesDroits = [
    ...new Set(
      (payload.other_charges ?? []).map((d) => d.code).filter((c): c is string => Boolean(c)),
    ),
  ];
  const { rows: fixes } = await db.query<{
    code: string;
    fixed_amount: string | null;
    taxable: boolean;
  }>(
    `select distinct on (code) code, fixed_amount, taxable from ref.fiscal_charges
      where pack_version_id = $1 and code = any($2)
        and (document_kind = $3 or document_kind is null)
        and valid_from <= $4::date and (valid_to is null or valid_to >= $4::date)
      order by code, document_kind nulls last, valid_from desc`,
    [pack, codesDroits, sensRetenu(lecture), dateRef],
  );

  // La clé de doublon, rangée avec le jugement : la file du cabinet la relit
  // au moment où elle est lue (`app.doublon_probable`), quel que soit l'ordre
  // des lectures. Le jugement pose la même règle, avec cette clé-ci.
  const refs = payloadJuge.references ?? {};
  const cle = cleDeDoublon(
    {
      emetteurIdentifiantFiscal: refs[NOM_MATRICULE_EMETTEUR] ?? null,
      emetteurNom: payload.issuer || null,
      numero: refs["numero"] ?? null,
      date: datePiece,
      ttc: payload.totals?.ttc ?? null,
    },
    formatDuMatricule,
  );

  const [{ rows: types }, { rows: mentions }, { rows: semblables }, regles] = await Promise.all([
    db.query<{ code: string; porte_ecriture: boolean }>(
      `select code, porte_ecriture from ref.document_types`,
    ),
    db.query<{ code: string; label: string }>(
      `select code, label from ref.mentions where pack_version_id = $1 and mandatory`,
      [pack],
    ),
    db.query<{ id: string | null }>(`select app.doublon_probable_de($1, $2, $3, $4) as id`, [
      pieceId,
      cle.numero,
      cle.mf,
      cle.lu,
    ]),
    versionDuJugement(db),
  ]);

  // Les réglages du cabinet, au jour de la pièce : le dossier, son cabinet, le pack.
  const reglages = await lireLesReglagesComptables(db, piece.tenant_id, pack, dateRef);
  const referentielDuJugement: ReferentielDuJugement = {
    parametres: p,
    // La devise de la PIÈCE se décide au jugement (`deviseDeLaPiece`).
    devises: await lireLesDevises(db),
    titres: await lireLesTitres(db),
    biensImmobilisables: await lireLesBiensImmobilisables(db, pack, dateRef),
    exclusionsDeDeduction: await lireLesExclusionsDeDeduction(db, pack, dateRef),
    // Le seuil du cabinet, au jour de la pièce : le dossier, son cabinet, le
    // pack ; TTC pour un dossier non assujetti, dont la TVA est un coût.
    immobilisation: reglageDImmobilisation(reglages, {
      pack,
      jour: dateRef,
      nonAssujetti: await nonAssujetti(db, piece.tenant_id),
    }),
    // L'avoir lié à sa facture, ou refusé : le réglage du dossier.
    avoirs: reglageDesAvoirs(reglages, { pack, jour: dateRef }),
    taux: new Map(taux.map((t) => [t.code, t.rate])),
    deviseDuDossier: org.currency,
    droitsFixes: new Map(
      fixes.flatMap((f) => (f.fixed_amount === null ? [] : [[f.code, f.fixed_amount] as const])),
    ),
    droitsTaxables: new Set(fixes.filter((f) => f.taxable).map((f) => f.code)),
    tenant: { nom: org.name, identifiantFiscal: org.legal_id },
    typesDocument: types.map((t) => ({ code: t.code, porteEcriture: t.porte_ecriture })),
    mentionsObligatoires: mentions.map((m) => ({ code: m.code, libelle: m.label })),
    doublonProbable: semblables[0]?.id ?? null,
    change: null,
    formatDuMatricule,
  };
  /*
   * La pièce se juge d'abord sans le change ; c'est le jugement qui décide de
   * sa devise. Dans la devise du dossier, c'est fini : la règle de change
   * n'est pas même lue (revue de #148 — une règle incomplète arrêtait toute
   * pièce). En devise, la règle du dossier et le cours de chaque devise
   * entrent, et la pièce se juge sur le cours qui la convertira.
   */
  const sansChange = jugerLaLecture(lecture, referentielDuJugement);
  const devise = sansChange.normalisation.devise;
  const { normalisation, controles, verdict, motifs } =
    !devise || devise === org.currency
      ? sansChange
      : jugerLaLecture(lecture, {
          ...referentielDuJugement,
          change: await lireLeChange(db, {
            dossier: piece.tenant_id,
            deviseDuDossier: org.currency,
            pack,
            jourDuParametrage: dateRef,
            datePiece,
            recueLe: piece.recue_le,
          }),
        });

  return {
    tenantId: piece.tenant_id,
    pieceId,
    extractionId: extraction.id,
    pack,
    regles,
    normalisation,
    controles,
    verdict,
    motifs,
    cle,
  };
}

/**
 * Le jugement au journal d'observabilité : le verdict, l'état des montants et
 * ce que le Socle en retient, et les lignes qui le portent (`capture.analyses`,
 * `capture.extractions`) — référencées, pas recopiées. Écrit hors de la
 * transaction : une analyse annulée ensuite se lit par l'étape `rpc` en erreur.
 */
async function tracerLeJugement(
  db: Requete,
  j: JugementDeLaPiece,
  analyseId: string,
  champs: { chemin: "analyse" | "rejeu"; change?: boolean; essai?: boolean },
): Promise<void> {
  const devise = j.normalisation.devise ?? null;
  const exposant = devise ? await exposantDeLaDevise(db, devise) : null;
  const m = j.normalisation.montants;
  const enDecimales = (v: number | null) =>
    v === null || exposant === null ? null : depuisUniteMineure(v, exposant);
  const bases = m.bases.map((b) => b.ht).filter((v): v is number => v !== null);
  consigner("jugement", "ok", {
    cle: `${j.pieceId}:${analyseId}`,
    piece: j.pieceId,
    detail: {
      chemin: champs.chemin,
      analyse_id: analyseId,
      extraction_id: j.extractionId,
      verdict: j.verdict,
      etat: j.normalisation.etat,
      devise,
      base_ht: bases.length > 0 ? enDecimales(bases.reduce((a, b) => a + b, 0)) : null,
      tva: enDecimales(m.tva),
      ttc: enDecimales(m.ttc),
      change: champs.change ?? null,
      essai: champs.essai ?? null,
    },
  });
}

async function poserLeJugement(db: Requete, j: JugementDeLaPiece): Promise<Analyse> {
  // La porte tire le dossier de la pièce et refuse une lecture d'une autre.
  const { rows: poses } = await db.query<{ id: string }>(
    `select public.analyse_poser($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9, $10,
                                 $11) as id`,
    [
      j.pieceId,
      j.extractionId,
      j.pack,
      JSON.stringify(j.normalisation),
      JSON.stringify(j.controles),
      j.verdict,
      JSON.stringify(j.motifs),
      j.cle.numero,
      j.cle.mf,
      j.cle.lu,
      j.regles,
    ],
  );

  const { verdict, motifs, controles, normalisation } = j;
  return { id: poses[0]!.id, verdict, motifs, controles, normalisation };
}
