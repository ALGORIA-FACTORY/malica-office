import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resoudreFacture, treillisMontant, type ChampMontant } from "./montants.ts";

/** Le dinar tunisien : trois décimales, donc le millime pour unité entière. */
const DINAR = 3;

const valeurs = (texte: string, decimales = DINAR): number[] =>
  treillisMontant(texte, decimales).map((h) => h.millimes);

describe("treillisMontant — ce qui est certain", () => {
  it("la virgule sépare les décimales : « 1 234,560 » fait 1 234 560 millimes", () => {
    assert.deepEqual(valeurs("1 234,560"), [1234560]);
  });

  it("complète les décimales manquantes : « 12,5 » fait 12,500 dinars", () => {
    assert.deepEqual(valeurs("12,5"), [12500]);
  });

  it("le point est un séparateur de milliers quand la virgule est là", () => {
    assert.deepEqual(valeurs("1.234,56 TND"), [1234560]);
  });

  it("moins de quatre chiffres sans séparateur : des dinars entiers", () => {
    assert.deepEqual(valeurs("45"), [45000]);
  });

  it("plusieurs points sont des milliers, jamais des décimales", () => {
    assert.deepEqual(valeurs("1.234.567"), [1234567000]);
  });

  it("les parenthèses portent le signe négatif", () => {
    assert.deepEqual(valeurs("(123,45)"), [-123450]);
  });

  it("un point suivi d'une ou deux décimales n'est pas ambigu", () => {
    assert.deepEqual(valeurs("12.50"), [12500]);
  });

  it("un texte sans nombre ne donne aucune lecture", () => {
    assert.deepEqual(valeurs("Total"), []);
    assert.deepEqual(valeurs("—"), []);
  });

  it("plus de décimales que la devise n'en porte : illisible, pas arrondi", () => {
    assert.deepEqual(valeurs("12,3456"), []);
  });
});

describe("treillisMontant — ce qui reste ambigu", () => {
  it("« 2.800 » se lit 2,800 D ou 2 800 D : les deux sont rendues", () => {
    assert.deepEqual(valeurs("2.800"), [2800, 2800000]);
  });

  it("« 16000 » se lit 16,000 D ou 16 000 D : les deux sont rendues", () => {
    assert.deepEqual(valeurs("16000"), [16000, 16000000]);
  });

  it("un entier long garde la même ambiguïté : « 44400 »", () => {
    assert.deepEqual(valeurs("44400"), [44400, 44400000]);
  });

  it("l'ambiguïté du point s'arrête à trois chiffres de partie entière", () => {
    assert.deepEqual(valeurs("12345.678"), [12345678]);
  });

  it("chaque lecture dit d'où elle vient", () => {
    assert.deepEqual(
      treillisMontant("2.800", DINAR).map((h) => h.lecture),
      ["decimale", "milliers"],
    );
  });
});

describe("treillisMontant — une devise à deux décimales", () => {
  it("l'euro n'a pas de millime : « 12,5 » fait 1 250 centimes", () => {
    assert.deepEqual(valeurs("12,5", 2), [1250]);
  });

  it("« 2.800 » en euros : le point ne peut plus être décimal", () => {
    // 2 800 euros font 280 000 centimes — l'échelle suit la devise.
    assert.deepEqual(valeurs("2.800", 2), [280000]);
  });
});

describe("resoudreFacture — l'arithmétique tranche", () => {
  const champ = (nom: string, texte: string, decimales = DINAR): ChampMontant => ({
    champ: nom,
    hypotheses: treillisMontant(texte, decimales),
  });

  it("une seule lecture : la valeur est décidée par la lecture", () => {
    const r = resoudreFacture([champ("totals.ttc", "1 428,000")], [], { decimales: DINAR });
    assert.deepEqual(r.valeurs.get("totals.ttc"), {
      millimes: 1428000,
      decidePar: "lecture",
    });
    assert.deepEqual(r.ambigus, []);
  });

  it("sans contrainte, une lecture double reste ambiguë", () => {
    const r = resoudreFacture([champ("totals.ttc", "2.800")], [], { decimales: DINAR });
    assert.equal(r.valeurs.has("totals.ttc"), false);
    assert.deepEqual(r.ambigus, ["totals.ttc"]);
  });

  it("HT + TVA = TTC tranche trois montants qu'aucun ne décidait seul", () => {
    const r = resoudreFacture(
      [champ("base_ht", "1.200"), champ("tva", "228"), champ("ttc", "1.428")],
      [{ type: "somme", total: "ttc", parties: ["base_ht", "tva"] }],
      { decimales: DINAR },
    );
    assert.equal(r.valeurs.get("base_ht")?.millimes, 1200000);
    assert.equal(r.valeurs.get("base_ht")?.decidePar, "arithmetique");
    assert.equal(r.valeurs.get("ttc")?.millimes, 1428000);
    assert.equal(r.valeurs.get("ttc")?.decidePar, "arithmetique");
    assert.deepEqual(r.ambigus, []);
    assert.ok(r.marge > 0, "la marge sur la deuxième affectation doit être positive");
  });

  it("quantité × prix unitaire décide le prix unitaire", () => {
    const r = resoudreFacture(
      [champ("qte", "2"), champ("pu", "7.549"), champ("total", "15,098")],
      [{ type: "produit", total: "total", quantite: "qte", unitaire: "pu" }],
      { decimales: DINAR },
    );
    assert.equal(r.valeurs.get("pu")?.millimes, 7549);
    assert.equal(r.valeurs.get("pu")?.decidePar, "arithmetique");
  });

  it("l'arrondi au millime est toléré à une unité près", () => {
    const r = resoudreFacture(
      [champ("qte", "2,5"), champ("pu", "7.549"), champ("total", "18,873")],
      [{ type: "produit", total: "total", quantite: "qte", unitaire: "pu" }],
      { decimales: DINAR },
    );
    assert.equal(r.valeurs.get("pu")?.millimes, 7549);
  });

  it("deux lectures qui bouclent toutes les deux ne sont pas départagées", () => {
    // 2 × 7,549 = 15,098 et 2 × 7 549 = 15 098 : l'échelle est invariante.
    const r = resoudreFacture(
      [champ("qte", "2"), champ("pu", "7.549"), champ("total", "15.098")],
      [{ type: "produit", total: "total", quantite: "qte", unitaire: "pu" }],
      { decimales: DINAR },
    );
    assert.deepEqual(r.ambigus.sort(), ["pu", "total"]);
    assert.equal(r.marge, 0);
  });

  it("un champ illisible ne figure ni dans les valeurs ni dans les ambiguïtés", () => {
    const r = resoudreFacture([champ("tva", "Total")], [], { decimales: DINAR });
    assert.equal(r.valeurs.size, 0);
    assert.deepEqual(r.ambigus, []);
  });

  it("au-delà du plafond de combinaisons, rien n'est deviné", () => {
    const champs = Array.from({ length: 20 }, (_, i) => champ(`m${i}`, "2.800"));
    const r = resoudreFacture(champs, [], { decimales: DINAR, combinaisonsMax: 1024 });
    assert.equal(r.valeurs.size, 0);
    assert.equal(r.ambigus.length, 20);
  });
});

describe("treillisMontant — ce qui n'est pas un montant", () => {
  // Trouvé sur les vraies pièces du staging : le relevé porte des dates et des
  // heures, et l'ancienne normalisation retirait « / » et « : » avant de lire
  // les chiffres restants. « 08/09/2026 » devenait un montant de 8 092,026 D.
  // C'est exactement la faute que ce module existe pour supprimer : décider à
  // la place du papier. Un jeton qui n'est pas un nombre n'a aucune lecture.
  it("une date n'est pas un montant", () => {
    assert.deepEqual(valeurs("08/09/2026"), []);
    assert.deepEqual(valeurs("2026-09-08"), []);
  });

  it("une heure n'est pas un montant", () => {
    assert.deepEqual(valeurs("23:18"), []);
  });

  it("un numéro de pièce n'est pas un montant", () => {
    assert.deepEqual(valeurs("FA/2026/00412"), []);
  });

  it("la devise et le pourcentage restent de la décoration", () => {
    assert.deepEqual(valeurs("1.234,56 TND"), [1234560]);
    assert.deepEqual(valeurs("1 234,560 €"), [1234560]);
    assert.deepEqual(valeurs("19%"), [19000]);
    assert.deepEqual(valeurs("١٢٣ د.ت"), []);
  });
});

/**
 * ============================= LE GARDE QUI MANQUAIT : LA CONTRAINTE VIOLÉE
 *
 * Diagnostic du 5 octobre 2026, et c'est sa conclusion la plus importante :
 *
 *   UN MONTANT TRONQUÉ N'EST PAS UN MONTANT AMBIGU.
 *
 * Tout le dispositif de `resoudreFacture` est tourné contre l'ambiguïté : il
 * énumère les lectures, laisse l'arithmétique trancher, et déclare ambigu ce
 * qu'aucune équation ne départage. C'est juste, et insuffisant.
 *
 * « 2 » est un nombre net, à lecture unique. Un plan de jetons coupé à
 * l'espace des milliers produit donc des champs tous CERTAINS — et le solveur
 * sortait alors par la porte de devant, `doutes.length === 0`, AVANT d'avoir
 * évalué la moindre contrainte. Les équations étaient posées, jamais lues.
 *
 * Pire, dans le cas où des doutes subsistaient : `scores` ne faisait que
 * COMPTER les contraintes satisfaites. Une contrainte violée baissait un
 * score — elle ne levait aucun drapeau. Une facture qui ne boucle pas passait
 * donc en silence dès lors qu'aucune autre lecture n'était disponible.
 *
 * Ces cas exigent l'inverse : le solveur évalue TOUJOURS ses contraintes sur
 * les valeurs qu'il retient, et rend la liste de celles qui tombent.
 */
describe("resoudreFacture — une contrainte violée se dit", () => {
  const champ = (nom: string, texte: string, decimales = DINAR): ChampMontant => ({
    champ: nom,
    hypotheses: treillisMontant(texte, decimales),
  });

  it("la facture du 4 octobre, telle que le produit l'avait lue", () => {
    /*
     * Les valeurs exactes qui sont sorties en production : les montants coupés
     * par l'espace ont été réduits à leur premier jeton, les autres sont
     * justes. Chaque champ n'a qu'une lecture, donc aucun doute, donc l'ancien
     * solveur rendait `{ ambigus: [], marge: 0 }` et personne n'était averti.
     *
     * 3,000 + 573,800 ne fait pas 3,000. C'est visible à l'œil nu, et le
     * produit ne le voyait pas.
     */
    const r = resoudreFacture(
      [champ("totals.base_ht", "3"), champ("totals.vat", "573,800"), champ("totals.ttc", "3")],
      [{ type: "somme", total: "totals.ttc", parties: ["totals.base_ht", "totals.vat"] }],
      { decimales: DINAR },
    );

    assert.deepEqual(r.ambigus, [], "rien n'est ambigu : c'est tout le piège");
    assert.equal(r.violations.length, 1, "et pourtant la facture ne boucle pas");
    const v = r.violations[0]!;
    assert.equal(v.champ, "totals.ttc");
    assert.deepEqual([...v.parties], ["totals.base_ht", "totals.vat"]);
    assert.equal(v.lu, 3000, "ce que la pièce porte, en millimes");
    assert.equal(v.calcule, 576800, "ce que l'équation donne");
  });

  it("une facture qui boucle ne porte aucune violation", () => {
    const r = resoudreFacture(
      [
        champ("totals.base_ht", "3 020,000"),
        champ("totals.vat", "573,800"),
        champ("timbre", "1,000"),
        champ("totals.ttc", "3 594,800"),
      ],
      [
        {
          type: "somme",
          total: "totals.ttc",
          parties: ["totals.base_ht", "totals.vat", "timbre"],
        },
      ],
      { decimales: DINAR },
    );
    assert.deepEqual(r.violations, []);
    assert.equal(r.valeurs.get("totals.ttc")?.millimes, 3594800);
  });

  it("le timbre oublié de l'équation ferait crier sur une pièce valide", () => {
    /*
     * La même facture, avec l'équation du dépôt d'avant le 5 octobre — « TTC =
     * HT + TVA », sans les droits hors TVA. Elle tombe à 3 593,800 : faux
     * d'exactement le dinar de timbre.
     *
     * Ce cas n'est pas là pour verrouiller un comportement souhaitable, mais
     * pour garder la trace de ce que l'équation incomplète produisait. Un garde
     * qui crie sur une pièce valide est pire qu'un garde muet : on apprend à
     * l'ignorer, et il ne protège plus de rien.
     */
    const r = resoudreFacture(
      [
        champ("totals.base_ht", "3 020,000"),
        champ("totals.vat", "573,800"),
        champ("totals.ttc", "3 594,800"),
      ],
      [{ type: "somme", total: "totals.ttc", parties: ["totals.base_ht", "totals.vat"] }],
      { decimales: DINAR },
    );
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0]!.calcule, 3593800);
    assert.equal(r.violations[0]!.lu, 3594800);
  });

  it("une contrainte dont un terme manque ne se prononce pas", () => {
    // Un champ illisible n'est pas une incohérence : la différence est tout
    // l'intérêt du drapeau. On ne reproche pas à une facture d'être incomplète.
    const r = resoudreFacture(
      [champ("totals.base_ht", "1 000,000"), champ("totals.vat", "pas un nombre")],
      [{ type: "somme", total: "totals.ttc", parties: ["totals.base_ht", "totals.vat"] }],
      { decimales: DINAR },
    );
    assert.deepEqual(r.violations, []);
  });

  it("un produit violé se dit aussi, à la tolérance d'arrondi près", () => {
    const violee = resoudreFacture(
      [
        champ("articles[0].quantity", "2,000"),
        champ("articles[0].unit_price_ht", "10,000"),
        champ("articles[0].total_ht", "25,000"),
      ],
      [
        {
          type: "produit",
          total: "articles[0].total_ht",
          quantite: "articles[0].quantity",
          unitaire: "articles[0].unit_price_ht",
        },
      ],
      { decimales: DINAR },
    );
    assert.equal(violee.violations.length, 1);
    assert.equal(violee.violations[0]!.champ, "articles[0].total_ht");

    // 2,5 × 7,549 = 18,8725 : le papier porte 18,873 ou 18,872 selon le sens
    // d'arrondi de celui qui l'a imprimé. Ce n'est pas une incohérence.
    const arrondie = resoudreFacture(
      [
        champ("articles[0].quantity", "2,500"),
        champ("articles[0].unit_price_ht", "7,549"),
        champ("articles[0].total_ht", "18,873"),
      ],
      [
        {
          type: "produit",
          total: "articles[0].total_ht",
          quantite: "articles[0].quantity",
          unitaire: "articles[0].unit_price_ht",
        },
      ],
      { decimales: DINAR },
    );
    assert.deepEqual(arrondie.violations, []);
  });

  it("quand l'arithmétique a tranché, c'est la valeur RETENUE qui est jugée", () => {
    /*
     * Le solveur choisit une affectation, puis on vérifie celle-là. Sans quoi
     * on jugerait une facture sur des lectures qu'on vient d'écarter — et un
     * champ ambigu produirait toujours une violation, puisque l'une au moins
     * de ses lectures est fausse.
     */
    const r = resoudreFacture(
      [champ("base_ht", "1.200"), champ("tva", "228"), champ("ttc", "1.428")],
      [{ type: "somme", total: "ttc", parties: ["base_ht", "tva"] }],
      { decimales: DINAR },
    );
    assert.equal(r.valeurs.get("ttc")?.decidePar, "arithmetique");
    assert.deepEqual(r.violations, [], "l'affectation retenue est celle qui boucle");
  });

  it("un champ resté ambigu ne produit pas de violation", () => {
    // Rien n'a été retenu pour lui : on ne peut rien lui reprocher. Le drapeau
    // d'ambiguïté est déjà posé ailleurs, et l'écran posera la question.
    const r = resoudreFacture(
      [champ("totals.ttc", "2.800"), champ("totals.base_ht", "1 000,000")],
      [{ type: "somme", total: "totals.ttc", parties: ["totals.base_ht"] }],
      { decimales: DINAR },
    );
    assert.deepEqual(r.ambigus, ["totals.ttc"]);
    assert.deepEqual(r.violations, []);
  });
});
