import type { EcheanceV1 } from "../../contracts/echeance.v1";

/**
 * Un "pack de juridiction" décrit les échéances déclaratives récurrentes.
 * Les dates sont dérivées algorithmiquement (jour du mois, mois offset, etc.).
 * Aucune donnée réglementaire n'est en dur : les packs sont chargés depuis
 * la base (socle/juridictions/*).
 */
export interface JurisdictionRule {
  kind: string; // "TVA_MENSUELLE", "IS_ACOMPTE_T1", ...
  label: string;
  cadence: "monthly" | "quarterly" | "yearly";
  // pour monthly : jour du mois suivant ; pour quarterly : jour du mois suivant le trimestre.
  day_of_month: number;
  month_offset: number; // combien de mois après la période de référence
  legal_reference?: string;
}

export interface JurisdictionPack {
  jurisdiction: string;
  rules: readonly JurisdictionRule[];
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** Découpe une période "YYYY-MM" (ou "YYYY") de façon totale, sans indexation optionnelle. */
function parsePeriod(period: string): { year: number; month: number } {
  const parts = period.split("-");
  const year = Number(parts[0]);
  const month = parts.length > 1 ? Number(parts[1]) : 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error(`Période invalide: ${period}`);
  }
  return { year, month };
}

function addMonths(period: string, offset: number): { year: number; month: number } {
  const { year, month } = parsePeriod(period);
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Retourne les échéances applicables pour une période donnée. */
export function computeEcheances(pack: JurisdictionPack, period: string): EcheanceV1[] {
  const list: EcheanceV1[] = [];
  for (const rule of pack.rules) {
    if (rule.cadence === "monthly") {
      const t = addMonths(period, rule.month_offset);
      list.push({
        contract: "echeance.v1",
        jurisdiction: pack.jurisdiction,
        kind: rule.kind,
        label: rule.label,
        period,
        due_date: `${t.year}-${pad(t.month)}-${pad(rule.day_of_month)}`,
        legal_reference: rule.legal_reference,
      });
    } else if (rule.cadence === "quarterly") {
      const { month } = parsePeriod(period);
      if (month % 3 !== 0) continue; // seulement à fin de trimestre

      const t = addMonths(period, rule.month_offset);
      list.push({
        contract: "echeance.v1",
        jurisdiction: pack.jurisdiction,
        kind: rule.kind,
        label: rule.label,
        period,
        due_date: `${t.year}-${pad(t.month)}-${pad(rule.day_of_month)}`,
        legal_reference: rule.legal_reference,
      });
    } else if (rule.cadence === "yearly") {
      const { year } = parsePeriod(period);
      const t = addMonths(`${year + 1}-01`, rule.month_offset);
      list.push({
        contract: "echeance.v1",
        jurisdiction: pack.jurisdiction,
        kind: rule.kind,
        label: rule.label,
        period: `${year}`,

        due_date: `${t.year}-${pad(t.month)}-${pad(rule.day_of_month)}`,
        legal_reference: rule.legal_reference,
      });
    }
  }
  return list;
}
