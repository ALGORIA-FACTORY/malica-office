/**
 * Un montant répété sur deux colonnes se lit ; deux montants différents, non.
 *
 * ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * 29 octobre 2026, écran du cabinet sur Android. Une facture d'achat de
 * 3 594,800 TND finit « anomalie à signaler », sans écriture :
 *
 *     Aucun montant n'est retenu — ils sont à saisir :
 *     montant illisible : « 3 020,000 3 020,000) »
 *
 * La citation de la base a couvert deux colonnes de la même ligne — le HT et
 * le total de la ligne, qui valent la même chose sur une facture à une ligne —
 * plus la parenthèse fermante d'une mention voisine.
 *
 * La règle des blocs identiques (10 octobre) et celle des parenthèses
 * orphelines (15 octobre) existaient pour ce cas exact, sur « 514,700
 * 514,700) ». Elles ne jouaient pas ici pour une seule raison : la règle des
 * blocs coupait le texte à CHAQUE espace, et l'espace est aussi le séparateur
 * des milliers. « 3 020,000 3 020,000 » donnait les blocs « 3 », « 020,000 »,
 * « 3 », « 020,000 » — différents, donc illisible.
 *
 * ================================================= LA RÈGLE, ÉCRITE
 *
 *   — Une cellule qui porte le même montant plusieurs fois, séparé par des
 *     espaces ou du bruit de colonne (« | », « ; », « : »), se lit comme CE
 *     montant, quand toutes les occurrences ont exactement les mêmes lectures.
 *   — Des occurrences qui diffèrent restent illisibles : on ne choisit jamais.
 *   — Deux découpages possibles qui donnent deux montants : illisible.
 *   — « (3 020,000) » — une paire — n'est lu ni positif ni négatif : refusé.
 *     Une facture imprime aussi « (base 3 020,000) » ; lire la paire comme un
 *     négatif inscrirait au crédit ce qui va au débit. La personne saisit.
 *   — Une parenthèse orpheline est du bruit, et elle seule est retirée : une
 *     paire qui reste après l'avoir retirée est refusée comme ci-dessus.
 *   — Le signe moins en tête se lit ; en queue (« 3 020,000- »), non.
 *   — Les chiffres arabes-indiens (٠١٢…) et persans (۰۱۲…) se lisent comme
 *     leurs équivalents latins, la virgule décimale arabe « ٫ » comme une
 *     virgule, le séparateur de milliers arabe « ٬ » comme une apostrophe —
 *     qui n'est jamais décimale.
 *
 * Les décimales viennent de l'appelant (le paramétrage daté), jamais du code.
 *
 *   node --experimental-strip-types --test src/scan/un-montant-repete-en-colonnes.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { candidatsMontant, normaliserMontants } from "./normaliser-montants.ts";
import { deviseDEssai } from "./devise-d-essai.ts";

const P = { ...deviseDEssai(3), toleranceMineure: 1 };
const valeurs = (brut: string, decimales = P.decimales) =>
  candidatsMontant(brut, { ...P, decimales })
    .map((c) => c.mineur)
    .sort((a, b) => a - b);

describe("un montant répété en colonnes : la lecture d'un montant imprimé", () => {
  // [texte imprimé, décimales, lectures attendues en unités mineures]
  const CAS: Array<[string, number, number[]]> = [
    // Le cas du 29 octobre, tel qu'il est arrivé.
    ["3 020,000 3 020,000)", 3, [3_020_000]],
    ["3 020,000 3 020,000", 3, [3_020_000]],
    ["3 020,000  3 020,000", 3, [3_020_000]],
    ["3 020,000 | 3 020,000", 3, [3_020_000]],
    ["3 020,000|3 020,000", 3, [3_020_000]],
    ["3 020,000 ; 3 020,000", 3, [3_020_000]],
    ["3 020,000 : 3 020,000 :", 3, [3_020_000]],
    ["3 020,000 3 020,000 3 020,000", 3, [3_020_000]],
    ["3 020,000) 3 020,000)", 3, [3_020_000]],
    ["3 020,000 DT 3 020,000 DT", 3, [3_020_000]],
    // Le même montant, écrit avec ou sans l'espace des milliers.
    ["3 020,000 3020,000", 3, [3_020_000]],
    // Plusieurs groupes de milliers.
    ["1 234 567,890 1 234 567,890", 3, [1_234_567_890]],
    // L'espace, séparateur des milliers, seul : inchangé.
    ["3 020,000", 3, [3_020_000]],
    ["12 345,678", 3, [12_345_678]],
    // Le cas du 10 octobre, qui marchait, marche toujours. Une seule lecture
    // depuis le 30 octobre 2026 : la virgule est le séparateur décimal du dinar
    // (`ref.devises.separateur_decimal`), et ne sépare pas de milliers.
    ["514,700 514,700", 3, [514_700]],
    ["514,700 514,700)", 3, [514_700]],
    // Au point, l'ambiguïté demeure, et l'arithmétique de la facture tranche.
    ["514.700 514.700", 3, [514_700, 514_700_000]],
    // Négatif par le signe moins, en tête : se lit.
    ["-3 020,000", 3, [-3_020_000]],
    ["-3 020,000 -3 020,000", 3, [-3_020_000]],
    // L'exposant de la devise vient de l'appelant : 2 (l'euro), 0 (le franc CFA).
    ["3 020,00 3 020,00", 2, [302_000]],
    ["3 020 | 3 020", 0, [3_020]],
    // Chiffres arabes-indiens et persans.
    ["٣ ٠٢٠٫٠٠٠", 3, [3_020_000]],
    ["٣ ٠٢٠٫٠٠٠ ٣ ٠٢٠٫٠٠٠)", 3, [3_020_000]],
    ["٣٬٠٢٠٫٠٠٠", 3, [3_020_000]],
    ["۳ ۰۲۰٫۰۰۰", 3, [3_020_000]],
  ];
  for (const [brut, decimales, attendu] of CAS)
    it(`« ${brut} » (${decimales} décimales) → ${attendu.join(" ou ")}`, () => {
      assert.deepEqual(valeurs(brut, decimales), attendu);
    });

  // Ce qui reste illisible : on ne choisit jamais.
  const REFUS: Array<[string, string]> = [
    ["3 020,000 3 200,000", "deux montants différents"],
    ["3 020,000 3 020,001)", "deux montants différents, à un millime près"],
    ["514,700 200,000", "deux montants différents (cas du 10 octobre)"],
    ["3 020,000 | 574,800", "deux colonnes différentes"],
    ["(3 020,000)", "une paire : ni positif, ni négatif"],
    ["(3 020,000) (3 020,000)", "deux paires"],
    ["(3 020,000))", "une paire, et une fermante orpheline"],
    ["(3 020,000) 3 020,000", "un négatif comptable et un positif"],
    ["3 020,000-", "le moins en queue"],
    ["3 020,000 -3 020,000", "le même chiffre, de signes contraires"],
    ["3 020,000 3 020,000 3 200,000", "deux pareils, un différent"],
    // Recollé, « 30203020 » se lit aussi : deux lectures, on ne choisit pas.
    ["3 020 3 020", "3 020 répété, ou 30 203 020 aux espaces parasites"],
    ["|", "du bruit seul"],
    ["", "rien"],
  ];
  for (const [brut, pourquoi] of REFUS)
    it(`« ${brut} » reste illisible : ${pourquoi}`, () => {
      assert.deepEqual(candidatsMontant(brut, P), []);
    });
});

describe("la facture du 29 octobre se normalise, et ne se devine pas", () => {
  /*
   * L'arithmétique, refaite ici plutôt que supposée : 3 020,000 × 19 % =
   * 573,800 — pas 574,800. 3 594,800 − 3 020,000 − 573,800 = 1,000 : le
   * droit de timbre. Le rapport 3 594,800 / 3 020,000 ≈ 1,19 n'était qu'une
   * coïncidence d'un dinar.
   */
  it("HT répété en colonnes, TVA, timbre et total : tranchée", () => {
    const r = normaliserMontants(
      {
        bases: [{ ht: "3 020,000 3 020,000)", taux: "0.19" }],
        tva: "573,800",
        autres: [{ brut: "1,000", attendu: 1_000 }],
        ttc: "3 594,800",
      },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.deepEqual(r.montants.bases, [{ ht: 3_020_000, taux: "0.19" }]);
    assert.equal(r.montants.tva, 573_800);
    assert.equal(r.montants.ttc, 3_594_800);
  });

  it("une TVA de 574,800 sur 3 020,000 à 19 % ne tient pas : aucun chiffre rendu", () => {
    // HT + TVA = TTC tombe juste, mais la TVA n'est pas 19 % du HT : le
    // moteur refuse, et c'est le bon refus.
    const r = normaliserMontants(
      {
        bases: [{ ht: "3 020,000 3 020,000)", taux: "0.19" }],
        tva: "574,800",
        ttc: "3 594,800",
      },
      P,
    );
    assert.equal(r.etat, "incoherent", r.raison);
    assert.equal(r.montants.bases[0]!.ht, null);
  });
});

describe("la base de la ligne ne se lit pas : le pied de facture la porte", () => {
  const PIECE = {
    tva: "573,800",
    autres: [{ brut: "1,000", attendu: 1_000 }],
    ttc: "3 594,800",
  };

  it("la ligne illisible, le HT du pied lisible et vérifié : retenu, et dit", () => {
    const r = normaliserMontants(
      { ...PIECE, bases: [{ ht: "3 020,000 3 200,000", pied: "3 020,000", taux: "0.19" }] },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.montants.bases[0]!.ht, 3_020_000);
    assert.equal(r.ligneNonLue, "3 020,000 3 200,000");
    assert.match(r.raison, /pied de facture/);
  });

  it("la ligne lisible : le pied ne sert pas", () => {
    const r = normaliserMontants(
      { ...PIECE, bases: [{ ht: "3 020,000", pied: "9 999,000", taux: "0.19" }] },
      P,
    );
    assert.equal(r.etat, "tranche", r.raison);
    assert.equal(r.ligneNonLue, null);
  });

  it("un pied qui ne vérifie pas la facture ne sauve rien : la ligne reste illisible", () => {
    const r = normaliserMontants(
      { ...PIECE, bases: [{ ht: "3 020,000 3 200,000", pied: "3 200,000", taux: "0.19" }] },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
    assert.equal(r.montants.bases[0]!.ht, null);
    assert.match(r.raison, /3 020,000 3 200,000/);
  });

  it("deux bases : le pied ne se ventile pas, on ne déduit rien", () => {
    const r = normaliserMontants(
      {
        bases: [
          { ht: "1 000,000 2 000,000", pied: "3 020,000", taux: "0.19" },
          { ht: "100,000", taux: "0.07" },
        ],
        ttc: "3 594,800",
      },
      P,
    );
    assert.equal(r.etat, "illisible", r.raison);
  });
});
