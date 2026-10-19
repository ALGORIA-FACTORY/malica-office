/**
 * LE GÉNÉRATEUR PROPOSE UNE RECETTE À TIMBRE, ET L'ÉCRITURE EST PROPOSABLE.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/le-generateur-propose-une-recette-a-timbre.test.ts
 *
 * ==================================================================== POURQUOI
 *
 * Le 19 octobre 2026, le langage apprend à nommer un droit hors TVA, et c'est
 * mesuré. Mais le générateur, lui, ne le proposait jamais : sa consigne
 * énumérait les clés de premier niveau et terminait par « Aucune autre clé
 * n'est acceptée, à aucun niveau ». La section `droits` était donc INTERDITE
 * par l'invite même qui devait l'apprendre.
 *
 * Conséquence, et c'est le blocage principal de cette livraison : une recette
 * à timbre devait s'écrire À LA MAIN. Or la quasi-totalité des factures
 * tunisiennes portent un droit de timbre — la fabrique ne fabriquait donc rien
 * d'utilisable sur son marché, quelle que fût la qualité du langage.
 *
 * ============================================== CE QUE CE BANC MESURE, ET OÙ IL S'ARRÊTE
 *
 * Il ne mesure PAS la qualité d'un modèle : l'adaptateur est simulé, et c'est
 * dit pour qu'aucun relevé ne s'y trompe. Il mesure quatre choses que le
 * générateur fait ou ne fait pas :
 *
 *   ① ce que le modèle VOIT — la consigne autorise `droits`, l'observation
 *      porte le code et la structure du droit, et aucune valeur lue n'y entre ;
 *   ② ce qu'il ACCEPTE — une proposition à timbre passe les quatre portes ;
 *   ③ ce qu'il REFUSE — un timbre désigné ailleurs, un timbre non déclaré, un
 *      code que les exemples n'ont pas déclaré ;
 *   ④ ce que la recette acceptée VAUT, jusqu'au moteur d'équilibre et sur le
 *      pack tunisien réel : écriture proposable, droit cité, pied qui boucle.
 *
 * Le quatrième est le seul qui réponde à la question posée, parce que
 * `extract.v1` est une FORME et ne vérifie aucune équation : une recette peut
 * sortir un contrat `valid` et faux. C'est la leçon du 19 octobre, et elle
 * coûte la mesure.
 *
 * Aucun code, aucun taux, aucun compte n'est écrit ici (R4). Aucun appel de
 * fournisseur payant.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { computePivot } from "@malica/socle/engines/p4/balance";
import type { FiscalChargeRule } from "@malica/socle/engines/p4/balance";
import type { AccountMappingRule, TaxRateRow } from "@malica/socle/domain/types";
import type { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import type { PageToken, TokenRef } from "@malica/socle/ports/malica";

import { designerParRecette, type ContexteDeFabrique } from "../malica/lecture/par-recette.ts";
import { buildExtractFromTokenPlan } from "../malica/lecture/read-piece.ts";

import {
  proposerUneRecette,
  type AppelDeGenerateur,
  type CodesDuReferentiel,
  type ExempleDApprentissage,
  type Generation,
  type InviteDeGeneration,
} from "./generateur.ts";
import { RECETTE_FACTURE_A_TIMBRE } from "./interprete-recettes-synthetiques.ts";
import type { ExigencesDeValidation } from "./recette-validateur.ts";
import {
  FACTURE_A_TIMBRE,
  FACTURE_A_TIMBRE_AUTRE_CLIENT,
  FACTURE_A_TIMBRE_AUTRES_VALEURS,
} from "./signature-plans-synthetiques.ts";
import type { ParametresDeClassement, ParametresDeDistance } from "./signature-distance.ts";
import type { ParametresDeSignature } from "./signature.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL_ADMIN"]);

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
const EXIGENCES: ExigencesDeValidation = {
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

/**
 * Le jeton du PIED qui porte ce texte.
 *
 * Le filtre sur l'abscisse n'est pas une coquetterie : « 1180,000 » est
 * imprimé DEUX fois sur cette facture — dans le récapitulatif par taux et dans
 * le pied — et le premier dans l'ordre de lecture est celui du récapitulatif.
 * Un `attendu` qui pointerait celui-là ferait échouer la porte ④ pour une
 * raison qui n'a rien à voir avec ce qu'on mesure.
 */
function dansLePied(plan: readonly PageToken[], texte: string): TokenRef {
  const t = plan.find((x) => x.text === texte && x.x0 >= 0.75);
  assert.ok(t, `le plan synthétique ne porte pas « ${texte} » dans son pied`);
  return { page: t.page, ordinal: t.ordinal };
}

function unique(plan: readonly PageToken[], texte: string): TokenRef {
  const vus = plan.filter((x) => x.text === texte);
  assert.equal(vus.length, 1, `« ${texte} » n'est pas unique dans le plan`);
  return { page: vus[0]!.page, ordinal: vus[0]!.ordinal };
}

/** Un adaptateur SIMULÉ, et le relevé de ce qu'il a vu. */
function modele(recetteProposee: unknown): {
  appel: AppelDeGenerateur;
  vues: InviteDeGeneration[];
} {
  const vues: InviteDeGeneration[] = [];
  return {
    vues,
    appel: (invite) => {
      vues.push(invite);
      return Promise.resolve({
        recetteProposee,
        modele: "modele-simule",
        role: "generateur",
        tokensIn: 2400,
        tokensOut: 620,
        latenceMs: 900,
      });
    },
  };
}

describe("le générateur propose une recette à timbre", { skip: !BASE_CONFIGUREE }, () => {
  let pool: pg.Pool;
  let tax_rates: TaxRateRow[] = [];
  let fiscal_charges: FiscalChargeRule[] = [];
  let imputation: AccountMappingRule;
  /** Tout ce qui suit vient du PACK : ni code, ni taux, ni compte écrit ici. */
  let codesDuPack: CodesDuReferentiel = { droits: [], taux: [] };
  let codeDuTimbre = "";
  let codeDuTaux = "";

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

    codesDuPack = {
      droits: [...new Set(charges.map((c) => c.code))].sort(),
      taux: [...new Set(taux.map((t) => t.code))].sort(),
    };

    /*
     * Le droit de timbre, et le code du taux imprimé, CHERCHÉS au pack.
     *
     * Le timbre se reconnaît à ce que le pack lui fixe un montant
     * (`fixed_amount`) : c'est la propriété du référentiel, pas un nom écrit
     * ici. Le taux se reconnaît à sa valeur, qui est celle que le plan de banc
     * imprime.
     */
    const timbre = charges.find(
      (c) => c.fixed_amount !== null && c.document_kind === "facture_vente",
    );
    assert.ok(timbre, "le pack tunisien doit porter un droit à montant fixe, en vente");
    codeDuTimbre = timbre.code;

    const { rows: pourLeTaux } = await pool.query<{ code: string }>(
      `select code from ref.tva_rates
        where pack_version_id = $1 and rate = 0.19 order by code limit 1`,
      [pack],
    );
    codeDuTaux = pourLeTaux[0]?.code ?? "";
    assert.ok(codeDuTaux, "le pack tunisien doit porter un taux de 19 %");

    const { rows: mapping } = await pool.query<{
      main_account: string;
      vat_account: string;
      counterparty_account: string;
    }>(
      `select main_account, vat_account, counterparty_account
         from ref.account_mappings
        where pack_version_id = $1 and document_kind = 'facture_vente' and tax_code = $2`,
      [pack, codeDuTaux],
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

  /**
   * Les deux exemples d'apprentissage du format à timbre.
   *
   * Ils déclarent trois choses, et chacune répond à une question différente :
   * les CHAMPS (où sont les totaux, la date, le matricule), les DROITS (quel
   * code, et où son montant est imprimé), et les CODES DE TAUX (quel code,
   * sans désignation — une facture n'imprime pas un code de taux).
   *
   * LE SECOND EXEMPLE EST CHEZ UN AUTRE CLIENT, et ce n'est pas un détail de
   * banc. Deux factures du même client qui ne diffèrent que par leurs montants
   * ont la MÊME empreinte de signature — les clés d'ancre écartent tout jeton
   * portant un chiffre — et le générateur les déduplique, à juste titre :
   * l'intersection ne fait rien tomber, donc l'ossature garderait le nom du
   * client comme si c'était la forme du papier.
   */
  function exemples(): ExempleDApprentissage[] {
    const lots = [
      { plan: FACTURE_A_TIMBRE(), ht: "1180,000", tva: "224,200", ttc: "1405,200" },
      { plan: FACTURE_A_TIMBRE_AUTRE_CLIENT(), ht: "708,000", tva: "134,520", ttc: "843,520" },
    ];
    return lots.map((lot, i) => ({
      pieceId: `piece-${String(i)}`,
      plan: lot.plan,
      attendu: {
        "totals.base_ht": dansLePied(lot.plan, lot.ht),
        "totals.vat": dansLePied(lot.plan, lot.tva),
        "totals.ttc": dansLePied(lot.plan, lot.ttc),
        "references.matricule_fiscal": unique(lot.plan, MATRICULE_DU_DOSSIER),
      },
      droitsAttendus: { [codeDuTimbre]: dansLePied(lot.plan, "1,000") },
      codesDeTaux: [codeDuTaux],
    }));
  }

  function proposer(
    recetteProposee: unknown,
    lesExemples: readonly ExempleDApprentissage[] = exemples(),
  ): { generation: Promise<Generation>; vues: InviteDeGeneration[] } {
    const m = modele(recetteProposee);
    return {
      generation: proposerUneRecette(lesExemples, EXIGENCES, SIGNATURE, codesDuPack, m.appel),
      vues: m.vues,
    };
  }

  /*
   * ====================================== ① CE QUE LE MODÈLE VOIT, ET NE VOIT PAS
   */
  it("la consigne AUTORISE la section « droits », et dit comment un code se nomme", async () => {
    const { generation, vues } = proposer(RECETTE_FACTURE_A_TIMBRE);
    await generation;
    const consigne = vues[0]?.consigne ?? "";
    assert.match(
      consigne,
      /clés de premier niveau sont[^.]*droits/s,
      "la consigne n'autorise pas « droits » : la section est interdite par l'invite même " +
        "qui doit l'apprendre, et c'était le blocage du 19 octobre",
    );
    assert.match(consigne, /code_de_taux/, "la consigne ne dit pas comment nommer un code de taux");
    assert.ok(
      consigne.includes(codeDuTimbre) && consigne.includes(codeDuTaux),
      "la liste des codes du référentiel n'est pas donnée au modèle",
    );
  });

  it("l'observation porte le droit sous son CODE, et aucune valeur lue", async () => {
    const { generation, vues } = proposer(RECETTE_FACTURE_A_TIMBRE);
    await generation;
    const observation = vues[0]?.observation ?? "";
    const vu = JSON.parse(observation) as {
      droits: Record<string, Array<{ forme: string | null; ancresAvant: string[] }>>;
      codes_de_taux: string[];
    };
    assert.deepEqual(Object.keys(vu.droits), [codeDuTimbre]);
    assert.equal(vu.droits[codeDuTimbre]!.length, 2, "les deux exemples ne sont pas observés");
    assert.equal(
      vu.droits[codeDuTimbre]![0]!.forme,
      "nombre",
      "le droit n'est pas observé comme un nombre",
    );
    assert.ok(
      vu.droits[codeDuTimbre]![0]!.ancresAvant.includes("timbre"),
      "l'observation ne dit pas à quoi le montant du droit est accroché",
    );
    assert.deepEqual(vu.codes_de_taux, [codeDuTaux]);

    /* R3, l'autre moitié : aucune valeur lue n'entre dans l'invite. */
    const envoye = `${vues[0]?.consigne ?? ""}\n${observation}`;
    for (const valeur of ["1,000", "1180,000", "224,200", "1405,200", "DREAM", "FA-2026-118"]) {
      assert.ok(
        !envoye.includes(valeur),
        `« ${valeur} » est dans l'invite : le modèle peut la recopier de bonne foi`,
      );
    }
  });

  /*
   * ============================ ② CE QU'IL ACCEPTE, ET ③ CE QU'IL REFUSE
   */
  it("une proposition à timbre passe les quatre portes", async () => {
    const { generation } = proposer(RECETTE_FACTURE_A_TIMBRE);
    const g = await generation;
    assert.equal(g.ok, true, g.ok === false ? `${g.refus.code} : ${g.refus.detail}` : "");
    if (!g.ok) return;
    assert.equal(g.recette.droits["timbre"]?.code, codeDuTimbre);
    assert.deepEqual(g.provenance.codes.droits, [codeDuTimbre]);
    assert.deepEqual(g.provenance.codes.taux, [codeDuTaux]);
  });

  it("une proposition SANS droits est refusée : elle n'a pas appris le timbre", async () => {
    /*
     * C'est exactement l'état du 19 octobre, et c'est la porte qui le refuse
     * désormais. Sans elle, la recette arrivait candidate, passait l'évaluation
     * — qui ne regardait pas les droits — et pouvait être activée.
     */
    const sansDroits = structuredClone(
      RECETTE_FACTURE_A_TIMBRE as Record<string, unknown>,
    ) as Record<string, unknown>;
    delete sansDroits["droits"];
    // L'ancre du timbre part avec lui : une ancre déclarée et jamais utilisée
    // est refusée par le validateur (`DECLARATION_MORTE`), et ce cas-ci doit
    // tomber à la porte ④, pas à la porte ③.
    delete (sansDroits["ancres"] as Record<string, unknown>)["etiquette_timbre"];
    const { generation } = proposer(sansDroits);
    const g = await generation;
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "NE_REPRODUIT_PAS_SES_EXEMPLES");
    assert.match(g.ok === false ? g.refus.detail : "", /aucune déclaration ne porte ce code/);
  });

  it("un droit désigné AILLEURS est refusé, et l'écart dit où", async () => {
    const tordue = structuredClone(RECETTE_FACTURE_A_TIMBRE as Record<string, unknown>) as Record<
      string,
      unknown
    >;
    const droits = tordue["droits"] as { timbre: Record<string, unknown> };
    // Le montant du TTC au lieu de celui du timbre : un nombre plausible, à
    // quatre lignes de là. C'est la faute qu'aucune équation ne rattrape.
    droits.timbre["designation"] = {
      depuis: { genre: "voisin", de: "etiquette_ttc", direction: "apres" },
      ou: [{ genre: "forme", forme: "nombre" }],
      prendre: { genre: "unique" },
    };
    // L'ancre du timbre n'est plus citée par personne, et une ancre morte est
    // refusée par le validateur. On la retire pour que le refus mesuré soit
    // bien celui de la porte ④ — la recette ne redonne pas ses exemples.
    delete (tordue["ancres"] as Record<string, unknown>)["etiquette_timbre"];
    const { generation } = proposer(tordue);
    const g = await generation;
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "NE_REPRODUIT_PAS_SES_EXEMPLES");
    assert.match(g.ok === false ? g.refus.detail : "", /droit .*: désigné p1:/);
  });

  it("un code que les exemples n'ont pas déclaré est refusé — c'est un code DEVINÉ", async () => {
    /*
     * La barrière R3, sur l'autre chose que le modèle écrit sans la lire. Le
     * code choisi ici EXISTE au pack — c'est le second cas qui compte : la
     * liste du pack dit dans quel ensemble ces codes vivent, elle n'autorise
     * pas à y puiser. Un code de droit décide d'un compte ; le choisir est
     * émettre une valeur liante.
     */
    const autre = codesDuPack.droits.find((c) => c !== codeDuTimbre);
    assert.ok(autre, "le pack doit porter un second droit pour que ce cas ait un sens");
    const tordue = structuredClone(RECETTE_FACTURE_A_TIMBRE as Record<string, unknown>) as Record<
      string,
      unknown
    >;
    (tordue["droits"] as { timbre: Record<string, unknown> }).timbre["code"] = autre;
    const { generation } = proposer(tordue);
    const g = await generation;
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "CODE_HORS_DES_EXEMPLES");
    assert.match(g.ok === false ? g.refus.detail : "", new RegExp(autre));
  });

  it("sans droit déclaré par les exemples, aucune section « droits » ne passe", async () => {
    /*
     * Le sens de l'absence, et il faut qu'il soit celui-là : un exemple qui
     * n'affirme rien sur les droits n'autorise pas à en inventer un. Le format
     * sans timbre reste lisible — simplement, il n'aura pas de droit.
     */
    const muets = exemples().map((e) => ({ ...e, droitsAttendus: {} }));
    const { generation } = proposer(RECETTE_FACTURE_A_TIMBRE, muets);
    const g = await generation;
    assert.equal(g.ok, false);
    assert.equal(g.ok === false && g.refus.code, "CODE_HORS_DES_EXEMPLES");
  });

  /*
   * ============== ④ CE QUE LA RECETTE ACCEPTÉE VAUT, JUSQU'AU MOTEUR D'ÉQUILIBRE
   *
   * La seule mesure qui réponde à la question. `extract.v1` est une forme et
   * ne vérifie aucune équation : un contrat `valid` peut être faux, et c'est
   * ce qui a rendu un premier banc vert pour la mauvaise raison le 19 octobre.
   */
  it("la recette PROPOSÉE rend une écriture proposable, et le droit est cité", async () => {
    const { generation } = proposer(RECETTE_FACTURE_A_TIMBRE);
    const g = await generation;
    assert.equal(g.ok, true, g.ok === false ? `${g.refus.code} : ${g.refus.detail}` : "");
    if (!g.ok) return;

    const plan = FACTURE_A_TIMBRE();
    const versions: ContexteDeFabrique["versions"] = [
      {
        versionId: "99999999-9999-4999-8999-999999999999",
        recetteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        rang: 1,
        libelle: "proposée par le générateur",
        etat: "active",
        // La recette TELLE QUE LE GÉNÉRATEUR L'A RENDUE : rien n'est réécrit
        // entre la proposition et la lecture.
        definition: g.recette,
        plansDApprentissage: [FACTURE_A_TIMBRE(), FACTURE_A_TIMBRE_AUTRES_VALEURS()],
      },
    ];
    const designation = designerParRecette(
      [...plan],
      {
        signature: SIGNATURE,
        distance: DISTANCE,
        classement: CLASSEMENT,
        bornes: EXIGENCES,
        versions,
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
    const extract = lu.extract as unknown as ExtractV1;
    assert.equal(lu.valid, true, "le contrat ne PARSE pas : « proposable » n'a pas de sens");
    assert.deepEqual(
      extract.other_charges.map((c) => c.code),
      [codeDuTimbre],
      "la recette proposée ne sort aucun droit",
    );
    assert.ok(
      lu.citations.some((c) => c.field === "other_charges[0].amount"),
      "le montant du droit n'est pas cité : un montant sans preuve d'origine",
    );
    assert.deepEqual(
      extract.lines.map((l) => l.tax_code),
      [codeDuTaux],
      "la ligne de taux ne porte pas le code du pack",
    );

    const pivot = computePivot({
      extract,
      source_item_id: null,
      tenant_currency: { code: "TND", decimals: DECIMALES },
      tax_rates,
      mapping: imputation,
      fiscal_charges,
      tolerances: TOLERANCES,
    });
    assert.deepEqual(
      pivot.motifs.filter((x) => x.severity === "block").map((x) => `${x.code} — ${x.message}`),
      [],
      "une recette PROPOSÉE par le générateur bloque l'écriture",
    );
    assert.deepEqual(
      pivot.motifs.filter((x) => x.code.startsWith("RESIDUAL")).map((x) => x.code),
      [],
      "le pied ne boucle pas : il reste un résidu à attribuer",
    );
    assert.equal(pivot.totals.debit, pivot.totals.credit, "débit et crédit au millime");
    assert.equal(pivot.approvable, true);
  });
});
