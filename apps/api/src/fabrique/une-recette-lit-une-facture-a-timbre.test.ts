/**
 * UNE FACTURE À TIMBRE, LUE PAR UNE RECETTE, SORT EN CONTRAT COMPLET.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/une-recette-lit-une-facture-a-timbre.test.ts
 *
 * ==================================================================== POURQUOI
 *
 * Le 19 octobre 2026, la fabrique de lecteurs est livrée avec huit limites
 * nommées, et la première les borne toutes :
 *
 *   « `other_charges` vide par recette. Le langage n'exprime pas un droit hors
 *     TVA. Sur une facture à timbre — c'est-à-dire la plupart en Tunisie — le
 *     contrat sortira PARTIEL et la chaîne reprendra la main. Cela borne
 *     l'économie réelle de la fabrique. »
 *
 * Autrement dit : une recette parfaite sur tout le reste rendait quand même la
 * main au modèle sur la quasi-totalité des factures du marché tunisien, parce
 * que presque toutes portent le droit de timbre.
 *
 * ========================================== CE QUE CE BANC MESURE, ET OÙ IL S'ARRÊTE
 *
 * Il ne mesure PAS la forme de l'extrait — `par-recette.test.ts` le fait, et
 * `extract.v1` ne vérifie aucune équation. Il mesure le VERDICT COMPTABLE,
 * c'est-à-dire le seul endroit où le timbre manquant se voit : le moteur
 * d'équilibre, qui retrouve un résidu entre le TTC imprimé et
 * HT + TVA + droits déclarés, et BLOQUE l'écriture faute de l'expliquer.
 *
 * Les taux, les droits et les imputations viennent du PACK RÉEL, lu en base :
 * aucun code, aucun taux, aucun compte n'est écrit ici (R4). Le plan et la
 * recette sont synthétiques et déclarés comme tels ; aucun appel de modèle,
 * aucun fournisseur payant.
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
  FACTURE_A_TIMBRE_HORS_BAREME,
} from "./signature-plans-synthetiques.ts";
import type { ExigencesDeValidation } from "./recette-validateur.ts";
import type { ParametresDeClassement, ParametresDeDistance } from "./signature-distance.ts";
import type { ParametresDeSignature } from "./signature.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

/**
 * Les réglages de CE banc, posés à la main.
 *
 * En exécution ils viennent du référentiel, datés et surchargeables (R10), et
 * aucune fonction n'en porte par défaut. `ancre_texte_min` vaut 2 : « HT »,
 * « Qte » et « TTC » sont les libellés que la pièce IMPRIME, et un seuil à 3
 * refuserait la recette — c'est la limite n° 4, et elle est corrigée au
 * référentiel par la migration du 20 octobre.
 */
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

/** Le dinar : trois décimales. L'échelle vient du pack ; ici le banc n'en a pas. */
const DECIMALES = 3;

/**
 * Le matricule du dossier.
 *
 * Il est celui que le plan imprime en haut : le dossier est donc l'ÉMETTEUR, et
 * `read-piece.ts` en déduit une facture de VENTE. Le sens n'est pas donné au
 * moteur, il est déduit — c'est la correction du 5 octobre 2026.
 */
const MATRICULE_DU_DOSSIER = "1234567A";

const TOLERANCES = {
  rounding_tolerance: "0.001",
  confidence_orange: 0.85,
  confidence_red: 0.6,
} as const;

/** La recette, nourrie de DEUX exemples — le minimum d'une ossature. */
function formatATimbre(): ContexteDeFabrique["versions"] {
  return [
    {
      versionId: "55555555-5555-4555-8555-555555555555",
      recetteId: "66666666-6666-4666-8666-666666666666",
      rang: 1,
      libelle: "facture SOTUPAP à timbre",
      etat: "active",
      definition: RECETTE_FACTURE_A_TIMBRE,
      plansDApprentissage: [FACTURE_A_TIMBRE(), FACTURE_A_TIMBRE_AUTRES_VALEURS()],
    },
  ];
}

/**
 * L'extrait tel qu'une RECETTE le produit — rien n'est écrit à la main.
 *
 * Le trajet est celui de la production : plan de jetons → recette → sélection
 * → `buildExtractFromTokenPlan`, c'est-à-dire la relecture PARTAGÉE du plan,
 * celle qui passe par `recollerLesMilliers`. Le montant du timbre n'est donc
 * pas écrit par la recette : il est relu dans le plan, au jeton qu'elle a
 * désigné.
 */
function extraitParRecette(plan: readonly PageToken[] = FACTURE_A_TIMBRE()): {
  extract: ExtractV1;
  valid: boolean;
  citations: ReadonlyArray<{ field: string }>;
} {
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
  return {
    extract: lu.extract as unknown as ExtractV1,
    valid: lu.valid,
    citations: lu.citations,
  };
}

describe("une facture à timbre, lue par une recette", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let tax_rates: TaxRateRow[] = [];
  let fiscal_charges: FiscalChargeRule[] = [];
  let imputation: AccountMappingRule;

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

    const { rows: mapping } = await pool.query<{
      main_account: string;
      vat_account: string;
      counterparty_account: string;
    }>(
      `select main_account, vat_account, counterparty_account
         from ref.account_mappings
        where pack_version_id = $1 and document_kind = 'facture_vente' and tax_code = 'TVA19'`,
      [pack],
    );
    const m = mapping[0];
    assert.ok(m, "l'imputation de vente à 19 % doit être au pack");
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

  it("le droit sort dans l'extrait, avec son code du pack et son montant relu", () => {
    const { extract, valid } = extraitParRecette();
    assert.equal(valid, true, "le contrat doit PARSER : sinon « complet » n'a pas de sens");
    assert.deepEqual(
      extract.other_charges.map((c) => [c.code, c.amount]),
      [["DROIT_TIMBRE", "1.000"]],
      "le code vient de la recette, le montant du plan",
    );
    const auPack = fiscal_charges.find(
      (c) => c.code === extract.other_charges[0]!.code && c.document_kind === extract.document_kind,
    );
    assert.ok(auPack, "le code nommé par la recette est un code du pack, pas une invention");
  });

  /** Le pivot du pack, pour un extrait donné. Aucun compte n'est écrit ici. */
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

  function compteDuTimbre(kind: string): string {
    const r = fiscal_charges.find((c) => c.code === "DROIT_TIMBRE" && c.document_kind === kind);
    assert.ok(r, "le droit de timbre doit être au pack, dans ce sens de facture");
    return r.account_code;
  }

  /*
   * ====================================== LA MESURE QUI DIT SI LA LIMITE EST LEVÉE
   */
  it("l'écriture est PROPOSABLE, sans aucun résidu à expliquer", () => {
    const { extract } = extraitParRecette();
    const pivot = pivoter(extract);

    assert.deepEqual(
      pivot.motifs.filter((x) => x.severity === "block").map((x) => `${x.code} — ${x.message}`),
      [],
      "une facture à timbre lue par une recette ne doit rien bloquer",
    );
    assert.deepEqual(
      pivot.motifs.filter((x) => x.code.startsWith("RESIDUAL")).map((x) => x.code),
      [],
      "le pied boucle : il n'y a plus de résidu, donc plus rien à attribuer",
    );
    assert.equal(pivot.totals.debit, pivot.totals.credit, "débit et crédit au millime");
    assert.equal(pivot.approvable, true);

    const timbre = pivot.lines.find(
      (l) => l.account_code === compteDuTimbre(extract.document_kind),
    );
    assert.ok(timbre, "le droit a sa propre ligne, il ne se noie pas dans le HT");
    assert.equal(timbre.credit, "1.000", "et son montant est celui que la pièce imprime");
  });

  /*
   * ============================== CE QUE LA LIMITE COÛTAIT EXACTEMENT, EN DEUX CAS
   *
   * Le constat du 19 octobre disait « le contrat sortira partiel ». La mesure
   * est plus précise que cela, et elle est en deux parties — c'est la seule
   * raison pour laquelle la limite a pu passer pour moins grave qu'elle
   * n'était.
   */
  it("sans droit désigné, le TIMBRE AU BARÈME passe — mais son montant vient du PACK, sans citation", () => {
    const { extract, citations } = extraitParRecette();
    const pivot = pivoter({ ...extract, other_charges: [] });

    assert.deepEqual(
      pivot.motifs.filter((x) => x.code.startsWith("RESIDUAL")).map((x) => x.code),
      ["RESIDUAL_MATCHED_PACK_CHARGE"],
      "le moteur RATTRAPE un résidu égal au montant fixe du pack, en « info »",
    );
    assert.equal(pivot.approvable, true, "donc l'écriture passait — et c'est le piège");

    /*
     * Le montant inscrit vient alors de `fixed_amount`, pas d'un jeton. La
     * ligne existe, elle est juste ici, et AUCUNE citation ne la porte : c'est
     * un montant sans preuve d'origine dans une écriture, très exactement ce
     * que R2 interdit. La recette, elle, la cite.
     */
    const timbre = pivot.lines.find(
      (l) => l.account_code === compteDuTimbre(extract.document_kind),
    );
    assert.ok(timbre, "rattrapé, le droit a bien une ligne");
    assert.ok(
      citations.some((c) => c.field === "other_charges[0].amount"),
      "la recette, elle, cite le jeton du montant",
    );
  });

  it("un code que le pack ne connaît pas est REFUSÉ — et par le chemin qui existe déjà", () => {
    /*
     * Le validateur de recette ne juge AUCUN code : savoir si « TIMBRE_IMAGINE »
     * existe demande le pack de l'organisation et la date de la pièce, qu'il
     * n'a pas. La chaîne le fait déjà, au même endroit et de la même façon
     * pour un code venu du modèle — `MISSING_ACCOUNT_MAPPING`, bloquant,
     * « aucun compte au pack pour le droit ». Le redire dans le langage ferait
     * une règle écrite deux fois, et c'est de là que viennent les huit
     * appariements muets de ce dépôt.
     */
    const { extract } = extraitParRecette();
    const pivot = pivoter({
      ...extract,
      other_charges: [{ code: "TIMBRE_IMAGINE", label: "", amount: "1.000" }],
    });
    assert.deepEqual(
      pivot.motifs.filter((x) => x.severity === "block").map((x) => x.code),
      ["MISSING_ACCOUNT_MAPPING"],
    );
    assert.equal(pivot.approvable, false);
  });

  it("et un timbre HORS BARÈME bloque l'écriture — là, la limite coûtait la pièce", () => {
    /*
     * Deux dinars de timbre là où le pack en porte un : le rattrapage par
     * montant fixe ne s'applique plus, et le moteur bloque plutôt que
     * d'inventer. C'est le même mur que le FODEC a rencontré le 18 octobre, et
     * il tombe sur toute charge que le pack ne fixe pas.
     */
    const { extract } = extraitParRecette(FACTURE_A_TIMBRE_HORS_BAREME());
    assert.deepEqual(
      extract.other_charges.map((c) => [c.code, c.amount]),
      [["DROIT_TIMBRE", "2.000"]],
      "la recette désigne ce que la pièce imprime, pas ce que le pack prévoit",
    );

    const avec = pivoter(extract);
    assert.equal(avec.approvable, true, "désigné, le droit boucle le pied");

    const sans = pivoter({ ...extract, other_charges: [] });
    assert.deepEqual(
      sans.motifs.filter((x) => x.severity === "block").map((x) => x.code),
      ["RESIDUAL_UNEXPLAINED"],
    );
    assert.equal(sans.approvable, false);
  });
});
