import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  lireMontantDuPlan,
  normalizeDate,
  resolveFromTokenPlan,
  type PageToken,
} from "./token-plan.ts";

/** Le dinar : trois décimales. Aucune devise n'est supposée par défaut. */
const DINAR = 3;

const tokens: PageToken[] = [
  { page: 1, ordinal: 0, text: "SOTUMAG", x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.12 },
  { page: 1, ordinal: 1, text: "12/03/2026", x0: 0.6, y0: 0.1, x1: 0.8, y1: 0.12 },
  { page: 1, ordinal: 2, text: "1 234,560", x0: 0.6, y0: 0.5, x1: 0.8, y1: 0.52 },
  { page: 1, ordinal: 3, text: "TND", x0: 0.82, y0: 0.5, x1: 0.9, y1: 0.52 },
];

describe("normalizeDate", () => {
  it("lit les deux ordres usuels", () => {
    assert.equal(normalizeDate("12/03/2026"), "2026-03-12");
    assert.equal(normalizeDate("2026-03-12"), "2026-03-12");
    assert.equal(normalizeDate("mars"), null);
  });
});

/**
 * ================================== LA DATE EN LETTRES, ET POURQUOI ELLE MANQUAIT
 *
 * Le 4 octobre 2026, une vraie facture de loyer portait « Tunis, le 1 septembre
 * 2026 ». Le produit a rendu `document_date: null`, et le contrat exige la date
 * — donc la pièce entière est sortie « partielle ».
 *
 * Deux verrous indépendants, et il fallait lever les deux : la consigne de
 * désignation interdisait de citer plus d'un jeton pour une date (trois jetons
 * ici), et `normalizeDate` ne connaissait aucun nom de mois. Les cas de cette
 * suite sont le second verrou.
 *
 * On ne devine rien : un mois seul reste `null`, et une date impossible le
 * reste aussi. Lire une date en lettres n'est pas être plus permissif, c'est
 * connaître une écriture de plus.
 */
describe("normalizeDate — les mois en toutes lettres", () => {
  it("lit la date relevée sur la vraie facture du 4 octobre 2026", () => {
    assert.equal(normalizeDate("1 septembre 2026"), "2026-09-01");
  });

  it("lit les douze mois français", () => {
    const mois = [
      "janvier",
      "février",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "août",
      "septembre",
      "octobre",
      "novembre",
      "décembre",
    ];
    mois.forEach((nom, i) => {
      const attendu = `2026-${String(i + 1).padStart(2, "0")}-15`;
      assert.equal(normalizeDate(`15 ${nom} 2026`), attendu, nom);
    });
  });

  it("tolère ce que le papier et l'œil font vraiment", () => {
    // « 1er », la casse, l'absence d'accent (une OCR les perd souvent), et le
    // « le » qui précède sans être un jeton de date.
    assert.equal(normalizeDate("1er mars 2026"), "2026-03-01");
    assert.equal(normalizeDate("15 MARS 2026"), "2026-03-15");
    assert.equal(normalizeDate("15 fevrier 2026"), "2026-02-15");
    assert.equal(normalizeDate("15 Aout 2026"), "2026-08-15");
    assert.equal(normalizeDate("le 15 mars 2026"), "2026-03-15");
  });

  it("lit les mois arabes — l'arabe fait foi", () => {
    assert.equal(normalizeDate("15 سبتمبر 2026"), "2026-09-15");
    assert.equal(normalizeDate("1 جانفي 2026"), "2026-01-01");
    // La Tunisie emploie « جانفي »/« فيفري »/« أوت » là où le Machrek emploie
    // « يناير »/« فبراير »/« أغسطس ». Les deux séries valent.
    assert.equal(normalizeDate("1 يناير 2026"), "2026-01-01");
    assert.equal(normalizeDate("15 أغسطس 2026"), "2026-08-15");
  });

  it("lit les chiffres arabes, en lettres comme en chiffres", () => {
    assert.equal(normalizeDate("١٥ سبتمبر ٢٠٢٦"), "2026-09-15");
    assert.equal(normalizeDate("٢٠٢٦-٠٣-١٢"), "2026-03-12");
    // Les chiffres persans (U+06F0) voisinent les arabes dans les polices.
    assert.equal(normalizeDate("۱۵ سبتمبر ۲۰۲۶"), "2026-09-15");
  });

  it("ne devine pas pour autant", () => {
    // Un mois sans jour ni année n'est pas une date — déjà verrouillé plus
    // haut, redit ici parce que c'est la limite de ce qu'on vient d'ouvrir.
    assert.equal(normalizeDate("septembre"), null);
    assert.equal(normalizeDate("septembre 2026"), null);
    // Un jour qui n'existe pas reste absent, comme pour les dates chiffrées.
    assert.equal(normalizeDate("31 février 2026"), null);
    // Un mot qui n'est pas un mois ne devient pas un mois.
    assert.equal(normalizeDate("15 prairial 2026"), null);
    // Une année à deux chiffres avec un mois en lettres est trop ambiguë pour
    // une écriture comptable : on la refuse plutôt que de choisir un siècle.
    assert.equal(normalizeDate("15 mars 26"), null);
  });
});

/**
 * =============================== LA PLAGE DE JETONS, DU MODÈLE JUSQU'À L'ÉCRAN
 *
 * Le dispositif R2 veut qu'un montant pointe le jeton qui le porte. Quand la
 * valeur s'étale sur deux jetons — « 2 800,000 » coupé par l'espace des
 * milliers — la citation doit porter LES DEUX, sans quoi le surlignage de
 * l'écran ne couvre que « 2 » et la relecture d'audit ne retrouve pas la
 * valeur. La capacité de lire la plage existait ; la citation la perdait.
 */
describe("la citation d'une plage de jetons", () => {
  const coupe: PageToken[] = [
    { page: 1, ordinal: 0, text: "TOTAL", x0: 0.1, y0: 0.5, x1: 0.2, y1: 0.52 },
    { page: 1, ordinal: 1, text: "2", x0: 0.6, y0: 0.5, x1: 0.63, y1: 0.52 },
    { page: 1, ordinal: 2, text: "800,000", x0: 0.64, y0: 0.5, x1: 0.8, y1: 0.52 },
  ];

  it("garde la fin de plage, pour que l'audit retrouve la valeur", () => {
    const r = lireMontantDuPlan(coupe, "totals.ttc", { page: 1, ordinal: 1, ordinalEnd: 2 }, DINAR);
    assert.equal(r.value, "2800.000");
    assert.equal(r.citation?.ordinal, 1);
    assert.equal(r.citation?.ordinalEnd, 2, "la citation doit porter la fin de la plage");
  });

  it("surligne toute la valeur, pas son premier mot", () => {
    const r = lireMontantDuPlan(coupe, "totals.ttc", { page: 1, ordinal: 1, ordinalEnd: 2 }, DINAR);
    // Le cadre cité est l'union des jetons de la plage : il commence au « 2 »
    // et finit au bout de « 800,000 ». Un cadre qui s'arrête à 0,63 montre à
    // la personne un chiffre qui n'est pas celui qu'on lui annonce.
    assert.equal(r.citation?.bbox?.x0, 0.6);
    assert.equal(r.citation?.bbox?.x1, 0.8);
  });

  it("sans plage désignée, le cadre reste celui du seul jeton cité", () => {
    const r = lireMontantDuPlan(coupe, "totals.ttc", { page: 1, ordinal: 1 }, DINAR);
    assert.equal(r.citation?.ordinalEnd, undefined);
    assert.equal(r.citation?.bbox?.x1, 0.63);
  });

  it("une date en plage se relit sur toute la plage", () => {
    const enLettres: PageToken[] = [
      { page: 1, ordinal: 0, text: "1", x0: 0.1, y0: 0.1, x1: 0.12, y1: 0.12 },
      { page: 1, ordinal: 1, text: "septembre", x0: 0.13, y0: 0.1, x1: 0.25, y1: 0.12 },
      { page: 1, ordinal: 2, text: "2026", x0: 0.26, y0: 0.1, x1: 0.32, y1: 0.12 },
    ];
    const r = resolveFromTokenPlan(
      enLettres,
      "document_date",
      { page: 1, ordinal: 0, ordinalEnd: 2 },
      "date",
    );
    assert.equal(r.value, "2026-09-01");
    assert.equal(r.flag, null);
    assert.equal(r.citation?.ordinalEnd, 2);
  });
});

describe("resolveFromTokenPlan — R2", () => {
  it("relit la valeur depuis le token, jamais depuis le modèle", () => {
    const r = lireMontantDuPlan(tokens, "totals.ttc", { page: 1, ordinal: 2 }, DINAR);
    assert.equal(r.value, "1234.560");
    assert.partialDeepStrictEqual(r.citation, { field: "totals.ttc", page: 1, ordinal: 2 });
    assert.equal(r.flag, null);
  });

  it("drapeaute une désignation orpheline sans produire de valeur", () => {
    const r = lireMontantDuPlan(tokens, "totals.vat", { page: 1, ordinal: 99 }, DINAR);
    assert.equal(r.value, null);
    assert.equal(r.citation, null);
    assert.equal(r.flag?.code, "TOKEN_NOT_FOUND");
  });

  it("drapeaute l'absence de citation", () => {
    const r = resolveFromTokenPlan(tokens, "issuer", null, "text");
    assert.equal(r.value, null);
    assert.equal(r.flag?.code, "MISSING_CITATION");
  });

  it("refuse un token non numérique désigné comme montant", () => {
    const r = lireMontantDuPlan(tokens, "totals.base_ht", { page: 1, ordinal: 3 }, DINAR);
    assert.equal(r.value, null);
    assert.notEqual(r.citation, null);
    assert.equal(r.flag?.code, "VALUE_NOT_A_NUMBER");
  });
});
