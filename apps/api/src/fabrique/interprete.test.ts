/**
 * L'interprète déterministe, éprouvé — pas relu.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env \
 *     --env-file-if-exists=.env.test --import ./src/garde-base-de-test.ts \
 *     --test src/fabrique/interprete.test.ts
 *
 * ================================================================= POURQUOI
 *
 * Une recette remplace un appel de modèle. Elle hérite de toute la confiance
 * qu'on plaçait en lui et d'aucun de ses garde-fous — rien ne relit une
 * désignation déterministe, puisqu'elle est déterministe.
 *
 * Les cas sont donc écrits à l'envers de la complaisance. Le premier d'entre
 * eux ne juge pas une désignation : il juge le TYPE, et vérifie qu'aucun
 * résultat de champ ne porte de valeur. C'est la règle ① du plan, et c'est la
 * seule qui, si elle tombe, rend toutes les autres sans objet.
 *
 * Plans SYNTHÉTIQUES (`signature-plans-synthetiques.ts`), recettes
 * SYNTHÉTIQUES (`interprete-recettes-synthetiques.ts`). Aucun appel de
 * modèle, aucun fournisseur payant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PageToken } from "@malica/socle/ports/malica";

import { recollerLesMilliers } from "../malica/lecture/recoller-les-milliers.ts";
import type { VisionSelection } from "../malica/lecture/vision.ts";

import { interpreter } from "./interprete.ts";
import {
  RECETTE_FACTURE_A,
  RECETTE_FACTURE_ARABE,
  RECETTE_FACTURE_A_TIMBRE,
} from "./interprete-recettes-synthetiques.ts";
import { sortieDeRecette, type DesignationDeRecette } from "./interprete-sortie.ts";
import { correspond, formeDuJeton } from "./interprete-texte.ts";
import { validerRecette, type ExigencesDeValidation } from "./recette-validateur.ts";
import type { Motif, Recette, ResultatDeChamp } from "./recette.ts";
import {
  FACTURE_A,
  FACTURE_ARABE,
  FACTURE_A_AUTRES_VALEURS,
  FACTURE_A_DEUX_PAGES,
  FACTURE_A_SIX_LIGNES,
  FACTURE_A_TIMBRE,
  FACTURE_B_TTC,
  FACTURE_MIXTE,
  incliner,
  recadrer,
} from "./signature-plans-synthetiques.ts";
import type { ParametresDeSignature } from "./signature.ts";

/*
 * Les réglages de CE banc. En exécution ils viennent de
 * `fabrique.reglages_de_signature`, daté et surchargeable (R10) ; ici ils sont
 * posés à la main, et l'interprète n'en connaît aucun par défaut.
 *
 * `ancre_texte_min` vaut 2 : « HT » et « Qte » sont les libellés que la pièce
 * imprime, et une borne à 3 les refuserait. Le référentiel livre 3 et un
 * cabinet l'abaisse sans déploiement — c'est précisément ce que R10 prévoit.
 */
const PARAMETRES: ParametresDeSignature = {
  longueurMinimaleDAncre: 2,
  bandesParPage: 3,
  partMinimaleDuSens: 0.6,
  recouvrementDeLigne: 0.5,
  recouvrementDeColonne: 0.5,
  ancresEnRelationMax: 40,
};

const EXIGENCES: ExigencesDeValidation = {
  ancre_texte_min: 2,
  selecteurs_max: 200,
  champs_max: 50,
  jetons_max: 12,
  rang_max: 50,
};

function valider(brut: unknown): Recette {
  const v = validerRecette(brut, EXIGENCES);
  if (!v.ok) {
    assert.fail(
      `recette de banc invalide : ${v.refus.map((r) => `${r.code} @ ${r.ou}`).join(", ")}`,
    );
  }
  return v.recette;
}

const RECETTE_A = valider(RECETTE_FACTURE_A);
const RECETTE_A_TIMBRE = valider(RECETTE_FACTURE_A_TIMBRE);
const RECETTE_AR = valider(RECETTE_FACTURE_ARABE);

/** Le texte que porte le jeton désigné — relu DANS LE PLAN, jamais rendu par l'interprète. */
function texteDesigne(plan: readonly PageToken[], resultat: ResultatDeChamp | undefined): string {
  if (!resultat || !("designe" in resultat)) return "";
  const { page, ordinal, ordinalEnd } = resultat.designe;
  return plan
    .filter((t) => t.page === page && t.ordinal >= ordinal && t.ordinal <= (ordinalEnd ?? ordinal))
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((t) => t.text)
    .join(" ");
}

const abstentionDe = (r: ResultatDeChamp | undefined) =>
  r && "abstention" in r ? r.abstention : null;

/*
 * Les noms de la sortie sont CEUX de la chaîne, et c'est le compilateur qui
 * le dit — pas un commentaire. Le jour où `VisionSelection` renomme un champ,
 * ce fichier ne compile plus, et `npm run typecheck` le dit avant qu'une
 * désignation ne parte dans le vide.
 */
type MemesNoms = DesignationDeRecette["issuer"] extends VisionSelection["issuer"] | null
  ? DesignationDeRecette["totals"]["base_ht"] extends
      NonNullable<VisionSelection["totals"]>["base_ht"] | null
    ? true
    : never
  : never;
const NOMS_TENUS: MemesNoms = true;

/* ====================================================================== */

describe("la règle ① : l'interprète ne lit aucune valeur", () => {
  it("aucun résultat de champ ne porte autre chose qu'une désignation", () => {
    /*
     * La garantie est portée par le TYPE — `{ designe } | { abstention } |
     * { absent }` n'a aucune branche où écrire un montant. Ce cas la vérifie
     * à l'exécution, parce qu'un `jsonb`, une sérialisation ou un `as` futur
     * pourraient la contourner là où le compilateur ne regarde plus.
     *
     * Les clés admises sont closes. Toute clé nouvelle fait échouer ce cas,
     * et c'est l'intention : elle devra être justifiée ici avant d'exister.
     */
    const ADMISES = new Set(["designe", "abstention", "detail", "absent"]);
    const resultat = interpreter(RECETTE_A, FACTURE_A(), PARAMETRES);

    const tous: ResultatDeChamp[] = [
      ...Object.values(resultat.champs),
      ...resultat.lignes.flatMap((l) => Object.values(l)),
      ...resultat.articles.flatMap((a) => Object.values(a)),
      // Les droits hors TVA aussi : c'est la partie du langage qui a le plus
      // de raisons de porter une valeur, puisqu'elle NOMME un code. Le code
      // vit sur le droit, pas sur son résultat, et ce relevé le vérifie.
      ...resultat.droits.map((d) => d.resultat),
    ];
    assert.ok(tous.length > 0, "la recette n'a rien produit : le cas ne prouve rien");

    for (const r of tous) {
      for (const cle of Object.keys(r)) {
        assert.ok(ADMISES.has(cle), `clé interdite dans un résultat de champ : ${cle}`);
      }
      if ("designe" in r) {
        assert.deepEqual(
          Object.keys(r.designe).sort(),
          Object.keys(r.designe)
            .filter((k) => ["page", "ordinal", "ordinalEnd"].includes(k))
            .sort(),
          "une désignation porte autre chose que page / ordinal / ordinalEnd",
        );
      }
    }
  });

  it("et la sortie porte les noms de la chaîne — le compilateur en répond", () => {
    assert.equal(NOMS_TENUS, true);
  });

  it("et la sortie vers la chaîne n'en porte pas davantage", () => {
    const { designation } = sortieDeRecette(interpreter(RECETTE_A, FACTURE_A(), PARAMETRES));
    const serialise = JSON.stringify(designation);
    for (const interdit of ["valeur", "value", "montant", "amount", "text"]) {
      assert.ok(
        !serialise.includes(`"${interdit}"`),
        `la sortie porte une clé « ${interdit} » : c'est un second lecteur de valeurs qui commence`,
      );
    }
  });

  it("un DROIT hors TVA ne fait pas exception : son montant reste une désignation", () => {
    /*
     * La sortie d'un droit porte bien une clé `amount` — c'est le nom que
     * `VisionSelection.other_charges` exige — mais ce qu'elle porte est un
     * `page`/`ordinal`, jamais un nombre ni un texte. Le relevé de clés
     * ci-dessus ne suffit donc pas ici, et ce cas inspecte la VALEUR.
     */
    const { designation } = sortieDeRecette(
      interpreter(RECETTE_A_TIMBRE, FACTURE_A_TIMBRE(), PARAMETRES),
    );
    assert.equal(designation.other_charges.length, 1);
    const droit = designation.other_charges[0]!;
    assert.deepEqual(
      Object.keys(droit.amount ?? {}).sort(),
      ["ordinal", "page"],
      "un montant de droit porte une place, et rien de plus",
    );
    assert.equal(
      typeof droit.code,
      "string",
      "le code, lui, est bien un texte — il vient du référentiel, pas de la pièce",
    );
  });
});

/* ====================================================================== */

describe("un droit hors TVA : désigné, abstenu, ou absent", () => {
  it("le droit de timbre est désigné là où la pièce l'imprime", () => {
    const plan = FACTURE_A_TIMBRE();
    const r = interpreter(RECETTE_A_TIMBRE, plan, PARAMETRES);
    assert.equal(r.droits.length, 1);
    assert.equal(r.droits[0]!.code, "DROIT_TIMBRE");
    assert.equal(texteDesigne(plan, r.droits[0]!.resultat), "1,000");
  });

  it("un droit ATTENDU que la pièce ne porte pas s'ABSTIENT — il ne vaut pas zéro", () => {
    /*
     * C'est le cas qui compte le plus : un droit absent inscrit à zéro ferait
     * boucler l'équation du pied en inventant un fait. Retirer la ligne du
     * timbre d'une facture qui le déclare doit rendre la main, avec le motif.
     */
    const plan = FACTURE_A_TIMBRE()
      .filter((t) => !(t.text === "timbre" || t.text === "1,000"))
      .map((t, i) => ({ ...t, ordinal: i }));
    const r = interpreter(RECETTE_A_TIMBRE, plan, PARAMETRES);
    assert.equal(abstentionDe(r.droits[0]?.resultat), "TOKEN_NOT_FOUND");

    const { designation, flags, sAbstient } = sortieDeRecette(r);
    assert.deepEqual(designation.other_charges, [], "aucune entrée inventée");
    assert.equal(sAbstient, true);
    assert.ok(
      flags.some((f) => f.field === "other_charges[0].amount"),
      "le drapeau porte le nom sous lequel la chaîne cite un droit",
    );
  });

  it("un droit FACULTATIF absent ne produit ni entrée ni drapeau", () => {
    /*
     * Une facture sans timbre existe — un avoir, une facture export —, et le
     * format est le même. Déclarer le droit facultatif doit alors rendre
     * exactement ce que le modèle rend : un tableau vide, et aucun reproche.
     */
    const facultatif = valider({
      ...(RECETTE_FACTURE_A_TIMBRE as Record<string, unknown>),
      droits: {
        timbre: {
          ...(RECETTE_FACTURE_A_TIMBRE as { droits: { timbre: Record<string, unknown> } }).droits
            .timbre,
          facultatif: true,
        },
      },
    });
    const plan = FACTURE_A()
      .concat()
      .map((t, i) => ({ ...t, ordinal: i }));
    const r = interpreter(facultatif, plan, PARAMETRES);
    const { designation, flags } = sortieDeRecette(r);
    assert.deepEqual(designation.other_charges, []);
    assert.deepEqual(
      flags.filter((f) => f.field.startsWith("other_charges")),
      [],
    );
  });
});

describe("le même format, d'autres valeurs", () => {
  it("la même recette s'applique, et désigne les mêmes places", () => {
    const a = FACTURE_A();
    const b = FACTURE_A_AUTRES_VALEURS();
    const ra = interpreter(RECETTE_A, a, PARAMETRES);
    const rb = interpreter(RECETTE_A, b, PARAMETRES);

    assert.deepEqual(
      ra.champs["totals.ttc"],
      rb.champs["totals.ttc"],
      "deux exemplaires du même format ne désignent pas le même ordinal",
    );
    assert.equal(texteDesigne(a, ra.champs["totals.ttc"]), "1404,200");
    assert.equal(texteDesigne(b, rb.champs["totals.ttc"]), "4688,600");
    assert.equal(texteDesigne(a, ra.champs["issuer"]), "SOTUPAP");
    assert.equal(texteDesigne(a, ra.champs["document_date"]), "04/10/2026");
    assert.equal(texteDesigne(a, ra.champs["references.numero_de_piece"]), "FA-2026-118");
  });

  it("une facture longue rend autant de lignes qu'elle en porte", () => {
    const plan = FACTURE_A_SIX_LIGNES();
    const r = interpreter(RECETTE_A, plan, PARAMETRES);
    assert.equal(r.articles.length, 6, "le nombre de lignes n'est pas celui de la pièce");
    assert.equal(texteDesigne(plan, r.articles[5]?.["total_ht"]), "2280,000");
  });
});

describe("le cadrage et la pente", () => {
  /*
   * Le cas ORDINAIRE du produit : une photo au téléphone, jamais deux fois le
   * même cadrage. Une recette calée sur des coordonnées tomberait ici.
   */
  for (const [nom, deformer] of [
    ["recadrée", (t: PageToken[]) => recadrer(t, 0.04, 0.03, 0.9)],
    ["inclinée", (t: PageToken[]) => incliner(t, 0.01)],
  ] as const) {
    it(`désigne les mêmes jetons sur une pièce ${nom}`, () => {
      const droite = interpreter(RECETTE_A, FACTURE_A(), PARAMETRES);
      const tordue = interpreter(RECETTE_A, deformer(FACTURE_A()), PARAMETRES);
      assert.deepEqual(tordue.champs, droite.champs);
      assert.equal(tordue.articles.length, droite.articles.length);
    });
  }
});

describe("l'arabe, le sens de lecture, et les pages mixtes", () => {
  it("« après » suit l'axe de lecture, et non l'abscisse", () => {
    const plan = FACTURE_ARABE();
    const r = interpreter(RECETTE_AR, plan, PARAMETRES);
    assert.equal(texteDesigne(plan, r.champs["document_date"]), "04/10/2026");
    assert.equal(texteDesigne(plan, r.champs["totals.ttc"]), "1300,000");
    assert.equal(texteDesigne(plan, r.champs["totals.vat"]), "247,000");
  });

  it("un champ facultatif que la pièce ne porte pas est ABSENT, sans drapeau", () => {
    const r = interpreter(RECETTE_AR, FACTURE_ARABE(), PARAMETRES);
    assert.deepEqual(r.champs["issuer"], { absent: true });
    const { flags } = sortieDeRecette(r);
    assert.ok(
      !flags.some((f) => f.field === "issuer"),
      "un champ facultatif absent a produit un drapeau : la pièce ne le porte pas, ce n'est pas une faute",
    );
  });

  it("le sens déclaré PAR LE SÉLECTEUR l'emporte, sur une page mixte", () => {
    const plan = FACTURE_MIXTE();
    const commun = {
      version: "recette/1",
      chiffres: "les_deux",
      ancres: {
        etiquette_date: {
          depuis: { genre: "ancre", motif: { genre: "exact", texte: "Date" } },
          prendre: { genre: "unique" },
        },
      },
      champs: {
        issuer: {
          designation: {
            depuis: { genre: "voisin", de: "etiquette_date", direction: "apres" },
            prendre: { genre: "unique" },
          },
          si_absent: "MISSING_CITATION",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
      },
    };
    const enLatin = valider({ ...commun, sens_de_lecture: "ltr" });
    const enArabe = valider({ ...commun, sens_de_lecture: "rtl" });

    assert.equal(
      texteDesigne(plan, interpreter(enLatin, plan, PARAMETRES).champs["issuer"]),
      "التاريخ",
      "en lecture latine, « après Date » est ce qui se trouve à droite",
    );
    assert.equal(
      abstentionDe(interpreter(enArabe, plan, PARAMETRES).champs["issuer"]),
      "MISSING_CITATION",
      "en lecture arabe, rien ne se trouve avant « Date » : il n'y a pas de repli silencieux",
    );
  });

  it("reconnaît un nombre écrit en chiffres arabo-indiens — et seulement s'il est déclaré", () => {
    assert.equal(formeDuJeton("١٣٠٠,٠٠٠", "les_deux"), "nombre");
    assert.equal(
      formeDuJeton("١٣٠٠,٠٠٠", "latins"),
      null,
      "une recette qui ne déclare que les chiffres latins voit un nombre arabe : la déclaration ne sert à rien",
    );
  });
});

describe("les ancres répétées, et le refus de choisir", () => {
  it("deux jetons satisfont la règle : DESIGNATION_AMBIGUE, pas TOKEN_NOT_FOUND", () => {
    /*
     * « FACTURE » est imprimé deux fois sur ce format : en titre, et dans la
     * mention « Arretee la presente facture » du pied. Une recette qui exige
     * l'unicité doit donc refuser de choisir — et le DIRE avec le mot qui
     * convient. `TOKEN_NOT_FOUND` dirait le contraire de ce qui s'est passé.
     */
    const recette = valider({
      version: "recette/1",
      sens_de_lecture: "ltr",
      chiffres: "latins",
      ancres: {
        titre: {
          depuis: { genre: "ancre", motif: { genre: "exact", texte: "FACTURE" } },
          prendre: { genre: "unique" },
        },
      },
      champs: {
        issuer: {
          designation: {
            depuis: { genre: "ancre", motif: { genre: "exact", texte: "FACTURE" } },
            prendre: { genre: "unique" },
          },
          si_absent: "TOKEN_NOT_FOUND",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
        document_date: {
          designation: {
            depuis: { genre: "voisin", de: "titre", direction: "avant" },
            prendre: { genre: "premier" },
          },
          si_absent: "DATE_UNREADABLE",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
      },
    });
    const r = interpreter(recette, FACTURE_A(), PARAMETRES);
    assert.equal(abstentionDe(r.champs["issuer"]), "DESIGNATION_AMBIGUE");
    assert.match(
      (r.champs["issuer"] as { detail?: string }).detail ?? "",
      /2 jetons/,
      "l'abstention ne dit pas combien de jetons se disputaient la place",
    );
    /*
     * Et l'ambiguite REMONTE : un champ qui s'appuie sur une ancre ambigue
     * s'abstient avec le mot de l'ambiguite, pas avec celui de l'absence. Le
     * banc attendait d'abord `DATE_UNREADABLE` ; le code a eu raison contre
     * lui, car la date n'est pas illisible — c'est l'ancre qui ne designe rien.
     */
    assert.equal(
      abstentionDe(r.champs["document_date"]),
      "DESIGNATION_AMBIGUE",
      "une ancre ambiguë doit se propager en abstention, jamais se trancher au hasard",
    );
  });

  it("un champ attendu que la pièce ne porte pas s'abstient, et ne s'invente pas", () => {
    const recette = valider({
      version: "recette/1",
      sens_de_lecture: "ltr",
      chiffres: "latins",
      ancres: {
        etiquette_timbre: {
          depuis: { genre: "ancre", motif: { genre: "exact", texte: "Timbre" } },
          prendre: { genre: "unique" },
        },
      },
      champs: {
        "totals.vat": {
          designation: {
            depuis: { genre: "voisin", de: "etiquette_timbre", direction: "apres" },
            prendre: { genre: "unique" },
          },
          si_absent: "TOKEN_NOT_FOUND",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
      },
    });
    const r = interpreter(recette, FACTURE_A(), PARAMETRES);
    assert.equal(abstentionDe(r.champs["totals.vat"]), "TOKEN_NOT_FOUND");
    const { designation, sAbstient } = sortieDeRecette(r);
    assert.equal(designation.totals.vat, null, "une abstention a produit une référence");
    assert.equal(sAbstient, true);
  });
});

describe("les plages de jetons, et l'amputation", () => {
  /**
   * La facture du 18 octobre 2026, réduite à son pied : « 5 » et « 650,000 »
   * sont deux jetons collés que l'espace des milliers a coupés.
   *
   * Plan SYNTHÉTIQUE, calé sur les écarts MESURÉS cette nuit-là (une largeur
   * de caractère entre les deux morceaux, dix entre deux colonnes).
   */
  const PIED_COUPE = (): PageToken[] => [
    { page: 1, ordinal: 0, text: "Total", x0: 0.6, y0: 0.72, x1: 0.68, y1: 0.74 },
    { page: 1, ordinal: 1, text: "TTC", x0: 0.69, y0: 0.72, x1: 0.74, y1: 0.74 },
    { page: 1, ordinal: 2, text: "5", x0: 0.8, y0: 0.72, x1: 0.808, y1: 0.74 },
    { page: 1, ordinal: 3, text: "650,000", x0: 0.816, y0: 0.72, x1: 0.88, y1: 0.74 },
  ];

  const RECETTE_PIED = valider({
    version: "recette/1",
    sens_de_lecture: "ltr",
    chiffres: "latins",
    ancres: {
      etiquette_ttc: {
        depuis: { genre: "ancre", motif: { genre: "exact", texte: "TTC" } },
        prendre: { genre: "unique" },
      },
    },
    champs: {
      "totals.ttc": {
        designation: {
          depuis: { genre: "voisin", de: "etiquette_ttc", direction: "apres" },
          ou: [{ genre: "forme", forme: "nombre" }],
          prendre: { genre: "premier" },
        },
        si_absent: "TOKEN_NOT_FOUND",
        si_ambigu: "DESIGNATION_AMBIGUE",
      },
    },
  });

  it("sur le plan DÉJÀ RECOLLÉ — celui que la chaîne donne au désignateur — rien n'est amputé", () => {
    const plan = recollerLesMilliers(PIED_COUPE());
    const r = interpreter(RECETTE_PIED, plan, PARAMETRES);
    assert.equal(
      texteDesigne(plan, r.champs["totals.ttc"]),
      "5 650,000",
      "le montant désigné n'est pas celui que le papier porte",
    );
  });

  it("sur le plan BRUT, il ampute comme le modèle l'a fait — d'où le contrat", () => {
    /*
     * Ce cas n'est pas un défaut qu'on tolère : c'est la preuve exécutable du
     * seul pré-requis que l'interprète pose à son appelant. Donné le relevé
     * brut, il ne designe que « 5 » : le premier morceau d'une paire que
     * l'espace des milliers a coupee. Le modele, lui, avait cite le SECOND et
     * sorti 650 000 D la ou le papier portait 5 650 000 D — l'amputation
     * change de cote, elle ne disparait pas.
     *
     * Le branchement (tache 5) doit donc lui passer le plan RECOLLE, et ce
     * cas est la pour que personne ne l'oublie.
     */
    const brut = PIED_COUPE();
    const r = interpreter(RECETTE_PIED, brut, PARAMETRES);
    assert.equal(texteDesigne(brut, r.champs["totals.ttc"]), "5");
  });

  it("une cellule de tableau désigne ses jetons contigus ENSEMBLE", () => {
    /*
     * La seconde barrière, et elle ne dépend pas du recollage : sous une même
     * colonne, deux jetons contigus sortent en PLAGE. N'en citer qu'un serait
     * l'amputation, et une amputation systématique passe toutes les équations.
     */
    const plan = FACTURE_A();
    const r = interpreter(RECETTE_A, plan, PARAMETRES);
    const designation = r.articles[0]?.["designation"];
    assert.ok(designation && "designe" in designation);
    assert.equal(texteDesigne(plan, designation), "Papier");
  });

  it("une étendue « jusqu'à » dont la borne manque s'abstient, au lieu de deviner la fin", () => {
    const recette = valider({
      version: "recette/1",
      sens_de_lecture: "ltr",
      chiffres: "latins",
      ancres: {
        etiquette_client: {
          depuis: { genre: "ancre", motif: { genre: "exact", texte: "Client" } },
          prendre: { genre: "unique" },
        },
      },
      champs: {
        issuer: {
          designation: {
            depuis: { genre: "voisin", de: "etiquette_client", direction: "apres" },
            prendre: { genre: "premier" },
            etendre: { genre: "jusqu_a", motif: { genre: "exact", texte: "SARL" } },
          },
          si_absent: "TOKEN_NOT_FOUND",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
      },
    });
    const r = interpreter(recette, FACTURE_A(), PARAMETRES);
    assert.equal(abstentionDe(r.champs["issuer"]), "TOKEN_NOT_FOUND");
    assert.match((r.champs["issuer"] as { detail?: string }).detail ?? "", /borne de plage/);
  });

  it("« jusqu'à la fin de ligne » recolle une raison sociale de plusieurs jetons", () => {
    const recette = valider({
      version: "recette/1",
      sens_de_lecture: "ltr",
      chiffres: "latins",
      ancres: {
        etiquette_client: {
          depuis: { genre: "ancre", motif: { genre: "exact", texte: "Client" } },
          prendre: { genre: "unique" },
        },
      },
      champs: {
        issuer: {
          designation: {
            depuis: { genre: "voisin", de: "etiquette_client", direction: "apres" },
            prendre: { genre: "premier" },
            etendre: { genre: "jusqu_a_fin_de_ligne" },
          },
          si_absent: "TOKEN_NOT_FOUND",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
      },
    });
    const plan = FACTURE_A();
    assert.equal(
      texteDesigne(plan, interpreter(recette, plan, PARAMETRES).champs["issuer"]),
      "DREAM OPTIC",
    );
  });
});

/**
 * Une recette qui ne porte QUE le tableau.
 *
 * Elle est ecrite a part, et non derivee de la recette de reference : le pied
 * de la seconde page reimprime « HT », « TVA » et « TTC », donc les champs de
 * totaux y deviendraient ambigus — et ce n'est pas ce que ces cas eprouvent.
 */
function recetteDeTableau(drapeaux: Record<string, boolean>): Recette {
  return valider({
    version: "recette/1",
    sens_de_lecture: "ltr",
    chiffres: "latins",
    ancres: {
      entete_designation: {
        depuis: { genre: "ancre", motif: { genre: "exact", texte: "Designation" } },
        prendre: { genre: "premier" },
      },
      entete_total: {
        depuis: { genre: "ancre", motif: { genre: "exact", texte: "Total" } },
        prendre: { genre: "premier" },
      },
      etiquette_ht: {
        depuis: { genre: "ancre", motif: { genre: "exact", texte: "HT" } },
        prendre: { genre: "premier" },
      },
    },
    tableaux: {
      articles: {
        destination: "articles",
        entete: "entete_designation",
        fin: "etiquette_ht",
        ...drapeaux,
        colonnes: {
          designation: { entete: "entete_designation", si_absent: "TOKEN_NOT_FOUND" },
          total_ht: { entete: "entete_total", si_absent: "TOKEN_NOT_FOUND" },
        },
      },
    },
  });
}

describe("le tableau", () => {
  it("lit ses colonnes par l'en-tête, et ne confond pas le « Total » du pied", () => {
    const plan = FACTURE_A();
    const r = interpreter(RECETTE_A, plan, PARAMETRES);
    assert.equal(r.articles.length, 2, "le tableau n'a pas les lignes de la pièce");
    assert.deepEqual(
      r.articles.map((a) => [
        texteDesigne(plan, a["designation"]),
        texteDesigne(plan, a["quantity"]),
        texteDesigne(plan, a["unit_price_ht"]),
        texteDesigne(plan, a["total_ht"]),
      ]),
      [
        ["Papier", "2", "400,000", "800,000"],
        ["Encre", "1", "380,000", "380,000"],
      ],
    );
    assert.equal(r.lignes.length, 0, "des lignes de TVA sont sorties d'un tableau d'articles");
  });

  /**
   * Un tableau PIÉGÉ, et les deux pièges sont ceux que mes mutations ont
   * trouvés vivants — le banc ne les voyait pas.
   *
   *   — la cellule du total porte « 5 » et « 650,000 », deux jetons que
   *     l'espace des milliers a coupés : n'en citer qu'un est l'amputation
   *     du 18 octobre, et elle passe toutes les équations ;
   *   — le mot « Total » est imprimé AVANT le tableau, et ailleurs : un
   *     en-tête de colonne pris « à la première occurrence venue » viserait
   *     une colonne qui n'existe pas.
   *
   * Plan SYNTHÉTIQUE, écarts calés sur ceux mesurés le 18 octobre.
   */
  const TABLEAU_PIEGE = (): PageToken[] => [
    { page: 1, ordinal: 0, text: "Total", x0: 0.3, y0: 0.05, x1: 0.4, y1: 0.07 },
    { page: 1, ordinal: 1, text: "Designation", x0: 0.05, y0: 0.36, x1: 0.24, y1: 0.38 },
    { page: 1, ordinal: 2, text: "Total", x0: 0.8, y0: 0.36, x1: 0.9, y1: 0.38 },
    { page: 1, ordinal: 3, text: "Papier", x0: 0.05, y0: 0.44, x1: 0.18, y1: 0.46 },
    { page: 1, ordinal: 4, text: "5", x0: 0.8, y0: 0.44, x1: 0.808, y1: 0.46 },
    { page: 1, ordinal: 5, text: "650,000", x0: 0.816, y0: 0.44, x1: 0.88, y1: 0.46 },
    { page: 1, ordinal: 6, text: "HT", x0: 0.6, y0: 0.72, x1: 0.68, y1: 0.74 },
  ];

  it("une cellule coupée par l'espace des milliers sort en PLAGE, jamais amputée", () => {
    const plan = TABLEAU_PIEGE();
    const r = interpreter(recetteDeTableau({}), plan, PARAMETRES);
    assert.equal(r.articles.length, 1);
    assert.equal(
      texteDesigne(plan, r.articles[0]?.["total_ht"]),
      "5 650,000",
      "la cellule est amputée : c'est le défaut qui a coûté six mille dinars",
    );
  });

  it("l'en-tête d'une colonne est celui de la LIGNE d'en-tête, pas le premier mot venu", () => {
    const plan = TABLEAU_PIEGE();
    const r = interpreter(recetteDeTableau({}), plan, PARAMETRES);
    assert.ok(
      r.articles[0]?.["total_ht"] && "designe" in r.articles[0]["total_ht"],
      "la colonne s'est calée sur le « Total » imprimé avant le tableau",
    );
  });

  it("suit un tableau réparti sur deux pages, en-tête réimprimé", () => {
    const plan = FACTURE_A_DEUX_PAGES();
    const recette = recetteDeTableau({ entete_repete: true });
    const r = interpreter(recette, plan, PARAMETRES);
    assert.deepEqual(
      r.articles.map((a) => texteDesigne(plan, a["designation"])),
      ["Papier", "Encre", "Stylo"],
      "une ligne d'une page a disparu : c'est la moitié d'une facture qui ne s'inscrit pas",
    );
  });

  it("suit un tableau qui CONTINUE page suivante sans en-tête réimprimé", () => {
    /*
     * Le cas dangereux. Sans ce drapeau, la seconde page n'a pas d'en-tête,
     * donc pas de tableau, donc pas de lignes — et la perte est silencieuse.
     */
    const plan = FACTURE_A_DEUX_PAGES().filter(
      (t) => !(t.page === 2 && Math.abs(t.y0 - 0.36) < 0.001),
    );
    const recette = recetteDeTableau({ continue_sur_pages_suivantes: true });
    const r = interpreter(recette, plan, PARAMETRES);
    assert.deepEqual(
      r.articles.map((a) => texteDesigne(plan, a["designation"])),
      ["Papier", "Encre", "Stylo"],
    );
  });

  it("sans ce drapeau, la seconde page ne rend RIEN — et le dit par son compte", () => {
    const plan = FACTURE_A_DEUX_PAGES().filter(
      (t) => !(t.page === 2 && Math.abs(t.y0 - 0.36) < 0.001),
    );
    const recette = recetteDeTableau({});
    assert.equal(interpreter(recette, plan, PARAMETRES).articles.length, 2);
  });
});

describe("ce que l'interprète NE garde pas", () => {
  it("appliquée à un format voisin, la recette rend un résultat plausible — c'est la reconnaissance qui garde", () => {
    /*
     * `FACTURE_B_TTC` imprime les mêmes libellés, dans un pied inversé et avec
     * des prix unitaires TTC. La recette de A y désigne des jetons sans rien
     * signaler : l'interprète n'a AUCUN moyen de savoir qu'il est sur le
     * mauvais papier.
     *
     * Ce cas est écrit pour qu'on cesse de l'espérer. Le garde est en amont,
     * dans la reconnaissance, et il est éprouvé dans son propre banc.
     */
    const plan = FACTURE_B_TTC();
    const r = interpreter(RECETTE_A, plan, PARAMETRES);
    const { designation, flags } = sortieDeRecette(r);
    assert.equal(texteDesigne(plan, r.champs["totals.base_ht"]), "1180,000");
    assert.ok(designation.totals.base_ht && designation.totals.vat && designation.totals.ttc);
    assert.ok(
      !flags.some((f) => f.field.startsWith("totals")),
      "si l'interprete s'abstenait sur les totaux, on croirait qu'il sait distinguer deux formats",
    );
    /*
     * Ce qu'il voit, en revanche, c'est que l'en-tete « P.U.HT » n'est pas
     * imprime : B porte « P.U.TTC ». L'abstention tombe donc sur la colonne,
     * par hasard heureux — un format voisin dont tous les en-tetes seraient
     * identiques ne laisserait RIEN voir, et c'est pour ce cas-la que le
     * garde est en amont.
     */
    assert.ok(flags.some((f) => f.field.includes("unit_price_ht")));
  });
});

/* ====================================================================== */

/**
 * LA BORNE `ancre_texte_min` : CONTRE QUOI PROTÈGE-T-ELLE RÉELLEMENT ?
 *
 * ================================================================== LA QUESTION
 *
 * Le pack livre `ancre_texte_min = 3`, et sa migration le dit lui-même : « un
 * POINT DE DÉPART À MESURER, pas un relevé ». Son refus s'énonce « texte
 * d'ancre trop court pour discriminer » — autrement dit la borne suppose
 * qu'une ancre COURTE désigne trop de choses.
 *
 * Ce banc mesure cette supposition, sur les plans qu'il porte déjà. Il ne
 * mesure pas un taux de production : il mesure une CORRÉLATION, et il suffit de
 * la mesurer une fois pour savoir si la longueur est la bonne borne.
 *
 * ======================================================== CE QUE LA MESURE DONNE
 *
 * Sur le pied de facture française ordinaire, la longueur n'est pas corrélée au
 * nombre de jetons qu'une ancre attrape — elle l'est À L'ENVERS. L'ancre la
 * plus longue de la recette de banc (« Total », 5 caractères) est la SEULE qui
 * en attrape plusieurs ; les plus courtes (« HT », « TVA », « TTC », « Qte »)
 * en attrapent exactement un.
 *
 * Ce qui discrimine n'est donc pas la longueur, c'est le GENRE du motif : une
 * égalité avec un jeton imprimé est une borne forte, une inclusion ne l'est
 * pas. « HT » en `exact` attrape un jeton ; le même « HT » en `contient` en
 * attrape trois — « HT », « P.U.HT », « BaseHT ».
 *
 * La conclusion et ce qu'elle ouvre sont écrites dans
 * `.superpowers/sdd/fabrique/limites-langage-report.md`, et le défaut livré
 * passe de 3 à 2 par migration. Ce qu'une borne de longueur ne peut PAS tenir
 * — « combien de jetons cette ancre attrape-t-elle vraiment » — ne se tient
 * qu'au contact des exemples, donc à la génération et à l'évaluation, jamais
 * dans un validateur pur qui ne voit aucune pièce.
 */
describe("la borne d'ancre : ce que la longueur prédit, et ce qu'elle ne prédit pas", () => {
  /** Combien de jetons du plan un motif attrape — la vraie mesure de l'ancre. */
  function attrapes(plan: readonly PageToken[], motif: Motif): number {
    return plan.filter((t) => correspond(motif, t.text, "latins")).length;
  }

  it("l'ancre la plus LONGUE de la recette de banc est la seule qui attrape plusieurs jetons", () => {
    const plan = FACTURE_A();
    const releve = Object.values(RECETTE_A.ancres)
      .map((s) => (s.depuis.genre === "ancre" ? s.depuis.motif : null))
      .filter((m): m is Motif => m !== null && m.genre !== "forme")
      .map((m) => ({
        texte: m.genre === "forme" ? "" : m.texte,
        longueur: m.genre === "forme" ? 0 : [...m.texte].length,
        attrapes: attrapes(plan, m),
      }));
    assert.ok(releve.length >= 8, "le relevé doit porter sur toutes les ancres de la recette");

    const ambigues = releve.filter((r) => r.attrapes > 1);
    assert.deepEqual(
      ambigues.map((r) => [r.texte, r.longueur, r.attrapes]),
      [
        // « FACTURE » en haut, « facture » dans « Arretee la presente
        // facture » : la normalisation est insensible à la casse, et le mot
        // revient en toutes lettres au bas de la pièce.
        ["FACTURE", 7, 2],
        // « Total HT », « Total TTC », et l'en-tête de colonne « Total ».
        ["Total", 5, 3],
      ],
      "si la longueur protégeait, les DEUX plus longues ne seraient pas les seules ambiguës",
    );
    /*
     * ======================== LE CHIFFRE QUI TRANCHE LA QUESTION DE LA BORNE
     *
     * Le défaut livré était 3. Sur cette recette, il refuse QUATRE ancres qui
     * attrapent chacune un seul jeton, et AUCUNE des deux qui en attrapent
     * plusieurs. Une borne qui ne refuse rien de ce qu'elle visait et tout ce
     * qu'elle ne visait pas n'est pas une borne trop basse ou trop haute :
     * c'est la mauvaise grandeur.
     */
    const refuseesParTrois = releve.filter((r) => r.longueur < 3);
    assert.ok(refuseesParTrois.length >= 1, "le pied porte bien des étiquettes de 2 caractères");
    for (const r of refuseesParTrois) {
      assert.equal(r.attrapes, 1, `« ${r.texte} » serait refusée, et elle ne désigne qu'un jeton`);
    }
    for (const r of ambigues) {
      assert.ok(
        r.longueur >= 3,
        `« ${r.texte} » attrape ${String(r.attrapes)} jetons et la borne à 3 la laisse passer`,
      );
    }

    const courtes = releve.filter((r) => r.longueur <= 3);
    assert.ok(courtes.length >= 4, "le pied porte bien des étiquettes de deux ou trois lettres");
    for (const c of courtes) {
      assert.equal(c.attrapes, 1, `« ${c.texte} » attrape ${String(c.attrapes)} jetons`);
    }
  });

  it("ce qui discrimine est le GENRE du motif, pas la longueur du texte", () => {
    /*
     * Le même texte, la même longueur, deux pouvoirs opposés. Une borne de
     * longueur refuse les deux ou accepte les deux ; elle ne peut pas les
     * distinguer, et c'est pour cela qu'elle n'est pas la bonne borne.
     */
    const plan = FACTURE_A_TIMBRE();
    assert.equal(attrapes(plan, { genre: "exact", texte: "HT" }), 1);
    assert.equal(
      attrapes(plan, { genre: "contient", texte: "HT" }),
      3,
      "« HT », « P.U.HT », « BaseHT » : l'inclusion attrape tout le pied",
    );
  });

  it("et une ancre ambiguë ne passe pas en silence : elle s'abstient, à toute longueur", () => {
    /*
     * La garde qui tient réellement n'est pas la longueur : c'est
     * `prendre: unique`, qui refuse de choisir. Mesurée ici sur l'ancre la
     * PLUS LONGUE, celle que la borne n'a jamais inquiétée.
     */
    const ambigue = valider({
      version: RECETTE_FACTURE_A_TIMBRE,
      ...(RECETTE_FACTURE_A_TIMBRE as Record<string, unknown>),
      ancres: {
        trois_fois: {
          depuis: { genre: "ancre", motif: { genre: "exact", texte: "Total" } },
          ou: [],
          prendre: { genre: "unique" },
        },
      },
      tableaux: {},
      droits: {},
      references: {},
      champs: {
        "totals.ttc": {
          designation: {
            depuis: { genre: "voisin", de: "trois_fois", direction: "apres" },
            ou: [{ genre: "forme", forme: "nombre" }],
            prendre: { genre: "unique" },
          },
          si_absent: "TOKEN_NOT_FOUND",
          si_ambigu: "DESIGNATION_AMBIGUE",
        },
      },
    });
    const r = interpreter(ambigue, FACTURE_A_TIMBRE(), PARAMETRES);
    assert.equal(
      abstentionDe(r.champs["totals.ttc"]),
      "DESIGNATION_AMBIGUE",
      "cinq caractères, trois jetons, et c'est le CHOIX qui sauve la lecture",
    );
  });
});
