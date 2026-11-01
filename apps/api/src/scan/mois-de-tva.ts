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
import type { ReglagesResolus } from "./reglages-comptables.ts";

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

/** Ce qui range une pièce dans son mois : l'option du dossier et ses natures. */
export interface ReglesDuMois {
  /** Nulle quand le pack ne porte pas le réglage : le jour reste celui de la pièce. */
  regle: OptionDuMois | null;
  natures: readonly NatureDeVente[];
}

/** Ce que la lecture du mois sait du dossier : ses règles, période par période. */
export interface MoisDeTvaDuDossier {
  /** Dans l'ordre des débuts ; chacune vaut jusqu'à la suivante. */
  periodes: ReadonlyArray<ReglesDuMois & { du: string }>;
}

/** Une valeur lue de `mois_tva.date` ; nulle (`undefined`) quand le pack ne porte pas le réglage. */
function optionLue(v: string | null | undefined): OptionDuMois | null {
  if (v === undefined) return null;
  const option = OPTIONS.find((o) => o === v);
  if (!option) throw new Error("reglage.mois_tva.illisible");
  return option;
}

/**
 * Les règles du mois du dossier, période par période : l'historique se lit
 * une fois par lecture (`app.historique_du_mois_de_tva`), puis les natures de
 * chaque période où l'option s'applique. Le coût suit le nombre de décisions
 * du cabinet et de dates d'effet du référentiel, jamais le nombre de pièces.
 *
 * POURQUOI un historique, et pas l'option au dernier jour de la fenêtre lue
 * (revue de #163, P1) : changée entre l'encaissement et la facture, l'option
 * rangeait une même pièce dans deux mois — ou dans aucun — selon le mois
 * demandé. Les règles d'une pièce se lisent au JOUR DE SA FACTURE
 * (`reglesAuJour`), la date stable la plus défendable : ni la fenêtre, ni un
 * règlement ajouté ou annulé après coup, ni une déclaration ne la déplacent ;
 * c'est la date à laquelle la proposition lit déjà les réglages (« au jour de
 * la pièce », `proposition.ts`) — la réserve que voit le cabinet et le mois où
 * la pièce pèse ne peuvent plus se contredire ; et une décision datée (R7) qui
 * prend effet après la facture ne réécrit pas une pièce antérieure.
 */
export async function leMoisDeTvaDuDossier(
  db: Requete,
  dossier: string,
): Promise<MoisDeTvaDuDossier> {
  const { rows } = await db.query<{ du: string; pack: string; regle: string | null }>(
    `select h.du::text as du, h.pack, h.regle from app.historique_du_mois_de_tva($1, $2) h`,
    [dossier, REGLAGE],
  );
  const periodes: Array<ReglesDuMois & { du: string }> = [];
  for (const h of rows) {
    // Nulle, la valeur dit que le pack ne porte pas le réglage ce jour-là.
    const regle = optionLue(h.regle ?? undefined);
    const natures = regle ? await lireLesNaturesDeVente(db, h.pack, h.du, null) : [];
    periodes.push({ du: h.du, regle, natures });
  }
  return { periodes };
}

/** Avant la première période, le dossier n'a pas de pack : le jour reste celui de la pièce. */
const SANS_REGLE: ReglesDuMois = { regle: null, natures: [] };

/** Les règles en vigueur au jour dit (date ISO, comparable en texte). */
export const reglesAuJour = (mois: MoisDeTvaDuDossier, jour: string): ReglesDuMois =>
  mois.periodes.findLast((p) => p.du <= jour) ?? SANS_REGLE;

/** Les débuts et les options des périodes, en deux tableaux pour la requête (`unnest`). */
export const periodesDeLaRequete = (mois: MoisDeTvaDuDossier) => [
  mois.periodes.map((p) => p.du),
  mois.periodes.map((p) => p.regle),
];

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
  const regle = optionLue(p.reglages.get(REGLAGE));
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
