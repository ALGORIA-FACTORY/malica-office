/**
 * Cas d'usage : proposer l'écriture d'une pièce lue.
 * Le calcul est intégralement délégué au Socle ; ce module n'assemble que les
 * données du référentiel (taux, imputations) et traduit la sortie du moteur
 * en lignes persistables. Aucune valeur monétaire n'est produite ici.
 */

import { computePivot } from "../socle";
import { composerLibelle } from "../socle/engines/libelle";
import { faitsDuLibelle } from "./libelle-de-piece";
import type { ExtractV1 as ExtractV1Type } from "../socle/contracts/extract.v1";
import { ExtractV1 } from "../socle/contracts/extract.v1";
import type { PivotV1 } from "../socle/contracts/pivot.v1";
import type { AccountMapping, FiscalCharge, TaxRate } from "../ports/repositories";

/** Décimales ISO 4217 (norme monétaire, pas une règle fiscale). */
const ISO_DECIMALS: Record<string, number> = { TND: 3, EUR: 2, USD: 2, LYD: 3, MAD: 2, XOF: 0 };

export function currencyDecimals(code: string): number {
  return ISO_DECIMALS[code.toUpperCase()] ?? 2;
}

export interface ProposalResult {
  pivot: PivotV1;
  extract: ExtractV1Type;
  journal: string;
  /**
   * Le libellé de l’écriture, composé.
   *
   * Il portait le seul nom de l’émetteur : deux factures du même fournisseur
   * dans le même mois donnaient deux écritures indiscernables en balance.
   * Il porte maintenant nature, contrepartie, référence et date — la forme que
   * SAF-T, le FEC et ISO 21378 demandent en substance.
   */
  libelle: string;
  lignes: Array<{
    account_code: string;
    libelle: string;
    debit: string;
    credit: string;
    tax_code: string | null;
  }>;
}

/**
 * La lecture n'a pas tout trouvé — et l'écriture ne peut donc pas être proposée.
 *
 * ============================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * L'utilisateur voyait ceci, en anglais, au milieu d'un écran français :
 *
 *   [{"validation":"regex","code":"invalid_string",
 *     "message":"Date ISO YYYY-MM-DD requise","path":["document_date"]}]
 *
 * C'était le message brut d'un `ZodError`, affiché tel quel. La lecture avait
 * pourtant réussi : l'émetteur, les lignes, les totaux étaient là. Seule la
 * date manquait — et la pièce restait bloquée sans qu'on sache pourquoi.
 *
 * ===================================================== POURQUOI ON REFUSE QUAND MÊME
 *
 * Le Socle a raison de s'arrêter : sans date, aucun taux de TVA ne peut être
 * retrouvé, et une écriture datée au hasard est une écriture fausse. C'est la
 * règle R2 — on n'invente jamais une valeur.
 *
 * Ce qui était fautif n'est pas le refus : c'est la MANIÈRE de refuser. On
 * nomme donc les champs manquants en langage métier, et l'écran demande à
 * l'utilisateur de les compléter.
 */
export class LectureIncomplete extends Error {
  /** Les champs manquants, en clés métier — jamais des chemins de schéma. */
  readonly champs: readonly string[];

  constructor(champs: readonly string[]) {
    super(`lecture incomplète : ${champs.join(", ")}`);
    this.name = "LectureIncomplete";
    this.champs = champs;
  }
}

/**
 * Du chemin d'un schéma vers un nom que l'utilisateur reconnaît.
 *
 * `document_date` ne veut rien dire pour un dirigeant de PME ; « la date de la
 * facture », si. Un chemin inconnu retombe sur sa racine plutôt que d'être tu :
 * mieux vaut un nom technique isolé qu'un champ manquant passé sous silence.
 */
export function champMetier(chemin: readonly (string | number)[]): string {
  const noms: Record<string, string> = {
    document_date: "date",
    issuer: "emetteur",
    currency: "devise",
    lines: "lignes",
    totals: "totaux",
    document_kind: "type",
  };
  const racine = String(chemin[0] ?? "");
  return noms[racine] ?? racine;
}

export function buildProposal(params: {
  pieceId: string;
  payload: unknown;
  taxRates: readonly TaxRate[];
  mappings: readonly AccountMapping[];
  fiscalCharges?: readonly FiscalCharge[];
  currency: string;
}): ProposalResult {
  const lu = ExtractV1.safeParse(params.payload);
  if (!lu.success) {
    // Dédoublonné et ordonné : deux erreurs sur `lines` ne font qu'un manque.
    const champs = [...new Set(lu.error.issues.map((i) => champMetier(i.path)))].sort();
    throw new LectureIncomplete(champs);
  }
  const extract = lu.data;
  const decimals = currencyDecimals(extract.currency || params.currency);
  const firstTaxCode = extract.lines[0]?.tax_code ?? null;

  const mapping =
    params.mappings.find(
      (m) => m.documentKind === extract.document_kind && m.taxCode === firstTaxCode,
    ) ??
    params.mappings.find((m) => m.documentKind === extract.document_kind && m.taxCode === null) ??
    params.mappings.find((m) => m.documentKind === extract.document_kind);

  if (!mapping) throw new Error("MISSING_ACCOUNT_MAPPING");

  const pivot = computePivot({
    extract,
    source_item_id: params.pieceId,
    tenant_currency: { code: extract.currency, decimals },
    tax_rates: params.taxRates.map((r) => ({
      code: r.code,
      label: r.label,
      rate: r.rate,
      valid_from: r.validFrom,
      valid_to: r.validTo,
      jurisdiction: r.jurisdiction,
    })),
    mapping: {
      document_kind: extract.document_kind,
      charge_or_product_account: mapping.mainAccount,
      vat_account: mapping.vatAccount,
      counterparty_account: mapping.counterpartyAccount,
    },
    fiscal_charges: (params.fiscalCharges ?? [])
      .filter((c) => c.documentKind === extract.document_kind)
      .map((c) => ({
        code: c.code,
        label: c.label,
        account_code: c.accountCode,
        document_kind: c.documentKind,
        fixed_amount: c.fixedAmount,
      })),

    tolerances: {
      rounding_tolerance: (1 / 10 ** decimals).toFixed(decimals),
      confidence_orange: 0.7,
      confidence_red: 0.4,
    },
  });

  return {
    pivot,
    extract,
    journal: extract.document_kind === "facture_achat" ? "ACH" : "VEN",
    libelle: composerLibelle(faitsDuLibelle(extract)),
    // Une ligne nulle (TVA à zéro sur pièce exonérée) ne porte aucun fait
    // comptable : la base l'interdit, on ne la persiste pas. Le pivot du Socle
    // reste intact — c'est la seule vue persistée qui est filtrée.
    lignes: pivot.lines
      .filter((l) => Number(l.debit) !== 0 || Number(l.credit) !== 0)
      .map((l) => ({
        account_code: l.account_code,
        libelle: l.label,
        debit: l.debit,
        credit: l.credit,
        tax_code: l.account_code === mapping.vatAccount ? firstTaxCode : null,
      })),
  };
}
