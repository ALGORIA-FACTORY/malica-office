/**
 * Moteur d'amortissement — déterministe, sans réseau, sans base.
 * Durées, coefficients dégressifs et décimales viennent du pack (paramètres),
 * jamais d'une constante TypeScript.
 */
import { D, Decimal, toFixedStr } from "../../domain/decimal";
import type {
  AmortissementLigne,
  AmortissementV1,
  CessionV1,
  DepreciationV1,
} from "../../contracts/amortissement.v1";

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
