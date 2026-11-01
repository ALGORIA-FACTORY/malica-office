/**
 * Le mois de TVA d'une pièce, par l'exigibilité (réglage `mois_tva.date`,
 * décidé par le CEO le 31 octobre 2026, appliqué le 11 novembre 2026).
 *
 * ================================================================= LA RÈGLE
 *
 * Le jour se décide en base, par UNE fonction (`app.jour_d_imputation_tva`) :
 * la même pour la TVA de la PME, celle du cabinet et la proposition. Elle rend
 * une hypothèse par exigibilité (livraison, encaissement, indécidable), parce
 * que la nature d'une pièce se reconnaît ici, par les motifs du référentiel
 * (`exigibiliteDesArticles`, les mêmes que le compte de vente) : des
 * expressions régulières de JavaScript que PostgreSQL ne lit pas.
 *
 * Aucune date, aucun mot n'est écrit ici (R4) : l'exigibilité d'une nature est
 * au référentiel (`ref.natures_de_vente.exigibilite`), la règle dans la
 * fonction, l'option au paramétrage du cabinet (R10).
 */
import type { RaisonDuMoisDeTva } from "@malica/socle/ports/repositories";

import type { Requete } from "../db.ts";

import {
  exigibiliteDesArticles,
  lireLesNaturesDeVente,
  type NatureDeVente,
} from "./nature-de-vente.ts";
import { lireLesReglagesComptables, type ReglagesResolus } from "./reglages-comptables.ts";

/** Le réglage que ce module applique, et ses deux options. */
const REGLAGE = "mois_tva.date";
const OPTIONS = ["exigibilite_calculee", "date_facture_alerte"] as const;
type OptionDuMois = (typeof OPTIONS)[number];

/** Une hypothèse de `app.jour_d_imputation_tva`. */
export interface HypotheseDuMois {
  exigibilite: string | null;
  jour: string;
  reserve: RaisonDuMoisDeTva | null;
}

/** Ce que la lecture du mois sait du dossier : son option et ses natures. */
export interface MoisDeTvaDuDossier {
  /** Nulle quand le pack ne porte pas le réglage : le jour reste celui de la pièce. */
  regle: OptionDuMois | null;
  natures: readonly NatureDeVente[];
}

/** L'option du dossier ; nulle quand le pack ne porte pas le réglage. */
function optionDuMoisDeTva(r: ReglagesResolus): OptionDuMois | null {
  const v = r.get(REGLAGE);
  if (v === undefined) return null;
  const option = OPTIONS.find((o) => o === v);
  if (!option) throw new Error("reglage.mois_tva.illisible");
  return option;
}

/**
 * L'option et les natures du dossier, au jour dit (la fin de la fenêtre lue) :
 * trois requêtes par lecture, jamais une par pièce.
 */
export async function leMoisDeTvaDuDossier(
  db: Requete,
  dossier: string,
  jour: string,
): Promise<MoisDeTvaDuDossier> {
  const { rows } = await db.query<{ pack: string | null }>(
    `select app.pack_du_dossier($1, $2::date) as pack`,
    [dossier, jour],
  );
  const pack = rows[0]?.pack ?? null;
  if (!pack) return { regle: null, natures: [] };
  const regle = optionDuMoisDeTva(await lireLesReglagesComptables(db, dossier, pack, jour));
  return { regle, natures: regle ? await lireLesNaturesDeVente(db, pack, jour, null) : [] };
}

/**
 * L'hypothèse de la nature reconnue dans les articles de la pièce, et les
 * désignations qu'aucun motif ne reconnaît. Une hypothèse absente est une
 * erreur : la fonction en rend une par exigibilité du référentiel.
 */
export function hypotheseRetenue(
  hypotheses: readonly HypotheseDuMois[],
  articles: unknown,
  natures: readonly NatureDeVente[],
): HypotheseDuMois & { inconnus: string[] } {
  const { exigibilite, inconnus } = exigibiliteDesArticles(
    Array.isArray(articles) ? (articles as Array<{ designation?: string | null }>) : [],
    natures,
  );
  const h = hypotheses.find((x) => x.exigibilite === exigibilite);
  if (!h) throw new Error("mois_tva.hypothese_absente");
  return { ...h, inconnus };
}

/** Le jour retenu est-il dans la fenêtre lue ? (dates ISO, comparables en texte) */
export const dansLaFenetre = (jour: string, from: string, to: string) => jour >= from && jour <= to;

/**
 * La réserve du mois de TVA d'une pièce à proposer : nulle quand le mois ne
 * pose pas de question. `jour` : la date de la pièce.
 */
export async function reserveDuMoisDeTva(
  db: Requete,
  p: {
    dossier: string;
    pieceId: string;
    pack: string;
    jour: string;
    reglages: ReglagesResolus;
    articles: unknown;
  },
): Promise<{ code: "mois_de_tva"; raison: RaisonDuMoisDeTva; articles: string[] } | null> {
  const regle = optionDuMoisDeTva(p.reglages);
  if (!regle) return null;
  const { rows } = await db.query<HypotheseDuMois>(
    `select h.exigibilite, h.jour::text as jour, h.reserve
       from app.jour_d_imputation_tva($1, $2, $3::date, null, $4) h`,
    [p.dossier, p.pieceId, p.jour, regle],
  );
  const natures = await lireLesNaturesDeVente(db, p.pack, p.jour, null);
  const h = hypotheseRetenue(rows, p.articles, natures);
  if (!h.reserve) return null;
  return {
    code: "mois_de_tva",
    raison: h.reserve,
    articles: h.reserve === "nature_indecidable" ? h.inconnus : [],
  };
}
