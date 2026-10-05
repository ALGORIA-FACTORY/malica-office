/**
 * Ce que l'écran doit montrer d'un droit hors TVA.
 *
 * ================================================================= POURQUOI
 *
 * Le droit de timbre de la facture du 4 octobre 2026 était en base, exact, à
 * 1,000 dinar — et invisible. `other_charges` n'apparaissait qu'une fois dans
 * l'écran de la pièce : dans la déclaration de type.
 *
 * Un champ typé mais jamais rendu ne casse aucune compilation. Ce fichier est
 * la garantie qui manquait, et elle vit ici plutôt que dans le JSX pour une
 * raison : une fonction pure se teste, une interpolation ne se teste pas.
 */
import { describe, expect, it } from "vitest";

import { droitsDeLaPiece } from "../droits-de-la-piece";

const PACK = [
  { code: "DROIT_TIMBRE", label: "Droit de timbre", legalReference: "CDET art. 117" },
  { code: "TAXE_SEJOUR", label: "Taxe de séjour", legalReference: null },
];

describe("les droits hors TVA d'une pièce", () => {
  it("rend le timbre de la facture du 4 octobre 2026", () => {
    const r = droitsDeLaPiece([{ code: "DROIT_TIMBRE", amount: "1.000" }], PACK);
    expect(r).toEqual([
      {
        code: "DROIT_TIMBRE",
        libelle: "Droit de timbre",
        montant: "1.000",
        reference: "CDET art. 117",
        connu: true,
      },
    ]);
  });

  it("prend le libellé au pack, jamais au code", () => {
    // R4 : le libellé d'un droit est une donnée du référentiel, datée et
    // versionnée. L'écrire en dur dans l'écran le figerait.
    const r = droitsDeLaPiece([{ code: "TAXE_SEJOUR", amount: "2.500" }], PACK);
    expect(r[0]!.libelle).toBe("Taxe de séjour");
  });

  it("rend la référence légale quand le pack la porte", () => {
    // « D'où vient ce chiffre » doit avoir une réponse à l'écran, pas dans un
    // historique.
    const r = droitsDeLaPiece([{ code: "DROIT_TIMBRE", amount: "1.000" }], PACK);
    expect(r[0]!.reference).toBe("CDET art. 117");
  });

  it("et null quand il ne la porte pas, sans l'inventer", () => {
    const r = droitsDeLaPiece([{ code: "TAXE_SEJOUR", amount: "2.500" }], PACK);
    expect(r[0]!.reference).toBeNull();
  });

  it("signale un code que le pack ignore, au lieu de le présenter comme un libellé", () => {
    /*
     * Afficher « DROIT_INCONNU » comme s'il s'agissait d'un libellé serait le
     * défaut « ISSUER » du 4 octobre : un identifiant machine montré à une
     * personne. On le rend, parce que le cacher serait pire, mais on dit que
     * le pack ne le connaît pas.
     */
    const r = droitsDeLaPiece([{ code: "DROIT_INCONNU", amount: "0.500" }], PACK);
    expect(r[0]!.connu).toBe(false);
    expect(r[0]!.libelle).toBe("DROIT_INCONNU");
  });

  it("traite un libellé vide comme une absence", () => {
    // Une ligne de pack au libellé blanc ne vaut pas mieux qu'un code absent :
    // elle afficherait un espace à la place du nom du droit.
    const r = droitsDeLaPiece(
      [{ code: "X", amount: "1.000" }],
      [{ code: "X", label: "   ", legalReference: null }],
    );
    expect(r[0]!.connu).toBe(false);
    expect(r[0]!.libelle).toBe("X");
  });

  it("ne formate pas le montant : ce n'est pas son travail", () => {
    // Le formatage vit dans `lisible.ts`, qui connaît la locale. Deux endroits
    // qui formatent finissent par formater différemment.
    const r = droitsDeLaPiece([{ code: "DROIT_TIMBRE", amount: "1.000" }], PACK);
    expect(r[0]!.montant).toBe("1.000");
  });

  it("rend une liste vide quand la pièce ne porte aucun droit", () => {
    expect(droitsDeLaPiece([], PACK)).toEqual([]);
    expect(droitsDeLaPiece(undefined, PACK)).toEqual([]);
    expect(droitsDeLaPiece(null, PACK)).toEqual([]);
  });

  it("garde l'ordre de la pièce, et chaque droit, même répété", () => {
    // Deux droits du même code peuvent coexister sur une pièce ; en dédupliquer
    // un ferait disparaître un montant de l'écran, et le TTC ne boucherait plus.
    const r = droitsDeLaPiece(
      [
        { code: "DROIT_TIMBRE", amount: "1.000" },
        { code: "TAXE_SEJOUR", amount: "2.500" },
        { code: "DROIT_TIMBRE", amount: "1.000" },
      ],
      PACK,
    );
    expect(r.map((d) => d.montant)).toEqual(["1.000", "2.500", "1.000"]);
  });

  it("sans référentiel, rend les codes en les signalant plutôt que de taire les droits", () => {
    // Le pack peut n'avoir pas encore chargé. Un timbre affiché sous son code
    // vaut mieux qu'un timbre absent : c'est l'absence qui a coûté le 4 octobre.
    const r = droitsDeLaPiece([{ code: "DROIT_TIMBRE", amount: "1.000" }], []);
    expect(r).toHaveLength(1);
    expect(r[0]!.connu).toBe(false);
  });
});
