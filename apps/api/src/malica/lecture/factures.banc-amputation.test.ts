import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExtractFromTokenPlan } from "./read-piece.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
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
 * ========================================= CE QUI L'A FERMÉ, LE 18 OCTOBRE
 *
 * Le 18 octobre 2026 au matin, une facture tunisienne en arabe lue par la
 * chaîne réelle est sortie **`extract.v1`, valide**, avec 650,000 D là où le
 * papier porte 5 650,000 D — et les trois équations du produit ont confirmé
 * cette lecture (650,000 + 73,500 + 1,000 = 724,500, au millime). Le même
 * jour, la correction a posé DEUX maillons, et c'est leur ordre qui compte :
 *
 *   1. `recollerLesMilliers` entre dans `relever()`. Il existait depuis le
 *      5 octobre, éprouvé, et **n'était importé par aucun code de
 *      production** : un montant coupé par l'espace des milliers arrivait
 *      donc encore en deux jetons devant le désignateur. Recollé, il n'est
 *      plus citable à moitié — la garantie cesse de reposer sur l'obéissance
 *      d'un modèle. C'est ce que mesure le premier cas ci-dessous.
 *
 *   2. `plageAmputee` garde ce que le recollage REFUSE de recoller (un
 *      nombre sans décimales, qui a exactement la forme d'un numéro de
 *      téléphone tunisien). Un montant cité dont le voisin collé manque
 *      n'est plus rendu : il sort `null` avec `MONTANT_PEUT_ETRE_AMPUTE`,
 *      donc la pièce est partielle et rien ne peut s'écrire. Le garde penche
 *      du côté du doute — un faux positif coûte une question posée à la
 *      personne, un faux négatif une comptabilité fausse.
 *
 * ====================================================== COMMENT LES LIRE
 *
 * Chaque cas verrouille un comportement MESURÉ. Un `it` dont le titre
 * commence par « ne voit pas » décrit un trou QUI RESTE OUVERT, et son
 * assertion est là pour que le trou cesse d'être invisible :
 *
 *   **le jour où un tel test rougit, le défaut est corrigé.** On ne le
 *   « répare » pas — on le remplace par l'assertion inverse, et on écrit
 *   dans le même commentaire ce qui l'a fermé.
 *
 * Il n'en reste qu'un : le TEXTE tronqué (« MEUBLES » pour MEUBLES EL AMEN).
 *
 * ========================================================= LA GÉOMÉTRIE
 *
 * Les jetons de ce banc portent des boîtes RÉALISTES, et ce n'est pas un
 * détail de confort : le recollage comme le garde se décident sur l'écart
 * entre deux boîtes. Mesuré sur le plan réel du 4 octobre (177 jetons),
 * l'espace des milliers vaut UNE largeur de caractère et la gouttière entre
 * deux colonnes en vaut DIX. Un banc dont tous les jetons seraient sur des
 * lignes distinctes n'exercerait ni l'un ni l'autre — c'était le cas de sa
 * première version, écrite avant que la correction existe.
 */

/** Largeur d'un caractère, et hauteur d'une ligne, dans le repère 0..1. */
const CAR = 0.012;
const HAUTEUR = 0.014;

/** L'espace des milliers vaut une largeur de caractère ; la gouttière, dix. */
const MILLIERS = 1;
const GOUTTIERE = 10;

/**
 * Pose des jetons sur UNE ligne imprimée. Chaque morceau dit son texte et
 * l'écart qui le sépare du précédent, en largeurs de caractère.
 */
function ligne(
  depart: number,
  y: number,
  morceaux: ReadonlyArray<readonly [texte: string, ecartAvant: number]>,
  x0 = 0.08,
): PageToken[] {
  let x = x0;
  return morceaux.map(([texte, ecart], i) => {
    x += ecart * CAR;
    const largeur = texte.length * CAR;
    const jeton: PageToken = {
      page: 1,
      ordinal: depart + i,
      text: texte,
      x0: x,
      y0: y,
      x1: x + largeur,
      y1: y + HAUTEUR,
    };
    x += largeur;
    return jeton;
  });
}

const ref = (ordinal: number, ordinalEnd?: number): TokenRef =>
  ordinalEnd === undefined ? { page: 1, ordinal } : { page: 1, ordinal, ordinalEnd };

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

/*
 * MESURÉ. Pièce synthétique « شركة النور للتجهيزات », rendue à 1240 px et lue
 * par `qwen-vl-ocr-2025-11-20` puis `deepseek-chat`, deux tirages, le
 * 18 octobre 2026. Le papier porte, dans son pied :
 *
 *     Total HT        5 650,000
 *     TVA 19 %        1 073,500
 *     Timbre              1,000
 *     Total TTC       6 724,500
 *
 * Le plan BRUT, tel que l'œil le rend : le libellé à gauche, la gouttière,
 * puis le montant coupé par son espace des milliers.
 */
const PIED_BRUT: PageToken[] = [
  ...ligne(0, 0.1, [
    ["شركة", 0],
    ["النور", MILLIERS],
    ["للتجهيزات", MILLIERS],
    ["ش.م.م", MILLIERS],
  ]),
  ...ligne(4, 0.2, [["2026-06-14", 0]]),
  ...ligne(5, 0.7, [
    ["المجموع", 0],
    ["5", GOUTTIERE],
    ["650,000", MILLIERS],
  ]),
  ...ligne(8, 0.74, [
    ["الأداء", 0],
    ["1", GOUTTIERE],
    ["073,500", MILLIERS],
  ]),
  ...ligne(11, 0.78, [
    ["الطابع", 0],
    ["1,000", GOUTTIERE],
  ]),
  ...ligne(13, 0.82, [
    ["الجملي", 0],
    ["6", GOUTTIERE],
    ["724,500", MILLIERS],
  ]),
];

describe("banc de l'amputation — la facture arabe du 18 octobre 2026", () => {
  /*
   * LE CAS QUI PORTE TOUT LE RESTE : 5 650,000 doit sortir 5 650,000.
   *
   * La chaîne de production recolle le plan AVANT de le donner au
   * désignateur : « 5 » et « 650,000 » n'y sont plus deux jetons, donc la
   * désignation ne peut plus en citer un seul. Les ordinaux des jetons
   * absorbés disparaissent — ils ne sont jamais renumérotés, pour ne pas
   * invalider une désignation déjà enregistrée.
   */
  const recolle = recollerLesMilliers(PIED_BRUT);
  const parOrdinal = (o: number) => recolle.find((t) => t.ordinal === o);

  it("le plan recollé ne porte plus aucun montant coupé", () => {
    assert.equal(parOrdinal(6)?.text, "5 650,000");
    assert.equal(parOrdinal(9)?.text, "1 073,500");
    assert.equal(parOrdinal(14)?.text, "6 724,500");
    // Les seconds morceaux ont été absorbés : ils ne sont plus citables.
    assert.equal(parOrdinal(7), undefined);
    assert.equal(parOrdinal(10), undefined);
    assert.equal(parOrdinal(15), undefined);
  });

  const lu = lire(recolle, {
    issuer: ref(0, 3),
    document_date: ref(4),
    lines: [
      { label: "TVA 19%", tax_code: "TVA_19", base_ht: ref(6), vat_amount: ref(9), ttc: null },
    ],
    totals: { base_ht: ref(6), vat: ref(9), ttc: ref(14) },
    other_charges: [{ code: "DROIT_TIMBRE", amount: ref(12) }],
  });

  it("rend les trois montants du papier, au millime", () => {
    assert.equal(totaux(lu)["base_ht"], "5650.000");
    assert.equal(totaux(lu)["vat"], "1073.500");
    assert.equal(totaux(lu)["ttc"], "6724.500");
    assert.equal(lu.extract["issuer"], "شركة النور للتجهيزات ش.م.م");
  });

  it("et la facture boucle sur les vrais chiffres", () => {
    // 5 650,000 + 1 073,500 + 1,000 = 6 724,500.
    assert.deepEqual(
      lu.flags.filter((f) => f.code === "ARITHMETIQUE_INCOHERENTE"),
      [],
    );
    assert.equal(lu.contract, "extract.v1");
    assert.equal(lu.valid, true);
  });
});

describe("banc de l'amputation — un montant amputé ne sort plus de valeur", () => {
  /*
   * Le recollage ferme la forme NORMALE. Ce cas-ci éprouve le second maillon,
   * sur un plan délibérément NON recollé : c'est ce qui subsiste des formes
   * que `recollerLesMilliers` refuse de recoller, et de tout plan dont la
   * géométrie est trop abîmée pour qu'il s'applique.
   *
   * Avant le 18 octobre, la désignation ci-dessous rendait 650,000 / 73,500 /
   * 724,500, **sans un seul drapeau**, contrat `extract.v1` valide. C'est la
   * lecture mesurée ce matin-là, deux tirages.
   */
  const lu = lire(PIED_BRUT, {
    totals: { base_ht: ref(7), vat: ref(10), ttc: ref(15) },
    other_charges: [{ code: "DROIT_TIMBRE", amount: ref(12) }],
  });

  it("les trois montants amputés sortent null, et le disent", () => {
    for (const champ of ["base_ht", "vat", "ttc"]) {
      assert.equal(totaux(lu)[champ], null, champ);
      assert.equal(drapeau(lu, `totals.${champ}`)?.code, "MONTANT_PEUT_ETRE_AMPUTE", champ);
    }
  });

  it("le drapeau nomme le jeton qui manque", () => {
    assert.match(drapeau(lu, "totals.base_ht")?.detail ?? "", /« 5 »/);
  });

  it("et la lecture se dit PARTIELLE : rien ne peut s'écrire", () => {
    /*
     * C'était là le cœur du défaut. 650,000 D pour 5 650,000 D, annoncé
     * `extract.v1` valide, et les trois équations d'accord entre elles :
     * retrancher les milliers de CHAQUE terme d'une somme les retranche aussi
     * de la somme, donc l'équation — le seul garde qui attrapait une
     * amputation — est aveugle à l'amputation SYSTÉMATIQUE, c'est-à-dire au
     * cas normal quand la cause est une consigne mal suivie.
     */
    assert.equal(lu.contract, "extract.v1.partiel");
    assert.equal(lu.valid, false);
  });
});

describe("banc de l'amputation — une quantité de 1 ne désarme plus le produit", () => {
  /*
   * MESURÉ, même lecture. Ligne d'article : « Fauteuil … 1 × 1 150,000 =
   * 1 150,000 ». Le prix unitaire ET le total de ligne étaient amputés tous
   * les deux, et la contrainte « quantité × unitaire = total » devenait
   * 1 × 150,000 = 150,000 : elle tenait.
   *
   * Les deux autres lignes de la même facture (6 × 520,000 et 2 × 690,000)
   * avaient bien levé `ARITHMETIQUE_INCOHERENTE` — la quantité y est
   * différente de 1. Or une ligne de prestation, de licence, de loyer ou de
   * forfait porte presque toujours la quantité 1 : l'arithmétique ne pouvait
   * rien pour le cas le plus courant.
   */
  const article = ligne(0, 0.4, [
    ["Fauteuil", 0],
    ["1", GOUTTIERE],
    ["1", GOUTTIERE],
    ["150,000", MILLIERS],
    ["1", GOUTTIERE],
    ["150,000", MILLIERS],
  ]);

  const lu = lire(article, {
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
  });

  it("le garde parle là où l'équation se taisait", () => {
    assert.equal(drapeau(lu, "articles[0].unit_price_ht")?.code, "MONTANT_PEUT_ETRE_AMPUTE");
    assert.equal(drapeau(lu, "articles[0].total_ht")?.code, "MONTANT_PEUT_ETRE_AMPUTE");
    const a = (lu.extract["articles"] as Record<string, unknown>[])[0]!;
    assert.equal(a["unit_price_ht"], null);
    assert.equal(a["total_ht"], null);
  });
});

describe("banc de l'amputation — une équation à trou ne dit rien, le garde si", () => {
  /*
   * Le solveur ne juge une équation que lorsque TOUS ses termes sont lus
   * (`evaluer` rend `null` dès qu'un terme manque) — et c'est juste : « une
   * facture incomplète n'est pas une facture incohérente ».
   *
   * La conséquence était qu'un TTC amputé passait sans un mot dès qu'un seul
   * autre terme du pied était illisible, ce qui n'a rien d'exceptionnel sur
   * une pièce photographiée. Le garde ne dépend d'aucune équation : il
   * regarde le plan de jetons, pas la facture.
   */
  const pied = [
    ...ligne(0, 0.7, [
      ["3", 0],
      ["020,000", MILLIERS],
    ]),
    ...ligne(2, 0.74, [["???", 0]]),
    ...ligne(3, 0.78, [
      ["3", 0],
      ["594,800", MILLIERS],
    ]),
  ];
  const lu = lire(pied, { totals: { base_ht: ref(1), vat: ref(2), ttc: ref(4) } });

  it("la TVA illisible est bien refusée", () => {
    assert.equal(drapeau(lu, "totals.vat")?.code, "VALUE_NOT_A_NUMBER");
    assert.equal(totaux(lu)["vat"], null);
  });

  it("le TTC amputé est refusé sans qu'aucune équation ait pu être posée", () => {
    // 3,000 D pour 3 594,800 D : c'est la forme SUFFIXE, celle du 18 octobre.
    assert.equal(totaux(lu)["ttc"], null);
    assert.equal(drapeau(lu, "totals.ttc")?.code, "MONTANT_PEUT_ETRE_AMPUTE");
  });

  it("et la base, amputée par l'autre bout, est refusée aussi", () => {
    // « 020,000 » cité seul de « 3 020,000 » : le garde regarde les DEUX
    // côtés du jeton cité, parce que les deux formes ont été mesurées.
    assert.equal(totaux(lu)["base_ht"], null);
    assert.equal(drapeau(lu, "totals.base_ht")?.code, "MONTANT_PEUT_ETRE_AMPUTE");
  });
});

describe("banc de l'amputation — ce que le garde laisse passer, et il le faut", () => {
  /*
   * LA BORNE DU FAUX POSITIF. Le garde se décide sur une géométrie : un
   * voisin COLLÉ, à moins de deux largeurs de caractère. La gouttière entre
   * deux colonnes en vaut dix. Sans cette borne, toute facture dont une
   * colonne « Qté » précède une colonne « P.U. » serait entièrement refusée —
   * c'est-à-dire toutes.
   */
  const deuxColonnes = ligne(0, 0.4, [
    ["Prestation", 0],
    ["6", GOUTTIERE],
    ["520,000", GOUTTIERE],
  ]);
  const lu = lire(deuxColonnes, {
    articles: [
      {
        designation: ref(0),
        quantity: ref(1),
        unit_price_ht: ref(2),
        unit_price_ttc: null,
        total_ht: null,
        tax_code: "TVA_19",
      },
    ],
  });

  it("une quantité dans la colonne voisine ne fait pas crier le garde", () => {
    assert.equal(drapeau(lu, "articles[0].unit_price_ht"), undefined);
    const a = (lu.extract["articles"] as Record<string, unknown>[])[0]!;
    assert.equal(a["unit_price_ht"], "520.000");
  });
});

describe("banc de l'amputation — le témoin français continue de lire juste", () => {
  /*
   * Pièce `63681657` (SOFT-INTEGRA), lue le 18 octobre par la même chaîne et
   * le même modèle, et JUSTE au millime sur ses sept montants. Elle porte
   * exactement les mêmes espaces de milliers que la facture arabe : c'est
   * elle qui a prouvé que le défaut n'était pas celui de l'arabe.
   *
   * Elle est ici pour que la correction ne se paie pas d'une régression sur
   * ce qui marchait déjà.
   */
  const pied = [
    ...ligne(0, 0.7, [
      ["Total", 0],
      ["HT", MILLIERS],
      ["12", GOUTTIERE],
      ["560,000", MILLIERS],
    ]),
    ...ligne(4, 0.74, [
      ["TVA", 0],
      ["19%", MILLIERS],
      ["2", GOUTTIERE],
      ["386,400", MILLIERS],
    ]),
    ...ligne(8, 0.78, [
      ["Total", 0],
      ["TTC", MILLIERS],
      ["14", GOUTTIERE],
      ["946,400", MILLIERS],
    ]),
  ];
  const recolle = recollerLesMilliers(pied);
  const lu = lire(recolle, { totals: { base_ht: ref(2), vat: ref(6), ttc: ref(10) } });

  it("les trois totaux sortent entiers, sans drapeau", () => {
    assert.equal(totaux(lu)["base_ht"], "12560.000");
    assert.equal(totaux(lu)["vat"], "2386.400");
    assert.equal(totaux(lu)["ttc"], "14946.400");
    assert.deepEqual(
      lu.flags.filter((f) => f.field.startsWith("totals.")),
      [],
    );
  });
});

describe("banc de l'amputation — pièce 53144e64, « MEUBLES » pour MEUBLES EL AMEN", () => {
  /*
   * MESURÉ deux fois. Le 18 octobre 2026 au matin, la chaîne a rendu
   * « MEUBLES » comme émetteur de la facture `53144e64`. Le même jour, la
   * pièce relevée par PaddleOCR sur le serveur de recette rend la raison
   * sociale en UNE SEULE ligne, « MEUBLES EL AMEN », confiance 1,00 : le
   * relevé est juste, et c'est la désignation qui n'a cité qu'un token sur
   * trois.
   *
   * CE TROU RESTE OUVERT, et c'est délibéré. Le garde posé le 18 octobre
   * porte sur les MONTANTS : il se décide sur la FORME d'un nombre — un
   * groupe de milliers collé à un autre. Un mot collé à un mot n'a aucune
   * forme particulière : « MEUBLES EL AMEN » et « Facture N° 412 » se
   * ressemblent trait pour trait, et un garde qui refuserait tout texte ayant
   * un voisin collé refuserait tous les textes. Il faudrait un autre
   * dispositif, et aucune mesure ne dit encore lequel.
   */
  const lu = lire(
    ligne(0, 0.1, [
      ["MEUBLES", 0],
      ["EL", MILLIERS],
      ["AMEN", MILLIERS],
    ]),
    { issuer: ref(0) },
  );

  it("ne voit pas qu'un nom propre a été tronqué", () => {
    assert.equal(lu.extract["issuer"], "MEUBLES");
    assert.equal(drapeau(lu, "issuer"), undefined);
  });
});

describe("banc de l'amputation — les chiffres arabes orientaux restent refusés", () => {
  /*
   * Ce cas-ci verrouille un refus JUSTE, et il est ici parce qu'un commentaire
   * du dépôt affirmait qu'il l'était déjà ailleurs :
   *
   *   token-plan.ts : « Les montants en chiffres arabes ne sont toujours pas
   *   lus (`montants.test.ts` verrouille ce refus) »
   *
   * Vérifié le 18 octobre 2026 : `montants.test.ts` ne contient aucun chiffre
   * arabe. Le refus tenait, mais rien ne le gardait. Le commentaire pointe
   * désormais ici.
   *
   * Il doit tenir : « ٦٥٠,٠٠٠ » lu par le modèle de vision revient avec ses
   * chiffres INVERSÉS — mesuré sur le nombre « ١٢ » rendu « ٢١ » — et une
   * lecture inversée d'un montant est pire que pas de lecture.
   *
   * Les chiffres arabes sont écrits en échappements : `mots.ts` a déjà perdu
   * ses plages d'écriture arabe par une réécriture de fichier, et son
   * commentaire dit pourquoi elles doivent le rester.
   */
  const lu = lire(
    ligne(0, 0.7, [
      ["٦٥٠,٠٠٠", 0],
      ["٥", GOUTTIERE],
      ["٦٥٠,٠٠٠", MILLIERS],
    ]),
    { totals: { ttc: ref(0) } },
  );

  it("un montant en chiffres arabes n'est pas lu, et le dit", () => {
    assert.equal(totaux(lu)["ttc"], null);
    assert.equal(drapeau(lu, "totals.ttc")?.code, "VALUE_NOT_A_NUMBER");
  });

  it("et la lecture se dit partielle, jamais complète", () => {
    assert.equal(lu.contract, "extract.v1.partiel");
    assert.equal(lu.valid, false);
  });
});
