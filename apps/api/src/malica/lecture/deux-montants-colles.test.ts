import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deviseDEssai } from "../../scan/devise-d-essai.ts";
import { candidatsMontant } from "../../scan/normaliser-montants.ts";

import { treillisMontant } from "./montants.ts";
import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

/**
 * ============================================ DEUX MONTANTS NE FONT PAS UN NOMBRE
 *
 * Staging, 29 octobre 2026. Une facture d'achat en dinars (trois décimales) :
 *
 *     Toner                 5 × 245,000 = 1 225,000
 *     Produits d'entretien  3 × 120,000 =   360,000
 *     Sucre                20 ×   3,900 =    78,000
 *     Net à payer                         1 969,610
 *
 * Les « Signalements de lecture » disaient : « lines[0].vat_amount +
 * lines[1].vat_amount donne 5460306.610, la pièce porte 5.460 ». Une TVA de
 * cinq millions de dinars sur 1 663 dinars d'achats.
 *
 * Le récapitulatif de TVA de la pièce a une colonne par taux, donc les deux
 * TVA sont côte à côte sur une même ligne : « TVA  5,460  301,150 ». La
 * désignation d'une ligne a couvert les deux cellules, et la lecture a rendu
 * « 5,460 301,150 » comme UN nombre :
 *
 *   — `texteDeLaPlage` (token-plan.ts) joint les jetons de la plage par une
 *     espace ;
 *   — `treillisMontant` (montants.ts) retirait TOUTES les espaces, comme de la
 *     décoration : « 5,460301,150 » ;
 *   — puis prenait la DERNIÈRE virgule pour la décimale et effaçait les
 *     autres : 5 460 301,150, lecture UNIQUE, donc aucun drapeau, et le
 *     solveur l'a additionnée.
 *
 * 301,150 = 1 585,000 × 19 % et 5,460 = 78,000 × 7 % — cohérent avec le
 * papier, mais les taux sont une reconstitution : la pièce elle-même n'est
 * pas dans ce dépôt (aucune donnée réelle n'y entre). Le plan ci-dessous est
 * synthétique, à la disposition décrite.
 */

const DINAR = 3;

const valeurs = (texte: string, decimales = DINAR): number[] =>
  treillisMontant(texte, deviseDEssai(decimales)).map((h) => h.millimes);

describe("treillisMontant — deux nombres collés ne se fondent jamais en un", () => {
  const illisibles: ReadonlyArray<readonly [texte: string, pourquoi: string]> = [
    ["5,460 301,150", "les deux cellules TVA du récapitulatif, jointes par la plage"],
    ["5,460 306,610", "une TVA de ligne et la TVA totale, côte à côte"],
    ["5,460301,150", "les mêmes, collées par l'OCR sans espace"],
    ["514,700 200,000", "deux colonnes différentes"],
    ["1,234,567", "la virgule ne peut pas être à la fois milliers et décimale"],
    ["1.234,567.000", "deux séparateurs décimaux"],
    ["5.46.3", "des groupes de milliers mal formés"],
    ["12 3,500", "une espace qui ne sépare pas un groupe de trois chiffres"],
    ["19% 306,610", "un taux collé à un montant"],
    ["19 % 306,610", "un taux collé à un montant, espacé"],
    ["306,610 19%", "un montant suivi de son taux"],
    ["7%5,460", "un taux collé sans espace"],
    /*
     * Relevés le 29 octobre 2026 en passant tout le corpus du dépôt (fixtures,
     * jeu d'or, jeux d'essai) à l'ancienne et à la nouvelle lecture : chacun
     * de ces textes y rendait un nombre absurde.
     */
    ["1 000,000 2 000,000", "deux montants à milliers, côte à côte (lu 10 000 002 000,000)"],
    ["12,34,56", "trois virgules (lu 1 234,560)"],
    ["Ramettes A4 80g", "les chiffres d'une désignation (lu 480)"],
    ["Post it 50x40", "un format, pas un montant (lu 5 040)"],
    ["1 septembre 2026", "une date en lettres (lu 12 026)"],
    ["192.168.1.192", "des groupes de points mal formés"],
  ];
  for (const [texte, pourquoi] of illisibles) {
    it(`« ${texte} » est illisible : ${pourquoi}`, () => {
      assert.deepEqual(valeurs(texte), []);
    });
  }
});

describe("treillisMontant — ce qui se lisait se lit encore", () => {
  const lisibles: ReadonlyArray<readonly [texte: string, attendu: number[]]> = [
    ["1 234,560", [1234560]],
    ["2 800,000", [2800000]],
    ["1 585,000 TND", [1585000]],
    ["- 1 234,560 DT", [-1234560]],
    ["1 234 560", [1234560, 1234560000]],
    ["1.234.567", [1234567000]],
    ["1.234,56 TND", [1234560]],
    ["12345.678", [12345678]],
    // Le même montant répété en colonnes (#135) : une seule valeur, la sienne.
    ["514,700 514,700", [514700]],
    ["3 020,000 3 020,000", [3020000]],
    ["3 020,000 DT 3 020,000 DT", [3020000]],
    /*
     * Lus au plan de jetons depuis le 30 octobre 2026, comme ils l'étaient
     * déjà à la normalisation du scan : la parenthèse orpheline de « (base
     * 3 020,000) » est du bruit de plage (#135), le bruit de colonne sépare
     * deux occurrences, l'apostrophe sépare des milliers, et des zéros au-delà
     * des décimales de la devise ne changent pas la valeur.
     */
    ["3 020,000)", [3020000]],
    ["3 020,000 3 020,000)", [3020000]],
    ["3 020,000 | 3 020,000", [3020000]],
    ["1'234.560", [1234560]],
    ["1234,5600", [1234560]],
  ];
  for (const [texte, attendu] of lisibles) {
    it(`« ${texte} » se lit ${attendu.join(" ou ")}`, () => {
      assert.deepEqual(valeurs(texte), attendu);
    });
  }
});

describe("treillisMontant — un signe que le texte ne tranche pas ne se lit pas", () => {
  /*
   * Jusqu'au 30 octobre 2026, ces textes se lisaient en NÉGATIF au plan de
   * jetons, et pas du tout à la normalisation du scan (#135) : sur ces
   * factures, une paire de parenthèses encadre aussi une base — « (base
   * 514,700) », le 15 octobre 2026 —, et la lire en négatif inscrirait au
   * crédit ce qui va au débit. Un seul lecteur, une seule règle : le texte ne
   * dit pas le signe, donc on ne lit pas ; l'écran le demande.
   *
   * Le « + », lui, n'a jamais été un signe sur une pièce du dépôt : le
   * 13 octobre 2026, c'était le « 4 » de « 4 135,183 », imprimé en blanc sur
   * bande noire.
   */
  const sansSigneSur: readonly string[] = [
    "(1 234,560)",
    "(3 020,000) (3 020,000)",
    "(1 234,560 DT)",
    "(123,450 €)",
    "( 1 234,560 )",
    "(DT 1 234,560)",
    "(€ 123,450)",
    " ( 1 234,560 DT ) ",
    "DT (1 234,560)",
    "(1 234,560) DT",
    "( 123,450€ )",
    "(3 020,000))",
    "+ 135,183",
    "+ 72,883",
    "3 020,000-",
  ];
  for (const texte of sansSigneSur) {
    it(`« ${texte} » ne se lit pas`, () => {
      assert.deepEqual(valeurs(texte), []);
    });
  }
});

describe("les marques de devise viennent du référentiel, pour les deux lecteurs", () => {
  /*
   * 30 octobre 2026. « 1 234,560 D.T. » se lisait 1 234 560 dinars au plan de
   * jetons (le point de l'abréviation restait collé au nombre), et la
   * normalisation du scan portait sa propre liste de marques en dur. Les
   * marques sont désormais une donnée (`ref.devises`, `ref.devises_marques`),
   * et un mot que le référentiel ne connaît pas fait d'un texte un texte.
   */
  const DEVISE = deviseDEssai(DINAR);
  const parLeScan = (texte: string) => candidatsMontant(texte, DEVISE).map((c) => c.mineur);
  const cas: ReadonlyArray<readonly [texte: string, attendu: number[]]> = [
    ["1 234,560 D.T.", [1234560]],
    ["د.ت 1 234,560", [1234560]],
    ["1 234,560 TND.", [1234560]],
    ["(1 234,560 D.T.)", []],
    ["1 234,560 DT.", [1234560]],
    ["1 234,560 د.ت.", [1234560]],
    ["D.T. 1 234,560", [1234560]],
    ["1 234,560D.T.", [1234560]],
    ["4 812,300 TND.", [4812300]],
    ["510,000 DNT", [510000]],
    ["510,000 D.N.T.", [510000]],
    ["art. 9", []],
    ["TVA 19 %", []],
    ["N° 12.", []],
    ["Total 1 234,560", []],
    ["1 234,560 USD", []],
  ];
  for (const [texte, attendu] of cas) {
    it(`« ${texte} » : ${attendu.length ? attendu.join(" ou ") : "pas un montant"}`, () => {
      assert.deepEqual(valeurs(texte), attendu, "lecture au plan de jetons");
    });
  }
  // La normalisation du scan lit avec le MÊME lecteur depuis le 30 octobre
  // 2026 : elle rend exactement les mêmes valeurs. (Avant, elle gardait ses
  // propres conventions, et l'épreuve ne comparait que la présence d'une
  // lecture, hors parenthèses.)
  for (const [texte, attendu] of cas) {
    it(`le scan, sur « ${texte} »`, () => {
      assert.deepEqual(parLeScan(texte), attendu);
    });
  }
});

describe("treillisMontant — les séparateurs suivent la devise", () => {
  // L'exposant et le séparateur décimal viennent du référentiel (`ref.devises`),
  // jamais d'ici : le même texte se lit autrement selon la devise.
  const cas: ReadonlyArray<readonly [texte: string, decimales: number, attendu: number[]]> = [
    // La virgule, séparateur décimal du dinar, ne sépare pas de milliers.
    ["5,460", 3, [5460]],
    ["100,000", 3, [100000]],
    // En euros, trois chiffres ne sont pas des centimes : la virgule peut
    // séparer des milliers, ou porter un zéro de trop (5,46 €).
    ["5,460", 2, [546, 546000]],
    ["12,345", 2, [1234500]],
    ["5.460", 3, [5460, 5460000]],
    ["5.460", 2, [546, 546000]],
    ["5,46", 2, [546]],
    ["5,46", 3, [5460]],
    // Le franc CFA n'a pas de décimales : « 1,500 » ne peut être que 1 500.
    ["1,500", 0, [1500]],
  ];
  for (const [texte, decimales, attendu] of cas) {
    it(`« ${texte} » à ${decimales} décimale(s) : ${attendu.length ? attendu.join(" ou ") : "illisible"}`, () => {
      assert.deepEqual(valeurs(texte, decimales), attendu);
    });
  }
});

/* ------------------------------------------------------------ la pièce entière */

/** Un jeton sur sa ligne, loin de ses voisins : aucune plage ne s'y colle. */
const jeton = (ordinal: number, texte: string, colonne: number, y: number): PageToken => ({
  page: 1,
  ordinal,
  text: texte,
  x0: 0.05 + colonne * 0.25,
  y0: y,
  x1: 0.05 + colonne * 0.25 + texte.length * 0.012,
  y1: y + 0.014,
});

const ref = (ordinal: number, ordinalEnd?: number): TokenRef =>
  ordinalEnd === undefined ? { page: 1, ordinal } : { page: 1, ordinal, ordinalEnd };

/**
 * Le pied de la pièce : le récapitulatif de TVA en colonnes (un taux par
 * colonne), puis les totaux.
 */
const PIED: PageToken[] = [
  jeton(0, "Taux", 0, 0.6),
  jeton(1, "7%", 1, 0.6),
  jeton(2, "19%", 2, 0.6),
  jeton(3, "Base", 0, 0.63),
  jeton(4, "78,000", 1, 0.63),
  jeton(5, "1 585,000", 2, 0.63),
  jeton(6, "TVA", 0, 0.66),
  jeton(7, "5,460", 1, 0.66),
  jeton(8, "301,150", 2, 0.66),
  jeton(9, "Total HT", 0, 0.72),
  jeton(10, "1 663,000", 2, 0.72),
  jeton(11, "Total TVA", 0, 0.75),
  jeton(12, "306,610", 2, 0.75),
  jeton(13, "Net à payer", 0, 0.78),
  jeton(14, "1 969,610", 2, 0.78),
];

const lire = (selection: Partial<VisionSelection>) =>
  buildExtractFromTokenPlan({
    tokens: PIED,
    selection: {
      issuer: null,
      document_date: null,
      currency: "TND",
      document_kind: "facture_achat",
      lines: [],
      articles: [],
      other_charges: [],
      references: {},
      overall_confidence: 0.5,
      ...selection,
      totals: { base_ht: null, vat: null, ttc: null, ...(selection.totals ?? {}) },
    } as unknown as VisionSelection,
    devise: deviseDEssai(DINAR),
    matriculeDossier: null,
  });

describe("la facture du 29 octobre — la plage qui couvre deux cellules", () => {
  // La désignation telle que le staging l'a reçue : la seconde TVA de ligne
  // couvre les deux cellules, et la TVA totale pointe la cellule à 7 %.
  const lu = lire({
    lines: [
      { label: "TVA 7%", tax_code: "TVA_7", base_ht: ref(4), vat_amount: ref(7), ttc: null },
      { label: "TVA 19%", tax_code: "TVA_19", base_ht: ref(5), vat_amount: ref(7, 8), ttc: null },
    ] as VisionSelection["lines"],
    totals: { base_ht: ref(10), vat: ref(7), ttc: ref(14) },
  });

  it("aucun montant absurde n'est produit : la TVA collée n'a pas de valeur", () => {
    const lignes = lu.extract["lines"] as Array<Record<string, string>>;
    assert.deepEqual(
      lignes.map((l) => l["vat_amount"]),
      ["5.460"],
      "la ligne à 19 % ne sort pas avec 5460301.150",
    );
    const f = lu.flags.find((x) => x.field === "lines[1].vat_amount");
    assert.equal(f?.code, "VALUE_NOT_A_NUMBER");
    assert.match(f?.detail ?? "", /5,460 301,150/, "le drapeau cite toute la plage");
  });

  it("aucune somme ne porte plus 5460306.610", () => {
    for (const f of lu.flags) assert.doesNotMatch(f.detail ?? "", /5460/, f.field);
  });

  it("la pièce reste partielle : rien ne s'écrit sur une lecture fausse", () => {
    // La TVA totale désignée (5,460) ne vaut pas la somme imprimée : la
    // facture ne boucle pas, et le dit — sur des nombres du papier.
    const ttc = lu.flags.find(
      (f) => f.code === "ARITHMETIQUE_INCOHERENTE" && f.field === "totals.ttc",
    );
    assert.match(ttc?.detail ?? "", /donne 1668\.460, la pièce porte 1969\.610/);
  });
});

describe("la garde de vraisemblance — une TVA ne dépasse jamais sa base", () => {
  /*
   * Défense en profondeur : même lue sans ambiguïté, une TVA plus grande que
   * sa base n'est pas une TVA (aucun taux n'atteint 100 %). Elle sort sans
   * valeur, avec un drapeau qui le dit, au lieu de nourrir une somme absurde.
   */
  const cas: ReadonlyArray<
    readonly [nom: string, base: TokenRef, tva: TokenRef, attendu: string | null]
  > = [
    ["la TVA de la colonne voisine (1 585,000 sur 78,000)", ref(4), ref(5), null],
    ["la base totale désignée pour TVA (1 663,000 sur 78,000)", ref(4), ref(10), null],
    ["une TVA ordinaire (5,460 sur 78,000)", ref(4), ref(7), "5.460"],
  ];
  for (const [nom, base, tva, attendu] of cas) {
    it(nom, () => {
      const lu = lire({
        lines: [
          { label: "TVA 7%", tax_code: "TVA_7", base_ht: base, vat_amount: tva, ttc: null },
        ] as VisionSelection["lines"],
      });
      const lignes = lu.extract["lines"] as Array<Record<string, string>>;
      assert.equal(lignes[0]?.["vat_amount"] ?? null, attendu);
      const f = lu.flags.find((x) => x.field === "lines[0].vat_amount");
      assert.equal(f?.code, attendu === null ? "MONTANT_INVRAISEMBLABLE" : undefined);
    });
  }

  it("les totaux du pied restent jugés par l'équation du TTC, qui dit quel nombre ne tient pas", () => {
    // Base totale désignée sur 78,000, TVA totale 306,610 : la garde ne s'en
    // mêle pas (le loyer du 4 octobre avait une base fausse et une TVA juste).
    const lu = lire({ totals: { base_ht: ref(4), vat: ref(12), ttc: ref(14) } });
    assert.equal(
      lu.flags.some((x) => x.code === "MONTANT_INVRAISEMBLABLE"),
      false,
    );
    assert.match(
      lu.flags.find((x) => x.field === "totals.ttc")?.detail ?? "",
      /donne 384\.610, la pièce porte 1969\.610/,
    );
  });

  it("une base illisible ne juge rien : la TVA garde sa lecture", () => {
    const lu = lire({
      lines: [
        { label: "TVA 7%", tax_code: "TVA_7", base_ht: ref(0), vat_amount: ref(7), ttc: null },
      ] as VisionSelection["lines"],
    });
    assert.equal(
      lu.flags.some((x) => x.code === "MONTANT_INVRAISEMBLABLE"),
      false,
    );
  });
});
