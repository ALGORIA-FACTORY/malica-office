/**
 * Cas d'usage : proposer l'écriture d'une pièce lue.
 * Le calcul est intégralement délégué au Socle ; ce module n'assemble que les
 * données du référentiel (taux, imputations) et traduit la sortie du moteur
 * en lignes persistables. Aucune valeur monétaire n'est produite ici.
 */

import { computePivot } from "../index.ts";
import { D, type Decimal, toFixedStr } from "../domain/decimal.ts";
import {
  aSaDette,
  convertirLExtrait,
  uniteALExposant,
  type ConversionFaite,
  type CoursAApplique,
} from "../engines/fx/convertir-l-extrait.ts";
import { composerLibelle } from "../engines/libelle.ts";
import { faitsDuLibelle } from "./libelle-de-piece.ts";
import type { ExtractV1 as ExtractV1Type } from "../contracts/extract.v1.ts";
import { ExtractV1 } from "../contracts/extract.v1.ts";
import type { JournalLineV1, PivotV1 } from "../contracts/pivot.v1.ts";
import type { CurrencyDef } from "../domain/types.ts";
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
 * L'exposant d'une devise se lit dans `ref.devises` (sa seule source) ; cinq
 * chemins vivants appelaient la table d'ici plutot que lui.
 *
 * Le parametre est donc desormais exige. Une proposition sans decimales est
 * une proposition dont on ne sait pas lire les montants : mieux vaut s'en
 * apercevoir a l'appel qu'a la balance.
 */

/**
 * Ce qu'une ligne convertie garde de la pièce en devise : la devise, le
 * montant de la ligne dans cette devise (du même côté), le taux pour une
 * unité et le cours appliqués. Absent sur une pièce dans la devise du dossier.
 */
export interface OrigineDeLaLigne {
  devise_origine: string;
  montant_origine: string;
  taux_de_change: string;
  cours_id: string;
}

export interface ProposalResult {
  /** L'écriture, dans la devise du DOSSIER (convertie si la pièce est en devise). */
  pivot: PivotV1;
  /** L'extrait d'où l'écriture se compose : converti, si la pièce est en devise. */
  extract: ExtractV1Type;
  /**
   * La conversion d'une pièce en devise : le cours, le taux, l'écart d'arrondi
   * et la ligne qui l'a reçu. Absente dans la devise du dossier.
   */
  conversion?: ConversionFaite;
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
  lignes: Array<
    {
      account_code: string;
      libelle: string;
      debit: string;
      credit: string;
      tax_code: string | null;
    } & Partial<OrigineDeLaLigne>
  >;
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
  /**
   * Le compte de la NATURE de la charge, quand tous les articles de la pièce
   * en partagent une (20 octobre 2026). Il remplace le compte générique du
   * paramétrage — 601 pour tout achat, honoraires et loyers compris. Absent,
   * on garde le paramétrage : une pièce mêlée ne se devine pas.
   */
  compteDeNature?: string | null;
  /**
   * L'acheteur ne déduit pas la TVA : il n'est pas assujetti (21 octobre 2026,
   * ANO-LIVE-001). La TVA payée est alors un COÛT — elle rejoint la charge, et
   * aucun compte de TVA déductible n'est débité. Le pivot, lui, reste celui de
   * la facture : il dit ce que la pièce porte.
   */
  tvaNonDeductible?: boolean;
  /**
   * Les droits hors TVA qu'un ACHAT incorpore au coût (31 octobre 2026) : le
   * réglage `fodec.traitement` du cabinet (R10). Leur ligne porte le compte de
   * la charge au lieu du compte du pack (6652) ; elle reste une ligne à part,
   * nommée, pour que le droit se retrouve. Absents : le compte du pack.
   */
  droitsAuCout?: readonly string[];
  /**
   * La pièce est en devise (31 octobre 2026) : l'écriture se compose dans la
   * devise du DOSSIER (`vers`), au cours que la règle de change désigne, et
   * l'écart d'arrondi se porte selon la règle `ecart` du référentiel
   * (`convertirLExtrait`). `currency` et `parametres.decimals` restent ceux
   * de la PIÈCE : la facture se vérifie d'abord dans sa devise.
   */
  conversion?: { vers: CurrencyDef; cours: CoursAApplique; ecart: string };
  /**
   * Le compte de chaque ligne, par nature de ce qu'une vente vend (réglage
   * `ventes.compte`, 1er novembre 2026) ou de ce qu'un achat achète (familles
   * de charges, 5 novembre 2026) : `computePivot` la pose. Une
   * part chiffrée n'est admise que dans la devise de la pièce : convertie, une
   * ventilation demanderait un arrondi que le Socle ne tranche pas.
   */
  ventilationDesBases?: NonNullable<Parameters<typeof computePivot>[0]["ventilation_des_bases"]>;
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
  const compteDeCharge = params.compteDeNature || mapping.mainAccount;
  const auCout = new Set(params.droitsAuCout ?? []);

  // Le pivot d'un extrait, dans une devise : le même moteur, la même
  // imputation. Un droit FIXÉ par le pack l'est dans la devise du dossier :
  // il ne se compare pas à un montant imprimé dans une autre.
  const pivotDe = (
    e: ExtractV1Type,
    devise: CurrencyDef,
    options: { droitsFixes: boolean; tvaVerifieeEn?: string },
  ) =>
    computePivot({
      extract: e,
      source_item_id: params.pieceId,
      tenant_currency: devise,
      tax_rates: params.taxRates.map((r) => ({
        code: r.code,
        label: r.label,
        rate: r.rate,
        valid_from: r.validFrom,
        valid_to: r.validTo,
        jurisdiction: r.jurisdiction,
      })),
      mapping: {
        document_kind: e.document_kind,
        charge_or_product_account: compteDeCharge,
        vat_account: mapping.vatAccount,
        counterparty_account: mapping.counterpartyAccount,
      },
      fiscal_charges: (params.fiscalCharges ?? [])
        .filter((c) => c.documentKind === e.document_kind)
        .map((c) => ({
          code: c.code,
          label: c.label,
          account_code:
            e.document_kind === "facture_achat" && auCout.has(c.code)
              ? compteDeCharge
              : c.accountCode,
          document_kind: c.documentKind,
          fixed_amount: options.droitsFixes ? c.fixedAmount : null,
          taxable: c.taxable,
        })),

      /*
       * Le compte de TVA par code, quand le pack en distingue. Le mapping choisi
       * plus haut l'est par le PREMIER code de taxe : sans cette table, la TVA
       * d'un second taux partirait sur le compte du premier.
       */
      vat_accounts_by_tax_code: Object.fromEntries(
        params.mappings
          .filter((m) => m.documentKind === e.document_kind && m.taxCode !== null)
          .map((m) => [m.taxCode as string, m.vatAccount]),
      ),

      tolerances: {
        rounding_tolerance: uniteALExposant(devise.decimals),
        confidence_orange: params.parametres.confianceReserve,
        confidence_red: params.parametres.confianceBloquante,
      },
      ...(options.tvaVerifieeEn ? { tva_verifiee_en: options.tvaVerifieeEn } : {}),
      ...(params.ventilationDesBases ? { ventilation_des_bases: params.ventilationDesBases } : {}),
    });

  /*
   * ============================================== UNE PIÈCE EN DEVISE (31 octobre 2026)
   *
   * D'abord la facture, dans SA devise : la TVA, le total, l'équilibre s'y
   * vérifient — un droit fixé du pack n'y est pas comparé, il est dans la
   * devise du dossier. Ensuite seulement l'extrait se convertit, et
   * l'écriture se compose sur l'extrait converti, dans la devise du dossier,
   * où le droit fixé se compare enfin. Chaque ligne garde son montant
   * d'origine : les deux pivots ont la même forme (même extrait, mêmes
   * comptes, même ordre), ligne pour ligne.
   */
  const deLaPiece: CurrencyDef = { code: extract.currency, decimals };
  const conversion = params.conversion;
  if (
    conversion &&
    params.ventilationDesBases?.some((parts) => parts.some((x) => x.montant !== null))
  )
    throw new Error("VENTILATION_EN_DEVISE");
  const origine = conversion ? pivotDe(extract, deLaPiece, { droitsFixes: false }) : null;
  /*
   * La dette envers le tiers est HT + TVA + droits (le pivot ne recopie
   * jamais un TTC dont l'écart n'est pas justifié) : c'est elle qui se
   * convertit (`aSaDette`, la même règle que la TVA du mois).
   */
  const converti =
    conversion && origine?.approvable
      ? convertirLExtrait(aSaDette(extract, decimals), {
          de: deLaPiece,
          vers: conversion.vers,
          cours: conversion.cours,
          ecart: conversion.ecart,
        })
      : null;
  const pivot = !conversion
    ? pivotDe(extract, deLaPiece, { droitsFixes: true })
    : converti
      ? pivotDe(converti.extrait, conversion.vers, {
          droitsFixes: true,
          tvaVerifieeEn: extract.currency,
        })
      : origine!;
  const decimalesDuPivot = converti ? conversion!.vers.decimals : decimals;

  /*
   * La TVA non déductible rejoint la charge : chaque débit d'un compte de TVA
   * passe sur la première ligne de charge, au millime près, et la ligne de TVA
   * disparaît. Seulement à l'achat : une vente ne déduit rien. La même règle
   * s'applique aux lignes d'origine d'une pièce en devise : elles restent
   * appariées, ligne pour ligne.
   */
  const comptesDeTva = new Set<string>([
    mapping.vatAccount,
    ...params.mappings
      .filter((m) => m.documentKind === extract.document_kind)
      .map((m) => m.vatAccount),
  ]);
  const tvaVersLaCharge = (lignes: readonly JournalLineV1[], n: number): JournalLineV1[] => {
    if (!params.tvaNonDeductible || extract.document_kind === "facture_vente") return [...lignes];
    const tva = lignes.filter((l) => comptesDeTva.has(l.account_code) && Number(l.debit) > 0);
    if (tva.length === 0) return [...lignes];
    const iCharge = lignes.findIndex((l) => l.account_code === compteDeCharge);
    if (iCharge >= 0) {
      const ajout = tva.reduce((s, l) => s.plus(D(l.debit)), D(0));
      return lignes
        .map((l, i) => (i === iCharge ? { ...l, debit: toFixedStr(D(l.debit).plus(ajout), n) } : l))
        .filter((l) => !tva.includes(l));
    }
    /*
     * Un achat ventilé (5 novembre 2026, revue de #252) : la TVA de chaque taux
     * rejoint les charges de ce taux, au prorata de leur base ; le reliquat
     * d'arrondi va à la dernière, pour que la somme soit exactement la TVA.
     * Un taux sans charge à lui ne se répartit pas : rien n'est deviné.
     */
    const ajouts = new Map<number, Decimal>();
    for (const t of tva) {
      const cibles = lignes.flatMap((l, i) =>
        l.tax_code === t.tax_code && !comptesDeTva.has(l.account_code) && D(l.debit).gt(0)
          ? [i]
          : [],
      );
      if (cibles.length === 0) return [...lignes];
      const bases = cibles.reduce((s, i) => s.plus(D(lignes[i]!.debit)), D(0));
      let reste = D(t.debit);
      cibles.forEach((i, k) => {
        const part =
          k === cibles.length - 1
            ? reste
            : D(toFixedStr(D(t.debit).times(D(lignes[i]!.debit)).div(bases), n));
        reste = reste.minus(part);
        ajouts.set(i, (ajouts.get(i) ?? D(0)).plus(part));
      });
    }
    return lignes
      .map((l, i) =>
        ajouts.has(i) ? { ...l, debit: toFixedStr(D(l.debit).plus(ajouts.get(i)!), n) } : l,
      )
      .filter((l) => !tva.includes(l));
  };
  const lignesDuPivot = tvaVersLaCharge(pivot.lines, decimalesDuPivot);
  const lignesDOrigine = converti && origine ? tvaVersLaCharge(origine.lines, decimals) : null;
  /** Le montant d'une ligne, du côté qui le porte ; null pour une ligne nulle. */
  const montantDe = (l: JournalLineV1 | undefined) =>
    !l ? null : !D(l.debit).isZero() ? l.debit : !D(l.credit).isZero() ? l.credit : null;

  return {
    pivot,
    extract: converti?.extrait ?? extract,
    ...(converti ? { conversion: converti.conversion } : {}),
    journal: journalDuPack,
    libelle: composerLibelle(faitsDuLibelle(extract)),
    // Une ligne nulle (TVA à zéro sur pièce exonérée) ne porte aucun fait
    // comptable : la base l'interdit, on ne la persiste pas. Le pivot du Socle
    // reste intact — c'est la seule vue persistée qui est filtrée.
    lignes: lignesDuPivot.flatMap((l, i) => {
      if (montantDe(l) === null) return [];
      const montantOrigine = montantDe(lignesDOrigine?.[i]);
      return [
        {
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
          // Ce que la ligne vaut dans la devise de la pièce — l'écart
          // d'arrondi compris dans la ligne convertie qui l'a reçu.
          ...(converti && montantOrigine !== null
            ? {
                devise_origine: converti.conversion.devise_origine,
                montant_origine: montantOrigine,
                taux_de_change: converti.conversion.taux_unitaire,
                cours_id: converti.conversion.cours.id,
              }
            : {}),
        },
      ];
    }),
  };
}
