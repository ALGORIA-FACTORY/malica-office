/**
 * Moteur d'amortissement — déterministe, sans réseau, sans base.
 * Durées, coefficients dégressifs et décimales viennent du pack (paramètres),
 * jamais d'une constante TypeScript.
 */
import { D, Decimal, toFixedStr } from "../../domain/decimal.ts";
import type {
  AmortissementLigne,
  AmortissementV1,
  CessionV1,
  DepreciationV1,
} from "../../contracts/amortissement.v1.ts";

export interface AmortissementParams {
  currency: string;
  decimals: number;
  method: "lineaire" | "degressif";
  /** Durée d'usage, en années, issue du pack. */
  dureeAnnees: number;
  /** Coefficient dégressif issu du pack ; "1" pour le linéaire. */
  coefficient: string;
  valeurBrute: string;
  valeurResiduelle: string;
  /** Date de mise en service — prorata au mois entamé. */
  miseEnService: string;
}

export class AmortissementParamsInvalid extends Error {}

function parseDate(iso: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new AmortissementParamsInvalid(`Date invalide: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Plan d'amortissement annuel, prorata temporis au mois.
 * Le dégressif bascule en linéaire sur la durée restante dès que celui-ci
 * devient plus favorable — règle de calcul, pas règle fiscale.
 */
export function computeAmortissement(params: AmortissementParams): AmortissementV1 {
  const { decimals, dureeAnnees } = params;
  if (dureeAnnees <= 0) throw new AmortissementParamsInvalid("Durée invalide");
  if (decimals < 0) throw new AmortissementParamsInvalid("Décimales invalides");

  const brute = D(params.valeurBrute);
  const residuelle = D(params.valeurResiduelle);
  if (residuelle.gt(brute)) {
    throw new AmortissementParamsInvalid("Valeur résiduelle supérieure à la valeur brute");
  }

  const amortissable = brute.minus(residuelle);
  const start = parseDate(params.miseEnService);
  const tauxLineaire = D(1).div(dureeAnnees);
  const coefficient = D(params.coefficient);

  const lignes: AmortissementLigne[] = [];
  let cumul = D(0);
  let restant = amortissable;

  // Nombre d'exercices touchés : durée + 1 si la mise en service est en cours d'année.
  const exercices = start.month === 1 ? dureeAnnees : dureeAnnees + 1;

  for (let i = 0; i < exercices; i += 1) {
    const year = start.year + i;
    const firstMonth = i === 0 ? start.month : 1;
    const months = 12 - firstMonth + 1;
    const prorata = D(months).div(12);

    const anneesRestantes = Math.max(1, exercices - i - (start.month === 1 ? 0 : 1));
    const tauxDegressif = tauxLineaire.times(coefficient);
    const tauxRattrapage = D(1).div(anneesRestantes);

    let base: Decimal;
    let taux: Decimal;
    if (params.method === "degressif") {
      base = amortissable.minus(cumul);
      taux = tauxDegressif.gte(tauxRattrapage) ? tauxDegressif : tauxRattrapage;
    } else {
      base = amortissable;
      taux = tauxLineaire;
    }

    let dotation = base.times(taux).times(prorata);
    if (dotation.gt(restant)) dotation = restant;
    if (i === exercices - 1) dotation = restant;
    if (dotation.lt(0)) dotation = D(0);

    cumul = cumul.plus(dotation);
    restant = amortissable.minus(cumul);

    lignes.push({
      exercice: year,
      from: `${year}-${pad(firstMonth)}-01`,
      to: `${year}-12-${pad(lastDay(year, 12))}`,
      months,
      base: toFixedStr(base, decimals),
      taux: toFixedStr(taux, 6),
      dotation: toFixedStr(dotation, decimals),
      cumul: toFixedStr(cumul, decimals),
      vnc: toFixedStr(brute.minus(cumul), decimals),
    });

    if (restant.lte(0)) break;
  }

  return {
    contract: "amortissement.v1",
    currency: params.currency,
    method: params.method,
    duree_annees: dureeAnnees,
    coefficient: toFixedStr(coefficient, 6),
    valeur_brute: toFixedStr(brute, decimals),
    valeur_residuelle: toFixedStr(residuelle, decimals),
    mise_en_service: params.miseEnService,
    lignes,
    totals: {
      dotations: toFixedStr(cumul, decimals),
      vnc_finale: toFixedStr(brute.minus(cumul), decimals),
    },
  };
}

/** Cumul des dotations jusqu'à une date incluse. */
export function cumulAt(plan: AmortissementV1, at: string): string {
  const target = parseDate(at);
  let cumul = "0";
  for (const l of plan.lignes) {
    if (l.exercice <= target.year) cumul = l.cumul;
  }
  return cumul;
}

/**
 * Ce que le plan dit d'un bien qui sort (cession, mise au rebut) à une date.
 *
 * La dotation de l'exercice de sortie court jusqu'au mois de sortie INCLUS —
 * le mois entamé compte, comme à la mise en service (`computeAmortissement`).
 * Elle est la part de la dotation annuelle du plan, au prorata des mois :
 * aucun taux n'est recalculé, la règle de l'exercice reste celle du plan.
 * Après la fin du plan, le bien est amorti : rien à doter. Avant la mise en
 * service, il n'existe pas.
 *
 * `cumul` est le cumul des dotations à la sortie, exercice par exercice
 * arrondi — la porte `immo_sortir` le compare à ce que les livres portent, et
 * refuse si un exercice manque.
 *
 * INCERTAIN (à confirmer par un expert-comptable) : le mois de sortie inclus.
 * Certains cabinets dotent au jour près.
 */
export function sortieDuPlan(
  plan: AmortissementV1,
  at: string,
  decimals: number,
): { exercice: number; mois: number; dotation: string; cumul: string; vncAmortie: string } {
  const sortie = parseDate(at);
  if (at < plan.mise_en_service) {
    throw new AmortissementParamsInvalid("Sortie avant la mise en service");
  }
  const brute = D(plan.valeur_brute);
  const ligne = plan.lignes.find((l) => l.exercice === sortie.year);
  // Le cumul des dotations ARRONDIES de chaque exercice — ce que les livres
  // portent —, pas le cumul du plan, arrondi à part : 33,333 + 33,333 font
  // 66,666 au grand livre quand le plan dit 66,667 (revue de #249).
  const cumulAvant = plan.lignes
    .filter((l) => l.exercice < sortie.year)
    .reduce((t, l) => t.plus(D(l.dotation)), D(0));
  if (!ligne) {
    return {
      exercice: sortie.year,
      mois: 0,
      dotation: toFixedStr(D(0), decimals),
      cumul: toFixedStr(cumulAvant, decimals),
      vncAmortie: toFixedStr(brute.minus(cumulAvant), decimals),
    };
  }
  const premierMois = parseDate(ligne.from).month;
  const mois = Math.min(ligne.months, sortie.month - premierMois + 1);
  const dotation = D(ligne.dotation).times(mois).div(ligne.months);
  const cumul = cumulAvant.plus(D(toFixedStr(dotation, decimals)));
  return {
    exercice: sortie.year,
    mois,
    dotation: toFixedStr(dotation, decimals),
    cumul: toFixedStr(cumul, decimals),
    vncAmortie: toFixedStr(brute.minus(cumul), decimals),
  };
}

/** Dépréciation ou reprise : la VNC est comparée à la valeur recouvrable. */
export function computeDepreciation(input: {
  currency: string;
  decimals: number;
  at: string;
  vnc: string;
  valeurRecouvrable: string;
  cumulAvant: string;
}): DepreciationV1 {
  const vnc = D(input.vnc);
  const recouvrable = D(input.valeurRecouvrable);
  const cumulAvant = D(input.cumulAvant);
  const perte = vnc.minus(recouvrable);
  // Une reprise ne peut excéder la dépréciation déjà constatée.
  const mouvement = perte.lt(0) && perte.abs().gt(cumulAvant) ? cumulAvant.negated() : perte;

  return {
    contract: "depreciation.v1",
    currency: input.currency,
    at: input.at,
    vnc: toFixedStr(vnc, input.decimals),
    valeur_recouvrable: toFixedStr(recouvrable, input.decimals),
    mouvement: toFixedStr(mouvement, input.decimals),
    cumul_apres: toFixedStr(cumulAvant.plus(mouvement), input.decimals),
  };
}

/** Cession : résultat = prix - VNC à la date de sortie. */
export function computeCession(input: {
  currency: string;
  decimals: number;
  at: string;
  prix: string;
  vnc: string;
}): CessionV1 {
  const prix = D(input.prix);
  const vnc = D(input.vnc);
  return {
    contract: "cession.v1",
    currency: input.currency,
    at: input.at,
    prix: toFixedStr(prix, input.decimals),
    vnc: toFixedStr(vnc, input.decimals),
    resultat: toFixedStr(prix.minus(vnc), input.decimals),
  };
}

/**
 * VNC nette de dépréciation : la valeur nette comptable amortie diminuée du
 * cumul de dépréciations déjà constatées. Arithmétique du Socle, jamais du front.
 */
export function vncNette(input: {
  decimals: number;
  vncAmortie: string;
  cumulDepreciation: string;
}): string {
  const v = D(input.vncAmortie).minus(D(input.cumulDepreciation));
  return toFixedStr(v.lt(0) ? D(0) : v, input.decimals);
}
