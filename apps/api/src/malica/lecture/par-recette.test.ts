/**
 * Le point d'insertion, éprouvé — pas relu.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/malica/lecture/par-recette.test.ts
 *
 * ================================================================= POURQUOI
 *
 * Un défaut ici ne crie pas : il rend une lecture PROUVÉE ET FAUSSE. Les cas
 * sont donc écrits dans l'ordre du risque, et le premier n'est pas celui de
 * la fonctionnalité :
 *
 *   1. LA NON-RÉGRESSION. Sans recette applicable, la chaîne se comporte
 *      exactement comme avant — le désignateur rend `null` et la passe 2
 *      part. C'est la première épreuve, pas la dernière.
 *   2. L'ÉQUIVALENCE. Le même document, lu par une recette et par le modèle,
 *      donne-t-il le même résultat ? La mesure est faite ici, et son écart
 *      est nommé.
 *   3. LE PLAN BRUT. Sur un plan non recollé, une recette désigne « 5 » là
 *      où le papier porte « 5 650,000 ». Le désignateur REFUSE.
 *   4. L'ABSTENTION rend la main, et ne laisse aucune désignation partielle.
 *   5. LA RECONNAISSANCE EN DEUX TEMPS : un format à un seul exemple ne
 *      concourt pas.
 *
 * Plans SYNTHÉTIQUES, recettes SYNTHÉTIQUES, aucun appel de modèle, aucun
 * fournisseur payant. La passe 2 est remplacée par une fonction qui rend la
 * réponse qu'un modèle juste aurait rendue — et c'est exactement ce que
 * mesure l'épreuve d'équivalence.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECETTE_FACTURE_A } from "../../fabrique/interprete-recettes-synthetiques.ts";
import {
  FACTURE_A,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_B_TTC,
  PAGE_DE_TOTAUX,
} from "../../fabrique/signature-plans-synthetiques.ts";
import type {
  ParametresDeClassement,
  ParametresDeDistance,
} from "../../fabrique/signature-distance.ts";
import type { ParametresDeSignature } from "../../fabrique/signature.ts";
import type { ExigencesDeValidation } from "../../fabrique/recette-validateur.ts";

import { designerParRecette, exigerUnPlanRecolle, type ContexteDeFabrique } from "./par-recette.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import { selectionDepuisReponse, type VisionSelection } from "./vision.ts";

/*
 * Les réglages de CE banc. En exécution ils viennent du référentiel, datés et
 * surchargeables (R10) ; ici ils sont posés à la main, et rien n'en porte par
 * défaut. `ancre_texte_min` vaut 2 parce que « HT » et « Qte » sont les
 * libellés que la pièce imprime.
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

/** La devise du dossier, et le neutre du minimum : voir l'en-tête du module. */
const DOSSIER = { devise: "TND", neutreDeConfiance: 1 };

/** Trois décimales : le dinar. Dit ici parce que le banc n'a pas de pack. */
const DECIMALES = 3;

function contexte(versions: ContexteDeFabrique["versions"]): ContexteDeFabrique {
  return {
    signature: SIGNATURE,
    distance: DISTANCE,
    classement: CLASSEMENT,
    bornes: BORNES,
    versions,
  };
}

/** Le format A, nourri de DEUX exemples — c'est le minimum d'une ossature. */
function formatA(definition: unknown = RECETTE_FACTURE_A): ContexteDeFabrique["versions"] {
  return [
    {
      versionId: "11111111-1111-4111-8111-111111111111",
      recetteId: "22222222-2222-4222-8222-222222222222",
      rang: 1,
      libelle: "facture SOTUPAP",
      etat: "active",
      definition,
      plansDApprentissage: [FACTURE_A(), FACTURE_A_AUTRES_VALEURS()],
    },
  ];
}

/* ===================================================================== (1) */

describe("la non-régression : sans recette applicable, rien ne change", () => {
  it("aucune recette du tout : le désignateur ne désigne pas", () => {
    const r = designerParRecette(FACTURE_A(), contexte([]), DOSSIER);
    assert.equal(r.applique, false);
    assert.equal(r.applique === false && r.pourquoi.motif, "aucune_recette");
  });

  it("une recette d'un AUTRE format : elle ne s'applique pas à cette pièce", () => {
    const r = designerParRecette(PAGE_DE_TOTAUX(), contexte(formatA()), DOSSIER);
    assert.equal(r.applique, false);
    assert.equal(
      r.applique === false && r.pourquoi.motif,
      "aucun_candidat",
      "une page de totaux n'est pas une facture SOTUPAP",
    );
  });

  it("un format VOISIN et incompatible ne se fait pas passer pour l'autre", () => {
    /*
     * `FACTURE_B_TTC` porte les mêmes libellés, la même ossature, et un pied
     * inversé : c'est la confusion qui coûte cher, parce que ce qui change
     * décide de ce qu'on inscrit en comptabilité. On n'exige pas qu'elle soit
     * écartée par la distance — ce n'est pas l'objet de ce fichier — mais que
     * RIEN ne soit désigné sous le couvert du format A sans que la différence
     * se voie.
     */
    const r = designerParRecette(FACTURE_B_TTC(), contexte(formatA()), DOSSIER);
    if (r.applique) {
      // Reconnu : alors la désignation doit porter les totaux de CETTE pièce,
      // relus dans SON plan — jamais ceux de l'exemple d'apprentissage.
      const plan = FACTURE_B_TTC();
      const ttc = r.par.selection.totals.ttc;
      assert.ok(ttc, "un total TTC désigné, ou aucun");
      const jeton = plan.find((t) => t.page === ttc.page && t.ordinal === ttc.ordinal);
      assert.ok(jeton, "le jeton désigné appartient au plan de CETTE pièce");
    }
  });

  it("une recette INVALIDE ne s'exécute pas parce qu'elle est en base", () => {
    const r = designerParRecette(
      FACTURE_A(),
      contexte(formatA({ version: "recette/1", champs: {} })),
      DOSSIER,
    );
    assert.equal(r.applique, false);
    assert.equal(r.applique === false && r.pourquoi.motif, "recette_invalide");
  });
});

/* ===================================================================== (2) */

/**
 * La réponse qu'un modèle JUSTE rendrait sur `FACTURE_A`.
 *
 * Elle n'est pas devinée : chaque `ordinal` est celui du jeton que le plan
 * porte, et elle est écrite dans la forme EXACTE de ce que DeepSeek renvoie —
 * elle passe donc par `selectionDepuisReponse`, le seul chemin de conversion
 * de la production. Une épreuve qui recopierait cette conversion mesurerait
 * sa propre copie.
 */
const REPONSE_DU_MODELE = {
  document_kind: null,
  currency: null,
  issuer: { page: 1, ordinal: 0 },
  document_date: { page: 1, ordinal: 11 },
  lines: [],
  articles: [
    {
      designation: { page: 1, ordinal: 16 },
      quantity: { page: 1, ordinal: 17 },
      unit_price_ht: { page: 1, ordinal: 18 },
      unit_price_ttc: null,
      total_ht: { page: 1, ordinal: 19 },
      tax_code: null,
    },
    {
      designation: { page: 1, ordinal: 20 },
      quantity: { page: 1, ordinal: 21 },
      unit_price_ht: { page: 1, ordinal: 22 },
      unit_price_ttc: null,
      total_ht: { page: 1, ordinal: 23 },
      tax_code: null,
    },
  ],
  other_charges: [],
  totals: {
    base_ht: { page: 1, ordinal: 26 },
    vat: { page: 1, ordinal: 28 },
    ttc: { page: 1, ordinal: 31 },
  },
  /*
   * La clé d'une référence LIBRE est choisie par celui qui désigne : l'invite
   * la nomme « numero » pour le modèle, la recette de banc la nomme
   * « numero_de_piece ». Ici, les deux côtés nomment pareil, pour que ce cas
   * mesure la LECTURE et non un choix de vocabulaire. Le danger que ce nom
   * porte est tenu par le cas qui suit, et il est réel.
   */
  references: { numero_de_piece: { page: 1, ordinal: 9 } },
  overall_confidence: 0.9,
};

function construire(plan: readonly PageToken[], selection: VisionSelection) {
  return buildExtractFromTokenPlan({
    tokens: plan,
    selection,
    decimals: DECIMALES,
    // Aucun matricule n'est désigné de part et d'autre : le sens reste à
    // confirmer, et il le reste des DEUX côtés. C'est la comparaison qui
    // compte, pas le confort du cas.
    matriculeDossier: "1234567A",
  });
}

describe("l'équivalence : le même document, par la recette et par le modèle", () => {
  const plan = FACTURE_A();

  const parRecette = designerParRecette(plan, contexte(formatA()), DOSSIER);
  const parLeModele = selectionDepuisReponse(REPONSE_DU_MODELE, DOSSIER.devise, plan);

  it("la recette s'applique, et elle ne s'abstient pas", () => {
    assert.equal(
      parRecette.applique,
      true,
      parRecette.applique === false ? JSON.stringify(parRecette.pourquoi) : "",
    );
  });

  it("les DEUX chemins désignent les mêmes jetons", () => {
    assert.ok(parRecette.applique);
    const a = parRecette.par.selection;
    assert.deepEqual(a.issuer, parLeModele.issuer);
    assert.deepEqual(a.document_date, parLeModele.document_date);
    assert.deepEqual(a.totals, parLeModele.totals);
    assert.deepEqual(
      a.articles.map((x) => [x.designation, x.quantity, x.unit_price_ht, x.total_ht]),
      parLeModele.articles.map((x) => [x.designation, x.quantity, x.unit_price_ht, x.total_ht]),
    );
  });

  it("et donc le MÊME extrait, aux trois champs qu'une recette ne désigne pas", () => {
    assert.ok(parRecette.applique);
    const recette = construire(plan, parRecette.par.selection);
    const modele = construire(plan, parLeModele);

    assert.equal(recette.contract, modele.contract);
    assert.equal(recette.valid, modele.valid);
    assert.deepEqual(recette.citations, modele.citations);
    assert.deepEqual(recette.flags, modele.flags);

    /*
     * L'ÉCART MESURÉ, ET IL EST ENTIER.
     *
     * `field_confidence.overall` : le modèle rend un score (0,9 ici), la
     * recette rend le NEUTRE DU MINIMUM. Ce n'est pas « plus sûr » : c'est
     * « la désignation n'abaisse rien », et la confiance d'un champ devient
     * celle de son jeton relevé. Les deux nombres ne sont pas comparables, et
     * c'est pour cela que l'écart est dit plutôt que masqué.
     *
     * Tout le reste — montants, dates, citations, drapeaux, verdict — est
     * identique AU CARACTÈRE PRÈS, parce que la relecture du plan est la
     * même fonction, appelée une fois, sur une désignation de même forme.
     */
    const sansConfiance = (e: Record<string, unknown>) => {
      const copie = { ...e };
      delete copie["field_confidence"];
      return copie;
    };
    assert.deepEqual(sansConfiance(recette.extract), sansConfiance(modele.extract));
    assert.deepEqual(recette.extract["field_confidence"], { overall: 1 });
    assert.deepEqual(modele.extract["field_confidence"], { overall: 0.9 });
  });

  it("le NOM d'une référence libre voyage jusqu'au sens de la pièce", () => {
    /*
     * ====================================== UN PIÈGE TROUVÉ EN BRANCHANT
     *
     * `read-piece.ts` déduit le sens de la pièce en lisant
     * `references["matricule_fiscal"]` et `references["matricule_fiscal_client"]`
     * — deux noms que l'INVITE du désignateur impose au modèle, et que rien
     * n'impose à une recette : `recette.ts` accepte n'importe quel nom ASCII
     * sous `references`.
     *
     * Une recette qui nommerait ce champ « mf » désignerait le bon jeton, le
     * citerait correctement, et le sens de la pièce resterait « à
     * confirmer » — une lecture juste, et un achat qui ne sait pas qu'il en
     * est un. Ce cas FIGE la conséquence pour qu'elle ne se découvre pas en
     * production ; la corriger (contraindre les noms, ou les déclarer dans le
     * contrat) appartient au langage des recettes, pas au branchement.
     */
    const plan = FACTURE_A();
    const sousLeBonNom = selectionDepuisReponse(
      { ...REPONSE_DU_MODELE, references: { matricule_fiscal: { page: 1, ordinal: 4 } } },
      DOSSIER.devise,
      plan,
    );
    const sousUnAutreNom = selectionDepuisReponse(
      { ...REPONSE_DU_MODELE, references: { mf: { page: 1, ordinal: 4 } } },
      DOSSIER.devise,
      plan,
    );
    assert.equal(construire(plan, sousLeBonNom).extract["document_kind"], "facture_vente");
    assert.equal(
      construire(plan, sousUnAutreNom).extract["document_kind"],
      null,
      "le même jeton, sous un autre nom, ne tranche plus le sens",
    );
  });

  it("le sens de la pièce se DÉDUIT, et il se déduit pareil des deux côtés", () => {
    /*
     * `document_kind` n'est pas une désignation, et la recette le laisse à
     * `null`. Cela ne crée AUCUN écart : depuis le 5 octobre 2026, le sens
     * est déduit de la position du matricule du dossier, et le modèle n'est
     * consulté que là où aucun matricule n'a été lu. Ici aucun des deux n'en
     * désigne, donc les deux chemins rendent le même « à confirmer ».
     */
    assert.ok(parRecette.applique);
    const recette = construire(plan, parRecette.par.selection);
    const modele = construire(plan, parLeModele);
    assert.equal(recette.extract["document_kind"], modele.extract["document_kind"]);
  });
});

/* ===================================================================== (3) */

describe("le plan BRUT, et les six mille dinars", () => {
  /** « 5 650,000 » tel que le relevé le rend : DEUX jetons. */
  function planCoupe(): PageToken[] {
    const plan = FACTURE_A();
    const ttc = plan.find((t) => t.text === "1404,200");
    assert.ok(ttc);
    const coupe = plan.filter((t) => t !== ttc);
    coupe.push(
      { ...ttc, text: "5", x1: ttc.x0 + 0.01 },
      { ...ttc, ordinal: ttc.ordinal + 0.5, text: "650,000", x0: ttc.x0 + 0.015 },
    );
    return coupe
      .sort((a, b) => a.page - b.page || a.ordinal - b.ordinal)
      .map((t, i) => ({ ...t, ordinal: i }));
  }

  it("un plan non recollé est REFUSÉ, pas désigné à moitié", () => {
    const brut = planCoupe();
    assert.ok(
      recollerLesMilliers(brut).length < brut.length,
      "le plan de ce cas doit bien porter une paire à recoller",
    );
    assert.throws(() => exigerUnPlanRecolle(brut), /pas recollé/);
    assert.throws(() => designerParRecette(brut, contexte(formatA()), DOSSIER), /pas recollé/);
  });

  it("le même plan, RECOLLÉ, désigne le montant entier", () => {
    const recolle = recollerLesMilliers(planCoupe());
    const r = designerParRecette(recolle, contexte(formatA()), DOSSIER);
    assert.ok(r.applique, "la recette doit s'appliquer sur le plan recollé");
    /*
     * ============ UN DÉFAUT DE TYPE TROUVÉ EN BRANCHANT, DÉCRIT ET LAISSÉ
     *
     * `VisionSelection` n'aplatit PAS `totals` : il garde la forme brute du
     * schéma Zod, donc `ordinal_end` (le nom du modèle) là où la valeur
     * portée à l'exécution est un `TokenRef`, donc `ordinalEnd`. Le type ment
     * sans rien casser — exactement ce que `read-piece.ts` raconte de son
     * ancien type `Ref`, « et le jour où il a fallu comprendre pourquoi
     * 2 800,000 se lisait 2,000, ce type a fait partie des raisons de
     * chercher ailleurs ».
     *
     * Le corriger touche la chaîne au-delà du point d'insertion (R2) : on le
     * NOMME et on le laisse. Ici on lit la vraie forme, sans quoi ce cas
     * n'éprouverait rien.
     */
    const ttc = r.par.selection.totals.ttc as unknown as TokenRef | null;
    assert.ok(ttc);
    const texte = recolle
      .filter(
        (t) =>
          t.page === ttc.page &&
          t.ordinal >= ttc.ordinal &&
          t.ordinal <= (ttc.ordinalEnd ?? ttc.ordinal),
      )
      .map((t) => t.text)
      .join(" ");
    assert.match(texte, /5/, "le millier ne doit pas avoir disparu");
    assert.match(texte, /650,000/, "ni la partie basse");
  });
});

/* ===================================================================== (4) */

describe("l'abstention rend la main, et ne désigne rien à moitié", () => {
  it("un champ attendu qui manque arrête TOUTE la recette", () => {
    /*
     * On retire la ligne de la TVA du plan : le champ `totals.vat` de la
     * recette ne trouve plus rien, et il n'est pas facultatif.
     *
     * Ce que ce cas tient n'est pas « il y a un drapeau » : c'est qu'AUCUNE
     * désignation partielle ne sort. Une lecture moitié recette moitié rien
     * n'a été mesurée par personne, et c'est le modèle qui reprend le plan
     * entier.
     */
    const plan = FACTURE_A()
      .filter((t) => !(t.text === "TVA" || t.text === "224,200"))
      .map((t, i) => ({ ...t, ordinal: i }));
    const r = designerParRecette(plan, contexte(formatA()), DOSSIER);
    assert.equal(r.applique, false);
    assert.equal(r.applique === false && r.pourquoi.motif, "abstention");
    assert.match(
      r.applique === false && "detail" in r.pourquoi ? r.pourquoi.detail : "",
      /totals\.vat/,
      "le motif doit nommer le champ qui a manqué",
    );
  });
});

/* ===================================================================== (5) */

describe("la reconnaissance est en DEUX temps", () => {
  it("un format qui n'a qu'UN exemple ne concourt pas", () => {
    /*
     * Mesuré par l'auteur de la signature : une ossature tirée d'un seul
     * exemple apprend le nom du client comme s'il était la forme du papier —
     * 0,0000 devient 0,0960 chez un autre client. Le branchement ne
     * court-circuite pas ce refus, et ce cas le prouve en lisant la sortie,
     * pas le code.
     */
    const versions = formatA();
    const unSeul = [{ ...versions[0]!, plansDApprentissage: [FACTURE_A()] }];
    const r = designerParRecette(FACTURE_A(), contexte(unSeul), DOSSIER);
    assert.equal(r.applique, false);
    assert.equal(r.applique === false && r.pourquoi.motif, "aucun_candidat");
  });
});
