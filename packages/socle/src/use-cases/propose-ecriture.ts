/**
 * Cas d'usage : proposer l'écriture d'une pièce lue.
 * Le calcul est intégralement délégué au Socle ; ce module n'assemble que les
 * données du référentiel (taux, imputations) et traduit la sortie du moteur
 * en lignes persistables. Aucune valeur monétaire n'est produite ici.
 */

import { computePivot } from "../index.ts";
import { composerLibelle } from "../engines/libelle.ts";
import { faitsDuLibelle } from "./libelle-de-piece.ts";
import type { ExtractV1 as ExtractV1Type } from "../contracts/extract.v1.ts";
import { ExtractV1 } from "../contracts/extract.v1.ts";
import type { PivotV1 } from "../contracts/pivot.v1.ts";
import type { AccountMapping, FiscalCharge, TaxRate } from "../ports/repositories.ts";

/*
 * ==================== LES DECIMALES D'UNE DEVISE VIENNENT DU PACK, PAS D'ICI
 *
 * Une table de six codes vivait ici — TND 3, EUR 2, XOF 0 — avec un repli
 * implicite a 2. R4 nomme le « code devise » parmi les interdits, et son
 * corollaire interdit le repli implicite, pour une raison que ce cas
 * illustre : une juridiction a 2 decimales affichait un dinar la ou il y
 * avait un millime, sans aucune erreur. Plausible et faux.
 *
 * `ref.socle_params` porte `money.decimals` depuis le 25 aout, et
 * `referentiel.socleParams` LEVE une erreur explicite quand il manque. Cinq
 * chemins vivants appelaient la table d'ici plutot que lui.
 *
 * Le parametre est donc desormais exige. Une proposition sans decimales est
 * une proposition dont on ne sait pas lire les montants : mieux vaut s'en
 * apercevoir a l'appel qu'a la balance.
 */

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
  /**
   * Les paramètres lus au paramétrage daté. EXIGÉS.
   *
   * Ils étaient facultatifs, et l'on retombait sur une table de six devises
   * et sur les seuils 0,7 / 0,4 écrits ici. Les trois valeurs existent en
   * base depuis le 25 août et le 18 septembre, aux mêmes chiffres — donc
   * deux sources pour la même vérité, qui pouvaient diverger sans qu'aucune
   * épreuve ne le dise. R4 interdit le seuil et le code devise en
   * TypeScript, et son corollaire interdit le repli implicite.
   *
   * Un appel sans eux est refusé plutôt que deviné : mieux vaut s'en
   * apercevoir à l'appel qu'à la balance.
   */
  parametres: { decimals: number; confianceReserve: number; confianceBloquante: number };
}): ProposalResult {
  const lu = ExtractV1.safeParse(params.payload);
  if (!lu.success) {
    // Dédoublonné et ordonné : deux erreurs sur `lines` ne font qu'un manque.
    const champs = [...new Set(lu.error.issues.map((i) => champMetier(i.path)))].sort();
    throw new LectureIncomplete(champs);
  }
  const extract = lu.data;
  const decimals = params.parametres.decimals;
  const firstTaxCode = extract.lines[0]?.tax_code ?? null;

  const mapping =
    params.mappings.find(
      (m) => m.documentKind === extract.document_kind && m.taxCode === firstTaxCode,
    ) ??
    params.mappings.find((m) => m.documentKind === extract.document_kind && m.taxCode === null) ??
    params.mappings.find((m) => m.documentKind === extract.document_kind);

  if (!mapping) throw new Error("MISSING_ACCOUNT_MAPPING");

  /*
   * ================================= LE JOURNAL VIENT DU PACK, OU L'ON REFUSE
   *
   * Il était écrit ici : `document_kind === "facture_achat" ? "ACH" : "VEN"`.
   * Un code de journal appartient au plan de l'organisation, pas au produit
   * (R4), et `ref.journals` en porte quatre depuis le 31 août 2026 sans que
   * rien ne les lise.
   *
   * Son absence LÈVE. R4, corollaire : aucun repli implicite. Une écriture
   * rangée dans un journal inventé est une écriture qu'aucun grand-livre ne
   * retrouve, et le défaut ne se voit qu'à la clôture.
   */
  const journalDuPack = mapping.journalCode;
  if (!journalDuPack) throw new Error("MISSING_JOURNAL");

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

    /*
     * Le compte de TVA par code, quand le pack en distingue. Le mapping choisi
     * plus haut l'est par le PREMIER code de taxe : sans cette table, la TVA
     * d'un second taux partirait sur le compte du premier.
     */
    vat_accounts_by_tax_code: Object.fromEntries(
      params.mappings
        .filter((m) => m.documentKind === extract.document_kind && m.taxCode !== null)
        .map((m) => [m.taxCode as string, m.vatAccount]),
    ),

    tolerances: {
      rounding_tolerance: (1 / 10 ** decimals).toFixed(decimals),
      confidence_orange: params.parametres.confianceReserve,
      confidence_red: params.parametres.confianceBloquante,
    },
  });

  return {
    pivot,
    extract,
    journal: journalDuPack,
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
        /*
         * Le code vient de la LIGNE, et non plus du premier code de la pièce.
         *
         * Il était posé ainsi : `l.account_code === mapping.vatAccount ?
         * firstTaxCode : null`. Sur une facture à deux taux, le moteur rendait
         * une seule ligne de TVA — la somme — et elle recevait le code du
         * premier taux. Toute la TVA d'une facture de restaurant partait donc
         * à 7 %, ou à 19 % selon l'ordre des lignes, sans que rien ne le dise.
         */
        tax_code: l.tax_code ?? null,
      })),
  };
}
