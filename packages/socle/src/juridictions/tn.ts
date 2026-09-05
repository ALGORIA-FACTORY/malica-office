/**
 * Chargeur de packs de juridiction — R4 : « un seul moteur, N juridictions ».
 *
 * Ce fichier ne contient AUCUNE donnée réglementaire : ni taux, ni compte, ni
 * seuil, ni jour d'échéance, ni référence d'article. Tout cela vit en base
 * (`ref.jurisdiction_packs`, `ref.pack_rules`, `ref.tva_rates`), versionné par
 * date d'effet. Le rôle du socle est de valider la forme des lignes reçues et
 * de refuser de calculer plutôt que d'inventer.
 *
 * Le test `no-fiscal-literals.test.ts` interdit tout littéral fiscal sous
 * `socle/juridictions/**` : ne réintroduis rien ici.
 */
import type { JurisdictionPack, JurisdictionRule } from "../engines/echeance/next.ts";

/** Ligne telle que lue depuis `ref.pack_rules`, sans hypothèse de contenu. */
export interface PackRuleRow {
  jurisdiction: string;
  kind: string;
  label: string;
  cadence: string;
  day_of_month: number;
  month_offset: number;
  legal_reference: string | null;
  valid_from: string;
  valid_to: string | null;
}

export class PackUnavailable extends Error {
  constructor(jurisdiction: string, at: string) {
    super(`Aucun pack en vigueur pour ${jurisdiction} au ${at}`);
    this.name = "PackUnavailable";
  }
}

export class PackRuleInvalid extends Error {
  constructor(reason: string) {
    super(`Règle de pack invalide : ${reason}`);
    this.name = "PackRuleInvalid";
  }
}

const CADENCES = ["monthly", "quarterly", "yearly"] as const;

function isCadence(v: string): v is JurisdictionRule["cadence"] {
  return (CADENCES as readonly string[]).includes(v);
}

/** Vraie si la ligne est en vigueur à la date donnée (bornes incluses). */
export function isInForce(row: PackRuleRow, at: string): boolean {
  return row.valid_from <= at && (row.valid_to === null || row.valid_to >= at);
}

function toRule(row: PackRuleRow): JurisdictionRule {
  if (!isCadence(row.cadence)) {
    throw new PackRuleInvalid(`cadence inconnue « ${row.cadence} » (${row.kind})`);
  }
  if (!Number.isInteger(row.day_of_month) || row.day_of_month < 1 || row.day_of_month > 31) {
    throw new PackRuleInvalid(`jour du mois hors bornes (${row.kind})`);
  }
  if (!Number.isInteger(row.month_offset) || row.month_offset < 0) {
    throw new PackRuleInvalid(`décalage de mois invalide (${row.kind})`);
  }
  const rule: JurisdictionRule = {
    kind: row.kind,
    label: row.label,
    cadence: row.cadence,
    day_of_month: row.day_of_month,
    month_offset: row.month_offset,
  };
  if (row.legal_reference !== null) rule.legal_reference = row.legal_reference;
  return rule;
}

/**
 * Construit le pack applicable à `jurisdiction` à la date `at` à partir des
 * lignes fournies par l'appelant (un repository). Lève si aucune règle n'est
 * en vigueur : un pack vide silencieux masquerait une échéance manquée.
 */
export function loadJurisdictionPack(
  rows: readonly PackRuleRow[],
  jurisdiction: string,
  at: string,
): JurisdictionPack {
  const rules = rows.filter((r) => r.jurisdiction === jurisdiction && isInForce(r, at)).map(toRule);
  if (rules.length === 0) throw new PackUnavailable(jurisdiction, at);
  return { jurisdiction, rules };
}
