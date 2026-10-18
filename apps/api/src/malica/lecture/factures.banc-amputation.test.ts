import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import type { PageToken, TokenRef } from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

/**
 * ============================================ LE BANC DE L'AMPUTATION
 *
 * `factures.banc.test.ts` éprouve qu'aucun chiffre n'est INVENTÉ. Ce banc-ci
 * éprouve l'autre faute, qui n'a pas la même forme : un chiffre AMPUTÉ.
 *
 * « 2 800,000 » lu « 2 » n'invente rien. Les deux tokens sont sur le papier,
 * la citation pointe un vrai jeton, R2 est respectée à la lettre — et le
 * montant est faux d'un facteur mille.
 *
 * Le banc existant en porte UN cas, la pièce `73ae6059` du 5 octobre, et il
 * n'y est vu que parce que l'équation de la facture n'a plus bouclé. Les cas
 * ci-dessous sont ceux où l'équation boucle quand même, ou n'existe pas. Ils
 * viennent d'une mesure, pas d'une idée : le 18 octobre 2026, une facture
 * tunisienne en arabe lue par la chaîne réelle est sortie
 * **`extract.v1`, valide**, avec 650,000 D là où le papier porte 5 650,000 D
 * — et les trois équations du produit ont confirmé cette lecture.
 *
 * ====================================================== COMMENT LES LIRE
 *
 * Chaque cas verrouille le comportement MESURÉ, pas le comportement voulu.
 * Un `it` dont le titre commence par « ne voit pas » décrit un trou, et son
 * assertion est là pour que le trou cesse d'être invisible :
 *
 *   **le jour où un tel test rougit, le défaut est corrigé.** On ne le
 *   « répare » pas — on le remplace par l'assertion inverse, et on écrit
 *   dans le même commentaire ce qui l'a fermé.
 *
 * Les cas dont le titre n'a pas cette forme verrouillent, eux, un refus juste
 * qu'il ne faut pas perdre.
 */

const jeton = (ordinal: number, text: string): PageToken => ({
  page: 1,
  ordinal,
  text,
  x0: 0.1,
  y0: 0.1 + ordinal / 100,
  x1: 0.3,
  y1: 0.12 + ordinal / 100,
});

const ref = (ordinal: number): TokenRef => ({ page: 1, ordinal });

/** Le dossier de l'atelier : c'est son matricule qui décide du sens de la pièce. */
const MATRICULE_DOSSIER = "1876543W/A/M/000";

const lire = (
  tokens: readonly PageToken[],
  selection: Partial<{
    issuer: TokenRef | null;
    document_date: TokenRef | null;
    lines: unknown[];
    articles: unknown[];
    other_charges: unknown[];
    totals: { base_ht?: TokenRef | null; vat?: TokenRef | null; ttc?: TokenRef | null };
  }>,
) =>
  buildExtractFromTokenPlan({
    tokens,
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
    decimals: 3,
    matriculeDossier: MATRICULE_DOSSIER,
  });

const drapeau = (r: ReturnType<typeof buildExtractFromTokenPlan>, champ: string) =>
  r.flags.find((f) => f.field === champ);

const totaux = (r: ReturnType<typeof buildExtractFromTokenPlan>) =>
  r.extract["totals"] as Record<string, string | null>;

describe("banc de l'amputation — la facture arabe du 18 octobre 2026", () => {
  /*
   * MESURÉ. Pièce synthétique « شركة النور للتجهيزات », rendue à 1240 px et
   * lue par `qwen-vl-ocr-2025-11-20` puis `deepseek-chat`, deux tirages, le
   * 18 octobre 2026. Le papier porte :
   *
   *     Total HT        5 650,000
   *     TVA 19 %        1 073,500
   *     Timbre              1,000
   *     Total TTC       6 724,500
   *
   * Le désignateur a cité, pour chacun, le SECOND token de la paire — « 650,000 »
   * au lieu de la plage « 5 » + « 650,000 » —, sur une pièce de droite à gauche.
   * Le même désignateur, sur une facture française portant les mêmes espaces de
   * milliers (pièce `63681657`, 7 800,000 / 12 560,000 / 14 947,400), a employé
   * `ordinal_end` correctement : le défaut n'est pas général, il est induit par
   * le sens d'écriture.
   *
   * Ce qui suit reproduit la désignation telle qu'elle est sortie.
   */
  const tokens = [
    "شركة",
    "النور",
    "للتجهيزات",
    "ش.م.م",
    "2026-06-14",
    "5",
    "650,000",
    "1",
    "073,500",
    "1,000",
    "6",
    "724,500",
  ].map((texte, i) => jeton(i, texte));

  const lu = lire(tokens, {
    // La raison sociale, elle, est citée en PLAGE et sort juste : le
    // désignateur sait employer `ordinal_end`, il ne l'a pas fait pour les
    // montants.
    issuer: { page: 1, ordinal: 0, ordinalEnd: 3 },
    document_date: ref(4),
    lines: [
      { label: "TVA 19%", tax_code: "TVA_19", base_ht: ref(6), vat_amount: ref(8), ttc: null },
    ],
    totals: { base_ht: ref(6), vat: ref(8), ttc: ref(11) },
    other_charges: [{ code: "DROIT_TIMBRE", amount: ref(9) }],
  });

  it("rend bien les trois montants amputés", () => {
    assert.equal(totaux(lu)["base_ht"], "650.000");
    assert.equal(totaux(lu)["vat"], "73.500");
    assert.equal(totaux(lu)["ttc"], "724.500");
    assert.equal(lu.extract["issuer"], "شركة النور للتجهيزات ش.م.م");
  });

  it("ne voit pas que l'amputation est uniforme : l'équation boucle", () => {
    /*
     * 650,000 + 73,500 + 1,000 = 724,500. Au millime.
     *
     * C'est la raison profonde, et elle n'est pas accidentelle : retrancher
     * les milliers de CHAQUE terme d'une somme retranche les milliers de la
     * somme. Le seul garde qui attrape une amputation — l'équation — est donc
     * aveugle à l'amputation SYSTÉMATIQUE, c'est-à-dire au cas normal quand
     * la cause est le sens d'écriture ou une consigne mal suivie.
     */
    assert.equal(drapeau(lu, "totals.ttc"), undefined);
    assert.equal(drapeau(lu, "totals.base_ht"), undefined);
    assert.equal(drapeau(lu, "totals.vat"), undefined);
  });

  it("ne voit pas non plus l'ambiguïté : « 650,000 » n'a qu'une lecture", () => {
    // Le drapeau d'ambiguïté dit « je ne sais pas lire ce texte ». Ici le
    // texte est lu sans le moindre doute — c'est le CHOIX DU TOKEN qui est
    // faux, et aucun drapeau du produit ne porte sur ce choix.
    assert.deepEqual(
      lu.flags.filter(
        (f) => f.code === "SEPARATEUR_AMBIGU" || f.code === "ARITHMETIQUE_INCOHERENTE",
      ),
      [],
      `aucun garde ne parle, c'est le défaut : ${JSON.stringify(lu.flags)}`,
    );
  });

  it("et la lecture se dit complète", () => {
    // 650,000 D pour 5 650,000 D, annoncé valide. Une écriture comptable peut
    // partir sur ce chiffre : c'est la forme la plus grave du défaut.
    assert.equal(lu.contract, "extract.v1");
    assert.equal(lu.valid, true);
  });
});

describe("banc de l'amputation — une quantité de 1 désarme le produit", () => {
  /*
   * MESURÉ, même lecture. Ligne d'article : « Fauteuil … 1 × 1 150,000 =
   * 1 150,000 ». Le prix unitaire ET le total de ligne sont amputés tous les
   * deux, et la contrainte « quantité × unitaire = total » devient
   * 1 × 150,000 = 150,000 : elle tient.
   *
   * Les deux autres lignes de la même facture (6 × 520,000 et 2 × 690,000) ont
   * bien levé `ARITHMETIQUE_INCOHERENTE` — la quantité y est différente de 1.
   * Or une ligne de prestation, de licence, de loyer ou de forfait porte
   * presque toujours la quantité 1.
   */
  const lu = lire(
    ["Fauteuil", "1", "1", "150,000", "1", "150,000"].map((texte, i) => jeton(i, texte)),
    {
      articles: [
        {
          designation: ref(0),
          quantity: ref(1),
          unit_price_ht: ref(3),
          unit_price_ttc: null,
          total_ht: ref(5),
          tax_code: "TVA_19",
        },
      ],
    },
  );

  it("ne voit pas l'amputation quand la quantité vaut 1", () => {
    assert.equal(drapeau(lu, "articles[0].total_ht"), undefined);
    const article = (lu.extract["articles"] as Record<string, unknown>[])[0]!;
    assert.equal(article["unit_price_ht"], "150.000");
    assert.equal(article["total_ht"], "150.000");
  });
});

describe("banc de l'amputation — une équation à trou ne dit rien", () => {
  /*
   * Le solveur ne juge une équation que lorsque TOUS ses termes sont lus
   * (`evaluer` rend `null` dès qu'un terme manque) — et c'est juste : « une
   * facture incomplète n'est pas une facture incohérente ».
   *
   * Mais la conséquence est qu'un TTC amputé passe sans un mot dès qu'un seul
   * autre terme du pied est illisible. Sur une pièce photographiée, un terme
   * illisible n'a rien d'exceptionnel.
   */
  const lu = lire([jeton(0, "3"), jeton(1, "020,000"), jeton(2, "???"), jeton(3, "3")], {
    totals: { base_ht: ref(1), vat: ref(2), ttc: ref(3) },
  });

  it("la TVA illisible est bien refusée", () => {
    assert.equal(drapeau(lu, "totals.vat")?.code, "VALUE_NOT_A_NUMBER");
    assert.equal(totaux(lu)["vat"], null);
  });

  it("ne voit pas le TTC amputé, faute de pouvoir poser l'équation", () => {
    // 3,000 D pour 3 594,800 D, et aucune incohérence signalée.
    assert.equal(totaux(lu)["ttc"], "3.000");
    assert.equal(drapeau(lu, "totals.ttc"), undefined);
  });
});

describe("banc de l'amputation — pièce 53144e64, « MEUBLES » pour MEUBLES EL AMEN", () => {
  /*
   * MESURÉ deux fois. Le 18 octobre 2026 au matin, la chaîne a rendu
   * « MEUBLES » comme émetteur de la facture `53144e64`. Le même jour, la
   * pièce relevée par PaddleOCR sur le serveur de recette rend la raison
   * sociale en UNE SEULE ligne, « MEUBLES EL AMEN », confiance 1,00 : le
   * relevé est juste, et c'est la désignation qui n'a cité qu'un token sur
   * trois. `decouperEnMots` découpe toute ligne sur les espaces, donc tout nom
   * propre de plus d'un mot est une plage à citer.
   *
   * Un fournisseur créé sous ce nom serait faux, et le rapprochement des
   * pièces suivantes avec lui échouerait sans qu'on sache pourquoi.
   */
  const lu = lire([jeton(0, "MEUBLES"), jeton(1, "EL"), jeton(2, "AMEN")], {
    issuer: ref(0),
  });

  it("ne voit pas qu'un nom propre a été tronqué", () => {
    /*
     * Aucun drapeau n'existe pour un TEXTE tronqué, et il n'y a aucune
     * équation pour en tenir lieu. Un montant amputé a au moins une chance
     * d'être rattrapé par l'arithmétique ; un nom amputé n'en a aucune.
     */
    assert.equal(lu.extract["issuer"], "MEUBLES");
    assert.equal(drapeau(lu, "issuer"), undefined);
  });
});

describe("banc de l'amputation — les chiffres arabes orientaux restent refusés", () => {
  /*
   * Ce cas-ci verrouille un refus JUSTE, et il est ici parce qu'un commentaire
   * du dépôt affirme qu'il l'est déjà ailleurs :
   *
   *   token-plan.ts : « Les montants en chiffres arabes ne sont toujours pas
   *   lus (`montants.test.ts` verrouille ce refus) »
   *
   * Vérifié le 18 octobre 2026 : `montants.test.ts` ne contient aucun chiffre
   * arabe. Le refus tenait, mais rien ne le gardait.
   *
   * Il doit tenir : « ٦٥٠,٠٠٠ » lu par le modèle de vision revient avec ses
   * chiffres INVERSÉS — mesuré sur le numéro de téléphone « ١٢ » rendu « ٢١ » —
   * et une lecture inversée d'un montant est pire que pas de lecture.
   */
  const lu = lire([jeton(0, "٦٥٠,٠٠٠"), jeton(1, "٥"), jeton(2, "٦٥٠,٠٠٠")], {
    totals: { ttc: ref(0) },
  });

  it("un montant en chiffres arabes n'est pas lu, et le dit", () => {
    assert.equal(totaux(lu)["ttc"], null);
    assert.equal(drapeau(lu, "totals.ttc")?.code, "VALUE_NOT_A_NUMBER");
  });

  it("et la lecture se dit partielle, jamais complète", () => {
    assert.equal(lu.contract, "extract.v1.partiel");
    assert.equal(lu.valid, false);
  });
});
