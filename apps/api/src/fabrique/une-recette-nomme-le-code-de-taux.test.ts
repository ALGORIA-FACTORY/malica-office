/**
 * UNE FACTURE QUI IMPRIME « 19% » SORT QUAND MÊME EN ÉCRITURE PROPOSABLE.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/une-recette-nomme-le-code-de-taux.test.ts
 *
 * ==================================================================== POURQUOI
 *
 * Le 19 octobre 2026, la limite n° 1 est levée : un droit hors TVA se NOMME
 * depuis le référentiel, et son montant se DÉSIGNE. Son auteur a nommé, sans
 * le trancher, ce qui restait du même défaut :
 *
 *   « `CHAMPS_DE_LIGNE.tax_code` reste une DÉSIGNATION : une recette ne peut
 *     produire que le code que la pièce imprime littéralement, or une facture
 *     réelle imprime « 19 % », pas « TVA19 ». C'est le même défaut que je
 *     viens de corriger pour les droits, resté sur les lignes. »
 *
 * Et son plan de banc imprimait « TVA19 » **pour contourner**, en le disant.
 * Le banc était donc plus facile que le réel sur ce point précis : le même
 * aveu qu'un agent avait fait pour les en-têtes arabes.
 *
 * ===================================== CE QUE LA MESURE A TRANCHÉ, ET DANS QUEL SENS
 *
 * C'est bien le même cas, et pour une raison qui ne se lit pas dans le
 * langage : dans le chemin du MODÈLE, `tax_code` n'est déjà pas une
 * désignation. L'invite de `vision.ts` écrit `"tax_code":"<un code de la liste
 * fournie>"` — le modèle NOMME un code pris à une liste du référentiel, comme
 * il nomme un code de droit. Le chemin de la recette était l'anomalie, pas le
 * chemin du modèle.
 *
 * Ce banc mesure donc les deux états sur le pack tunisien RÉEL, et il descend
 * jusqu'au moteur d'équilibre — parce que `extract.v1` est une FORME et ne
 * vérifie aucune équation : un extrait peut sortir `valid` avec un taux que le
 * pack ne connaît pas, et c'est `computePivot` qui le dit.
 *
 * Aucun code, aucun taux, aucun compte n'est écrit ici (R4) : tout vient de la
 * base. Le plan et la recette sont synthétiques et déclarés comme tels ; aucun
 * appel de modèle, aucun fournisseur payant.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { computePivot } from "@malica/socle/engines/p4/balance";
import type { FiscalChargeRule } from "@malica/socle/engines/p4/balance";
import type { AccountMappingRule, TaxRateRow } from "@malica/socle/domain/types";
import type { ExtractV1 } from "@malica/socle/contracts/extract.v1";

import { designerParRecette, type ContexteDeFabrique } from "../malica/lecture/par-recette.ts";
import type { PageToken } from "../malica/lecture/token-plan.ts";
import { buildExtractFromTokenPlan } from "../malica/lecture/read-piece.ts";

import { RECETTE_FACTURE_A_TIMBRE } from "./interprete-recettes-synthetiques.ts";
import {
  FACTURE_A_TIMBRE,
  FACTURE_A_TIMBRE_AUTRES_VALEURS,
} from "./signature-plans-synthetiques.ts";
import type { ExigencesDeValidation } from "./recette-validateur.ts";
import type { ParametresDeClassement, ParametresDeDistance } from "./signature-distance.ts";
import type { ParametresDeSignature } from "./signature.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

/** Les réglages de CE banc. En exécution ils viennent du référentiel (R10). */
const SIGNATURE: ParametresDeSignature = {
  longueurMinimaleDAncre: 2,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.5,
  ancresEnRelationMax: 40,
};
const DISTANCE: ParametresDeDistance = {
  poids: { ancres: 3, zones: 1, relations: 2, tableau: 3, pagination: 1 },
};
const CLASSEMENT: ParametresDeClassement = { distanceMax: 0.5, ecartMinimal: 0.02 };
const BORNES: ExigencesDeValidation = {
  ancre_texte_min: 2,
  selecteurs_max: 200,
  champs_max: 50,
  jetons_max: 12,
  rang_max: 50,
};

const DECIMALES = 3;
const MATRICULE_DU_DOSSIER = "1234567A";
const TOLERANCES = {
  rounding_tolerance: "0.001",
  confidence_orange: 0.85,
  confidence_red: 0.6,
} as const;

function formatATimbre(): ContexteDeFabrique["versions"] {
  return [
    {
      versionId: "77777777-7777-4777-8777-777777777777",
      recetteId: "88888888-8888-4888-8888-888888888888",
      rang: 1,
      libelle: "facture SOTUPAP à timbre",
      etat: "active",
      definition: RECETTE_FACTURE_A_TIMBRE,
      plansDApprentissage: [FACTURE_A_TIMBRE(), FACTURE_A_TIMBRE_AUTRES_VALEURS()],
    },
  ];
}

function extraitParRecette(plan: readonly PageToken[] = FACTURE_A_TIMBRE()): ExtractV1 {
  const designation = designerParRecette(
    [...plan],
    {
      signature: SIGNATURE,
      distance: DISTANCE,
      classement: CLASSEMENT,
      bornes: BORNES,
      versions: formatATimbre(),
    },
    { devise: "TND", neutreDeConfiance: 1 },
  );
  assert.ok(
    designation.applique,
    designation.applique === false ? JSON.stringify(designation.pourquoi) : "",
  );
  const lu = buildExtractFromTokenPlan({
    tokens: [...plan],
    selection: designation.par.selection,
    decimals: DECIMALES,
    matriculeDossier: MATRICULE_DU_DOSSIER,
  });
  return lu.extract as unknown as ExtractV1;
}

describe("une recette nomme le code de taux d'une ligne", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let tax_rates: TaxRateRow[] = [];
  let fiscal_charges: FiscalChargeRule[] = [];
  let imputation: AccountMappingRule;
  /** Le code de taux que le PACK porte — jamais écrit ici (R4). */
  let codeDuPack = "";

  before(async () => {
    pool = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
    const { rows: packs } = await pool.query<{ id: string }>(
      `select id from ref.jurisdiction_packs where jurisdiction = 'TN'
        order by effective_from desc limit 1`,
    );
    const pack = packs[0]?.id;
    assert.ok(pack, "le pack tunisien doit être en base");

    const { rows: taux } = await pool.query<{ code: string; rate: string }>(
      `select code, rate::text as rate from ref.tva_rates where pack_version_id = $1`,
      [pack],
    );
    tax_rates = taux.map((t) => ({
      code: t.code,
      label: t.code,
      rate: t.rate,
      valid_from: "2018-01-01",
      valid_to: null,
      jurisdiction: "TN",
    }));

    const { rows: charges } = await pool.query<{
      code: string;
      label: string;
      account_code: string;
      document_kind: string;
      fixed_amount: string | null;
    }>(
      `select code, label, account_code, document_kind, fixed_amount::text as fixed_amount
         from ref.fiscal_charges where pack_version_id = $1`,
      [pack],
    );
    fiscal_charges = charges.map((c) => ({
      code: c.code,
      label: c.label,
      account_code: c.account_code,
      document_kind: c.document_kind as "facture_achat" | "facture_vente",
      fixed_amount: c.fixed_amount,
    }));

    /*
     * Le code du pack dont le TAUX vaut celui que le plan de banc imprime.
     *
     * Il est CHERCHÉ par son taux, et pas écrit : c'est la seule façon de ne
     * pas reposer une constante réglementaire dans une épreuve, et c'est aussi
     * exactement le geste qu'un cabinet ferait pour choisir le code à nommer
     * dans sa recette.
     */
    const { rows: pourLeTaux } = await pool.query<{ code: string }>(
      `select code from ref.tva_rates
        where pack_version_id = $1 and rate = 0.19 order by code limit 1`,
      [pack],
    );
    codeDuPack = pourLeTaux[0]?.code ?? "";
    assert.ok(codeDuPack, "le pack tunisien doit porter un taux de 19 %");

    const { rows: mapping } = await pool.query<{
      main_account: string;
      vat_account: string;
      counterparty_account: string;
    }>(
      `select main_account, vat_account, counterparty_account
         from ref.account_mappings
        where pack_version_id = $1 and document_kind = 'facture_vente' and tax_code = $2`,
      [pack, codeDuPack],
    );
    const m = mapping[0];
    assert.ok(m, "l'imputation de vente à ce taux doit être au pack");
    imputation = {
      document_kind: "facture_vente",
      charge_or_product_account: m.main_account,
      vat_account: m.vat_account,
      counterparty_account: m.counterparty_account,
    };
  });

  after(async () => {
    await pool?.end();
  });

  function pivoter(extract: ExtractV1) {
    return computePivot({
      extract,
      source_item_id: null,
      tenant_currency: { code: "TND", decimals: DECIMALES },
      tax_rates,
      mapping: imputation,
      fiscal_charges,
      tolerances: TOLERANCES,
    });
  }

  /*
   * ========================= ① LE PLAN IMPRIME CE QU'IMPRIME UNE VRAIE FACTURE
   */
  it("le récapitulatif imprime un TAUX, et nulle part le code du pack", () => {
    const textes = FACTURE_A_TIMBRE().map((t) => t.text);
    assert.ok(
      !textes.includes(codeDuPack),
      `le plan de banc imprime « ${codeDuPack} » : le contournement est toujours là`,
    );
    assert.ok(
      textes.some((t) => t.includes("%")),
      "le plan de banc n'imprime aucun taux : il n'imprime pas ce qu'imprime une facture",
    );
  });

  /*
   * ====================== ② LE CODE SE NOMME, ET L'ÉCRITURE RESTE PROPOSABLE
   */
  it("la ligne de taux porte le code du PACK, que la pièce n'imprime pas", () => {
    const extract = extraitParRecette();
    assert.deepEqual(
      extract.lines.map((l) => l.tax_code),
      [codeDuPack],
      "le code de taux ne vient pas du référentiel : il a été relu sur la pièce",
    );
  });

  it("l'écriture est proposable, et la TVA part sur le compte du pack pour ce code", () => {
    const pivot = pivoter(extraitParRecette());
    assert.deepEqual(
      pivot.motifs.filter((x) => x.severity === "block").map((x) => `${x.code} — ${x.message}`),
      [],
      "une facture qui imprime son taux ne doit rien bloquer",
    );
    assert.equal(pivot.totals.debit, pivot.totals.credit, "débit et crédit au millime");
    assert.equal(pivot.approvable, true);
    assert.ok(
      pivot.lines.some((l) => l.tax_code === codeDuPack),
      "aucune ligne d'écriture ne porte le code de taux du pack",
    );
  });

  /*
   * ================== ③ CE QUE LA LIMITE COÛTAIT : LA PIÈCE, ET EN ENTIER
   *
   * L'état d'avant, reproduit à l'identique : le code de taux est ce que la
   * pièce IMPRIME, parce qu'il était désigné. Ce n'est pas une hypothèse — le
   * plan de banc imprime « 19% », et c'est exactement ce qu'une désignation en
   * aurait tiré.
   */
  it("DÉSIGNÉ, le taux imprimé bloque l'écriture — et le contrat, lui, PARSE", () => {
    const extract = extraitParRecette();
    const imprime = FACTURE_A_TIMBRE().find((t) => t.text.includes("%"));
    assert.ok(imprime, "le plan doit imprimer un taux");

    const commeDesigne: ExtractV1 = {
      ...extract,
      lines: extract.lines.map((l) => ({ ...l, tax_code: imprime.text })),
    };
    const pivot = pivoter(commeDesigne);
    assert.deepEqual(
      pivot.motifs.filter((x) => x.severity === "block").map((x) => x.code),
      ["MISSING_TAX_RATE"],
      "un taux imprimé désigné tel quel devrait être inconnu du pack",
    );
    assert.equal(pivot.approvable, false);
  });

  /*
   * ============ ④ CE QU'UN CODE NOMMÉ COÛTE QUAND IL EST FAUX — ET IL NE SE TAIT PAS
   *
   * C'est la question qu'il fallait trancher avant de nommer : une déclaration
   * unique pour N lignes ne sait pas exprimer un récapitulatif à plusieurs
   * taux. Un code uniforme serait alors FAUX sur une partie des lignes, et la
   * ventilation de la TVA par taux est très exactement l'erreur trouvée chez
   * un expert le 11 octobre 2026 — équilibrée au millime, un mois plus tard,
   * sans trace de son origine.
   *
   * Elle ne peut pas se reproduire par ce chemin : `computePivot` vérifie
   * `base × taux ≈ TVA` LIGNE PAR LIGNE. Un code nommé qui ne correspond pas
   * aux montants imprimés bloque. Un format à plusieurs taux rend donc la main
   * au modèle, visiblement, au lieu d'être ventilé de travers.
   */
  it("un code NOMMÉ qui ne colle pas aux montants bloque — il ne ventile pas de travers", async () => {
    const { rows: autres } = await pool.query<{ code: string }>(
      `select code from ref.tva_rates
        where pack_version_id = (select id from ref.jurisdiction_packs
                                  where jurisdiction = 'TN'
                                  order by effective_from desc limit 1)
          and rate <> 0.19 and rate > 0 order by code limit 1`,
    );
    const autreCode = autres[0]?.code;
    assert.ok(autreCode, "le pack tunisien doit porter un second taux non nul");

    const extract = extraitParRecette();
    const pivot = pivoter({
      ...extract,
      lines: extract.lines.map((l) => ({ ...l, tax_code: autreCode })),
    });
    assert.ok(
      pivot.motifs.some((x) => x.code === "TAX_RATE_MISMATCH" && x.severity === "block"),
      "un code nommé faux passe en silence : la TVA se ventile sur le mauvais taux",
    );
    assert.equal(pivot.approvable, false);
  });
});
