import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JEU_D_OR } from "./jeu-d-or.ts";
import { recollerLesMilliers } from "./recoller-les-milliers.ts";
import type { PageToken } from "./token-plan.ts";

/**
 * Le recollage des milliers — éprouvé sur le PLAN RÉEL, puis sur les pièges.
 *
 * ================================================================= POURQUOI
 *
 * Lever l'interdiction de citer deux jetons a réparé le défaut du 4 octobre,
 * et la garantie repose désormais sur l'obéissance d'un modèle. Il suffit qu'il
 * l'oublie une fois pour que « 2 800,000 » redevienne 2,000 — silencieusement,
 * puisqu'un montant tronqué n'est pas ambigu.
 *
 * Recoller au niveau du plan rend la garantie structurelle. Mais recoller est
 * aussi le geste le plus dangereux de toute la chaîne : réunir deux jetons qui
 * ne vont pas ensemble FABRIQUE un montant, ce que R2 interdit absolument.
 *
 * La moitié des cas ci-dessous dit donc ce qu'il ne faut JAMAIS recoller, et
 * ils viennent du même plan réel que les autres.
 */

const DINAR = 3;
const plan = JEU_D_OR[0]!.tokens;
const texteDe = (t: readonly PageToken[], ordinal: number) =>
  t.find((x) => x.ordinal === ordinal)?.text;

describe("recoller les milliers — sur le plan réel de la facture du 4 octobre 2026", () => {
  const recolle = recollerLesMilliers(plan);

  it("réunit le prix unitaire coupé : « 2 » + « 800,000 »", () => {
    assert.equal(texteDe(recolle, 88), "2 800,000");
    assert.equal(texteDe(recolle, 89), undefined, "le morceau absorbé disparaît");
  });

  it("réunit le total de ligne, la base et le TTC", () => {
    assert.equal(texteDe(recolle, 90), "2 800,000");
    assert.equal(texteDe(recolle, 107), "3 020,000");
    assert.equal(texteDe(recolle, 114), "3 594,800");
  });

  it("NE franchit PAS la gouttière de colonne", () => {
    /*
     * « 220,000 » (prix unitaire du second article) et « 220,000 » (son total)
     * sont sur la même ligne imprimée, séparés par 0,097 — dix largeurs de
     * caractère, contre une pour l'espace des milliers. Les recoller ferait
     * disparaître le total de ligne du plan.
     *
     * Les deux survivent donc entiers, chacun sous son ordinal.
     */
    assert.equal(texteDe(recolle, 92), "220,000");
    assert.equal(texteDe(recolle, 93), "220,000");
  });

  it("NE recolle PAS le numéro de téléphone de l'émetteur", () => {
    /*
     * LA DÉCOUVERTE DU PROTOTYPE. « Tél : 98 456 123 » se présente en trois
     * jetons — « 98 », « 456 », « 123 » — sur une ligne, à une largeur de
     * caractère. Exactement la forme d'un montant tunisien.
     *
     * La règle géométrique seule les recollait en « 98 456 123 », soit
     * 98 456,123 dinars lus sur un numéro de téléphone : une valeur FABRIQUÉE,
     * ce que R2 interdit absolument. C'est bien pire qu'un montant laissé en
     * deux morceaux.
     *
     * Ce sont les décimales exigées sur le dernier groupe qui les séparent :
     * un montant tunisien imprime ses millimes, un téléphone jamais.
     */
    assert.equal(texteDe(recolle, 20), "98");
    assert.equal(texteDe(recolle, 21), "456");
    assert.equal(texteDe(recolle, 22), "123");
  });

  it("NE recolle PAS le numéro de compte du pied de page", () => {
    // « 04 012 0098765432101 77 » : même forme, même piège.
    assert.equal(texteDe(recolle, 153), "04");
    assert.equal(texteDe(recolle, 154), "012");
  });

  it("NE réunit PAS les deux quantités, qui sont sur deux lignes", () => {
    // Ordinaux 86 et 87, tous deux « 1 » : les quantités des deux articles.
    assert.equal(texteDe(recolle, 86), "1");
    assert.equal(texteDe(recolle, 87), "1");
  });

  it("laisse la date en lettres intacte : « septembre » n'est pas un nombre", () => {
    assert.equal(texteDe(recolle, 45), "1");
    assert.equal(texteDe(recolle, 46), "septembre");
    assert.equal(texteDe(recolle, 47), "2026");
  });

  it("n'absorbe pas la devise, qui n'est pas un groupe de trois chiffres", () => {
    assert.equal(texteDe(recolle, 109), "DT");
  });

  it("ne perd aucun jeton qui n'a pas été absorbé", () => {
    // Quatre montants coupés en deux : 177 jetons deviennent 173.
    // Quatre montants coupés en deux, plus « (base 3 020,000) » : cinq jetons
    // absorbés, et aucun autre. 177 deviennent 172.
    assert.equal(plan.length, 177);
    assert.equal(recolle.length, 172);
  });

  it("et les montants recollés se lisent, tous les quatre", async () => {
    // La preuve que l'affaire est close : le plan recollé rend les vrais
    // montants SANS qu'aucun modèle ait à désigner une plage.
    const { treillisMontant } = await import("./montants.ts");
    const lit = (ordinal: number) =>
      treillisMontant(texteDe(recolle, ordinal) ?? "", DINAR).map((h) => h.millimes);
    assert.deepEqual(lit(88), [2800000]);
    assert.deepEqual(lit(90), [2800000]);
    assert.deepEqual(lit(107), [3020000]);
    assert.deepEqual(lit(114), [3594800]);
  });
});

describe("recoller les milliers — ce qu'il ne faut jamais réunir", () => {
  const jeton = (
    ordinal: number,
    text: string,
    x0: number,
    y0 = 0.5,
    largeur = 0.008,
  ): PageToken => ({
    page: 1,
    ordinal,
    text,
    x0,
    y0,
    x1: x0 + largeur * text.length,
    y1: y0 + 0.012,
  });

  it("une année n'ouvre pas un groupe de milliers", () => {
    // « 2026 » puis « 000 » : quatre chiffres ne peuvent pas être la tête d'un
    // nombre tunisien. Recoller donnerait 2 026 000.
    const r = recollerLesMilliers([jeton(0, "2026", 0.1), jeton(1, "000,000", 0.136)]);
    assert.equal(r.length, 2);
  });

  it("un numéro de pièce n'absorbe rien", () => {
    const r = recollerLesMilliers([jeton(0, "FA/2026/00412", 0.1), jeton(1, "500", 0.21)]);
    assert.equal(r.length, 2);
  });

  it("deux jetons éloignés restent séparés même sur la même ligne", () => {
    // Dix largeurs de caractère : la gouttière de colonne mesurée sur la vraie
    // facture. C'est le seuil qui protège le total de ligne.
    const r = recollerLesMilliers([jeton(0, "2", 0.1), jeton(1, "800,000", 0.19)]);
    assert.equal(r.length, 2);
  });

  it("deux jetons de lignes différentes restent séparés même alignés en x", () => {
    const r = recollerLesMilliers([jeton(0, "2", 0.1), jeton(1, "800,000", 0.109, 0.56)]);
    assert.equal(r.length, 2);
  });

  it("un groupe de deux chiffres ne suit pas : le groupe de milliers en fait trois", () => {
    // « 2 » + « 80,000 » n'est pas un nombre tunisien. Recoller ferait 280,000.
    const r = recollerLesMilliers([jeton(0, "2", 0.1), jeton(1, "80,000", 0.109)]);
    assert.equal(r.length, 2);
  });

  it("le recollage s'arrête dès les décimales", () => {
    // « 1 » + « 234,560 » + « 999 » : le deuxième morceau porte les décimales,
    // donc le nombre est fini. Absorber le troisième donnerait 1 234 560 999.
    const r = recollerLesMilliers([
      jeton(0, "1", 0.1),
      jeton(1, "234,560", 0.109),
      jeton(2, "999", 0.175),
    ]);
    assert.equal(r[0]!.text, "1 234,560");
    assert.equal(r.length, 2);
  });
});

describe("recoller les milliers — les nombres longs, qui ont plus de deux morceaux", () => {
  const suite = (textes: string[]): PageToken[] => {
    let x = 0.1;
    return textes.map((text, ordinal) => {
      const t: PageToken = {
        page: 1,
        ordinal,
        text,
        x0: x,
        y0: 0.5,
        x1: x + 0.008 * text.length,
        y1: 0.512,
      };
      x = t.x1 + 0.008;
      return t;
    });
  };

  it("réunit un million : « 1 » + « 234 » + « 560,000 »", () => {
    const r = recollerLesMilliers(suite(["1", "234", "560,000"]));
    assert.equal(r.length, 1);
    assert.equal(r[0]!.text, "1 234 560,000");
  });

  it("mais PAS « 1 » + « 234 » + « 560 », qui n'a pas de décimales", () => {
    /*
     * Cette forme est celle que le produit traite déjà comme AMBIGUË :
     * « 1 234 560 » vaut 1 234,560 D ou 1 234 560 D, et c'est le droit de
     * timbre qui tranche l'échelle. La laisser en morceaux ne perd rien — la
     * plage désignée et le solveur la couvrent, en posant une question.
     *
     * Et c'est le prix à payer pour ne pas recoller un numéro de téléphone.
     */
    const r = recollerLesMilliers(suite(["1", "234", "560"]));
    assert.equal(r.length, 3);
  });

  it("réunit un million avec décimales : « 12 » + « 345 » + « 678,900 »", () => {
    const r = recollerLesMilliers(suite(["12", "345", "678,900"]));
    assert.equal(r.length, 1);
    assert.equal(r[0]!.text, "12 345 678,900");
  });

  it("le cadre du jeton recollé couvre toute la valeur", () => {
    // Sans quoi l'écran surlignerait le premier morceau sous un montant
    // entier — le défaut de citation corrigé le 5 octobre, réintroduit ici.
    const morceaux = suite(["1", "234", "560,000"]);
    const r = recollerLesMilliers(morceaux);
    assert.equal(r[0]!.x0, morceaux[0]!.x0);
    assert.equal(r[0]!.x1, morceaux[2]!.x1);
  });

  it("garde la confiance du morceau le moins sûr", () => {
    const morceaux = suite(["1", "234,560"]).map((t, i) => ({
      ...t,
      confidence: i === 1 ? 0.42 : 0.99,
    }));
    const r = recollerLesMilliers(morceaux);
    assert.equal(
      r[0]!.confidence,
      0.42,
      "un nombre ne vaut pas mieux que sa partie la plus douteuse",
    );
  });
});
