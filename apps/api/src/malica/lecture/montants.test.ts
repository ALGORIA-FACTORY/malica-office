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
