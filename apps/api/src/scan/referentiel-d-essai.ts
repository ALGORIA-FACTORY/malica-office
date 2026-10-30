/**
 * Le référentiel tunisien des épreuves pures : ce que le pack `TN 2026.1` porte
 * pour juger une pièce et en proposer l'écriture, recopié pour que la mesure
 * des propositions (`mesure-des-propositions.test.ts`) tourne sans base.
 *
 * Une copie peut dériver : `le-referentiel-d-essai-dit-vrai.test.ts` relit le
 * pack en base, sous l'identité d'un vrai compte, et échoue au premier écart —
 * taux, comptes, journaux, droits fixés, paramètres. Les libellés n'y sont pas
 * comparés : aucune mesure ne les lit.
 *
 * Sources : migrations `20260824132104` (taux, imputations, mentions),
 * `20260825213940` et `20260918130000` (paramètres), `20260826133602`
 * (droit de timbre), `20261012240000` (journaux, écart de dates),
 * `20261019150000` (FODEC), `20260902180000` (types de pièces).
 */
import type { AccountMapping, FiscalCharge, TaxRate } from "@malica/socle/ports/repositories";

import { MARQUES_D_ESSAI } from "./devise-d-essai.ts";

type Sens = "facture_achat" | "facture_vente";

export const TAUX_D_ESSAI: TaxRate[] = (
  [
    ["TVA19", "0.1900"],
    ["TVA13", "0.1300"],
    ["TVA07", "0.0700"],
    ["EXO", "0.0000"],
    ["EXPORT", "0.0000"],
  ] as const
).map(([code, rate]) => ({
  code,
  label: code,
  rate,
  validFrom: "2026-01-01",
  validTo: null,
  jurisdiction: "TN",
}));

export const IMPUTATIONS_D_ESSAI: Array<AccountMapping & { documentKind: Sens }> =
  TAUX_D_ESSAI.flatMap((t) => [
    {
      documentKind: "facture_achat" as const,
      taxCode: t.code,
      mainAccount: "601",
      vatAccount: "4366",
      counterpartyAccount: "401",
      journalCode: "ACH",
    },
    {
      documentKind: "facture_vente" as const,
      taxCode: t.code,
      mainAccount: "701",
      vatAccount: "4367",
      counterpartyAccount: "411",
      journalCode: "VEN",
    },
  ]);

export const DROITS_D_ESSAI: Array<FiscalCharge & { documentKind: Sens }> = [
  {
    code: "DROIT_TIMBRE",
    label: "Droit de timbre",
    documentKind: "facture_vente",
    accountCode: "4368",
    fixedAmount: "1.000",
    legalReference: null,
  },
  {
    code: "DROIT_TIMBRE",
    label: "Droit de timbre",
    documentKind: "facture_achat",
    accountCode: "665",
    fixedAmount: "1.000",
    legalReference: null,
  },
  {
    code: "FODEC",
    label: "FODEC",
    documentKind: "facture_vente",
    accountCode: "4374",
    fixedAmount: null,
    legalReference: null,
  },
  {
    code: "FODEC",
    label: "FODEC",
    documentKind: "facture_achat",
    accountCode: "6652",
    fixedAmount: null,
    legalReference: null,
  },
];

/** Les paramètres de lecture du pack, au 1er janvier 2026. */
export const PARAMETRES_D_ESSAI = {
  "money.decimals": 3,
  "lecture.confiance_reserve": 0.7,
  "lecture.confiance_bloquante": 0.4,
  "lecture.tolerance_arrondi_mineure": 1,
  "piece.ecart_date_jours": 60,
};

/** Les mentions obligatoires du pack (`ref.mentions … mandatory`). */
export const MENTIONS_D_ESSAI = [
  "IDENT_FISCAL_EMETTEUR",
  "IDENT_FISCAL_CLIENT",
  "DATE_FACTURE",
  "NUMERO_SEQUENTIEL",
  "DESIGNATION",
  "BASE_HT",
  "TAUX_TVA",
  "MONTANT_TVA",
  "TOTAL_TTC",
  "TIMBRE_FISCAL",
].map((code) => ({ code, libelle: code }));

/** `ref.devises` : le nombre de décimales de chaque devise (migration `20261023110000`). */
export const EXPOSANTS_D_ESSAI: Readonly<Record<string, number>> = { TND: 3, XOF: 0, EUR: 2 };

/** Les deux types qui portent une écriture ; les autres n'en portent pas. */
export const TYPES_D_ESSAI = [
  { code: "facture_achat", porteEcriture: true },
  { code: "facture_vente", porteEcriture: true },
];

export { MARQUES_D_ESSAI };
