/**
 * L'écriture d'un avoir lié à sa facture (réglage `avoirs.traitement` =
 * `lie_facture`, décision du CEO du 31 octobre 2026). Les comptes viennent de
 * l'écriture de la facture, passés ici comme la base les rend ; les montants,
 * de ce que l'avoir imprime.
 */
import { describe, expect, it } from "vitest";

import { ecritureDAvoir, type LigneDeLaFacture } from "../ecriture-d-avoir.ts";

const ligne = (
  account_code: string,
  nature: LigneDeLaFacture["nature"],
  debit: string,
  credit: string,
  tax_code: string | null = null,
  droit_code: string | null = null,
): LigneDeLaFacture => ({
  account_code,
  libelle: `ligne ${account_code}`,
  debit,
  credit,
  tax_code,
  nature,
  droit_code,
});

/** Un achat à deux taux, deux bases au même taux, un droit : l'écriture de la facture. */
const ACHAT: LigneDeLaFacture[] = [
  ligne("606", "base", "600.000", "0", "TVA19"),
  ligne("622", "base", "400.000", "0", "TVA19"),
  ligne("601", "base", "500.000", "0", "TVA07"),
  ligne("4366", "tva", "190.000", "0", "TVA19"),
  ligne("4366", "tva", "35.000", "0", "TVA07"),
  ligne("6654", "droit", "1.000", "0", null, "DROIT_TIMBRE"),
  ligne("401", "tiers", "0", "1726.000"),
];

const avoir = (
  bases: Array<{ code: string; ht: string; tva: string }>,
  ttc: string,
  ecriture: "selon_avoir" | "extourne" | "rabais" = "selon_avoir",
  lignes = ACHAT,
  droits: Array<{ code: string; montant: string }> = [],
  droitsDeLaFacture: Array<{ code: string; libelle: string; montant: string }> = [],
) =>
  ecritureDAvoir({
    pieceId: "00000000-0000-4000-8000-000000000001",
    sens: "facture_achat",
    date: "2026-10-20",
    devise: "TND",
    decimales: 3,
    facture: { journal: "ACH", lignes },
    avoir: { bases, droits, ttc },
    ecriture,
    // Le préfixe du pack, tel que `ref.comptes_de_rabais` le porte.
    compteDeRabais: (c) => (c.startsWith("60") ? "609" : null),
    contrepartie: "FOURNISSEUR D'ESSAI",
    reference: "AV-1",
    droitsDeLaFacture,
  });

const lignes = (r: ReturnType<typeof avoir>) =>
  r.ok ? r.lignes.map((l) => [l.account_code, l.debit, l.credit, l.tax_code]) : r.refus;

describe("l'écriture d'un avoir lié à sa facture", () => {
  it("partiel sur un taux : au prorata des bases du taux, plus forts restes, la TVA imprimée", () => {
    // 100,001 de base à 19 % sur 606 (600) et 622 (400) : 60,001 / 40,000.
    const r = avoir([{ code: "TVA19", ht: "100.001", tva: "19.000" }], "119.001", "extourne");
    expect(lignes(r)).toEqual([
      ["606", "0", "60.001", "TVA19"],
      ["622", "0", "40.000", "TVA19"],
      ["4366", "0", "19.000", "TVA19"],
      ["401", "119.001", "0", null],
    ]);
    expect(r.ok && r.traitement).toBe("extourne");
    expect(r.ok && r.pivot.totals).toEqual({ debit: "119.001", credit: "119.001" });
  });

  it("le rabais : une base 60 au compte des RRR, une base sans compte de RRR sur elle-même", () => {
    const r = avoir([{ code: "TVA19", ht: "100.000", tva: "19.000" }], "119.000", "rabais");
    expect(lignes(r)).toEqual([
      ["609", "0", "60.000", "TVA19"],
      ["622", "0", "40.000", "TVA19"],
      ["4366", "0", "19.000", "TVA19"],
      ["401", "119.000", "0", null],
    ]);
  });

  it("selon l'avoir : total, l'extourne exacte de la facture", () => {
    const r = avoir(
      [
        { code: "TVA19", ht: "1000.000", tva: "190.000" },
        { code: "TVA07", ht: "500.000", tva: "35.000" },
      ],
      "1726.000",
      "selon_avoir",
      ACHAT,
      [{ code: "DROIT_TIMBRE", montant: "1.000" }],
    );
    expect(r.ok && r.traitement).toBe("extourne");
    expect(lignes(r)).toEqual([
      ["606", "0", "600.000", "TVA19"],
      ["622", "0", "400.000", "TVA19"],
      ["4366", "0", "190.000", "TVA19"],
      ["601", "0", "500.000", "TVA07"],
      ["4366", "0", "35.000", "TVA07"],
      ["6654", "0", "1.000", null],
      ["401", "1726.000", "0", null],
    ]);
  });

  it("une TVA que la facture n'a pas déduite retourne à la base", () => {
    const sansTva = [ligne("601", "base", "1190.000", "0"), ligne("401", "tiers", "0", "1190.000")];
    const r = avoir(
      [{ code: "TVA19", ht: "100.000", tva: "19.000" }],
      "119.000",
      "extourne",
      sansTva,
    );
    expect(lignes(r)).toEqual([
      ["601", "0", "119.000", "TVA19"],
      ["401", "119.000", "0", null],
    ]);
  });

  it("refuse ce qui excède la facture, au total ou sur un taux, et ce qu'elle n'a pas", () => {
    expect(avoir([{ code: "TVA19", ht: "2000.000", tva: "380.000" }], "2380.000").ok).toBe(false);
    expect(lignes(avoir([{ code: "TVA07", ht: "600.000", tva: "42.000" }], "642.000"))).toBe(
      "avoir_excede_la_facture",
    );
    expect(lignes(avoir([{ code: "TVA13", ht: "10.000", tva: "1.300" }], "11.300"))).toBe(
      "avoir_hors_facture",
    );
    expect(
      lignes(
        avoir([{ code: "TVA19", ht: "10.000", tva: "1.900" }], "12.900", "extourne", ACHAT, [
          { code: "FODEC", montant: "1.000" },
        ]),
      ),
    ).toBe("avoir_hors_facture");
  });

  it("refuse un avoir qui ne tient pas, et une facture qui ne se lit pas comme une facture", () => {
    expect(lignes(avoir([{ code: "TVA19", ht: "100.000", tva: "19.000" }], "120.000"))).toBe(
      "avoir_desequilibre",
    );
    const aRebours = [ligne("601", "base", "100.000", "0"), ligne("401", "tiers", "100.000", "0")];
    expect(
      lignes(
        avoir([{ code: "TVA19", ht: "10.000", tva: "0.000" }], "10.000", "extourne", aRebours),
      ),
    ).toBe("facture_illisible");
  });

  /*
   * Revue de #161 : chaque ligne de l'avoir se comparait à TOUTE la TVA du
   * taux, sans déduire ce que les lignes précédentes du même taux avaient
   * déjà repris. Deux lignes à 19 % de 600 / 114 reprenaient 228 de TVA sur
   * une facture qui n'en porte que 190, sous la borne du total (1 428 ≤ 1 725).
   */
  it("deux lignes au même taux se cumulent : l'avoir ne reprend jamais plus que la facture sur un taux", () => {
    const sansDroit = ACHAT.filter((l) => l.nature !== "droit").map((l) =>
      l.nature === "tiers" ? { ...l, credit: "1725.000" } : l,
    );
    const deuxFois = { code: "TVA19", ht: "600.000", tva: "114.000" };
    expect(lignes(avoir([deuxFois, deuxFois], "1428.000", "extourne", sansDroit))).toBe(
      "avoir_excede_la_facture",
    );
    // La base aussi : 2 × 600 de HT à 19 % sur 1 000.
    expect(
      lignes(
        avoir(
          [
            { code: "TVA19", ht: "600.000", tva: "0.000" },
            { code: "TVA19", ht: "600.000", tva: "0.000" },
          ],
          "1200.000",
          "extourne",
          sansDroit,
        ),
      ),
    ).toBe("avoir_excede_la_facture");
    // Sous la facture, deux lignes du même taux valent une ligne de leur somme.
    const enDeux = avoir(
      [
        { code: "TVA19", ht: "60.001", tva: "11.400" },
        { code: "TVA19", ht: "40.000", tva: "7.600" },
      ],
      "119.001",
      "extourne",
    );
    const enUne = avoir([{ code: "TVA19", ht: "100.001", tva: "19.000" }], "119.001", "extourne");
    expect(lignes(enDeux)).toEqual(lignes(enUne));
  });

  it("deux codes qui partagent les mêmes bases sans code : leur solde se partage, il ne se recompte pas", () => {
    // Une facture dont les bases ne portent pas de code, à deux taux.
    const facture = [
      ligne("601", "base", "1000.000", "0"),
      ligne("4366", "tva", "95.000", "0", "TVA19"),
      ligne("4366", "tva", "35.000", "0", "TVA07"),
      ligne("401", "tiers", "0", "1130.000"),
    ];
    expect(
      lignes(
        avoir(
          [
            { code: "TVA19", ht: "600.000", tva: "0.000" },
            { code: "TVA07", ht: "500.000", tva: "0.000" },
          ],
          "1100.000",
          "extourne",
          facture,
        ),
      ),
    ).toBe("avoir_excede_la_facture");
  });

  /*
   * Revue de #161 : le FODEC d'un achat porté au COÛT (`fodec.traitement` =
   * `par_article_au_cout`, `droitsAuCout`) prend le compte de la charge ; sa
   * ligne se range « base », et l'avoir qui le reprend était refusé
   * (`avoir_hors_facture`), même en extourne exacte. La lecture de la facture
   * dit le droit, son libellé et son montant : sa ligne se retrouve.
   */
  const AU_COUT: LigneDeLaFacture[] = [
    { ...ligne("607", "base", "1000.000", "0"), libelle: "FOURNISSEUR D'ESSAI" },
    { ...ligne("607", "base", "10.000", "0"), libelle: "FODEC" },
    ligne("4366", "tva", "191.900", "0", "TVA19"),
    ligne("401", "tiers", "0", "1201.900"),
  ];
  const FODEC_LU = [{ code: "FODEC", libelle: "FODEC", montant: "10.000" }];
  const AVOIR_TOTAL = [{ code: "TVA19", ht: "1000.000", tva: "191.900" }];

  it("le FODEC porté au coût : l'extourne exacte, sa ligne retrouvée par la lecture de la facture", () => {
    const r = avoir(
      AVOIR_TOTAL,
      "1201.900",
      "selon_avoir",
      AU_COUT,
      [{ code: "FODEC", montant: "10.000" }],
      FODEC_LU,
    );
    expect(r.ok && r.traitement).toBe("extourne");
    expect(r.ok && r.reserves).toEqual([]);
    expect(r.ok && r.lignes.map((l) => [l.account_code, l.libelle, l.debit, l.credit])).toEqual([
      ["607", "FOURNISSEUR D'ESSAI", "0", "1000.000"],
      ["4366", "ligne 4366", "0", "191.900"],
      ["607", "FODEC", "0", "10.000"],
      ["401", "ligne 401", "1201.900", "0"],
    ]);
    // Partiel, le droit se réduit sur SA ligne, la base sur la sienne.
    const partiel = avoir(
      [{ code: "TVA19", ht: "100.000", tva: "19.190" }],
      "120.190",
      "extourne",
      AU_COUT,
      [{ code: "FODEC", montant: "1.000" }],
      FODEC_LU,
    );
    expect(partiel.ok && partiel.lignes.map((l) => [l.libelle, l.debit, l.credit])).toEqual([
      ["FOURNISSEUR D'ESSAI", "0", "100.000"],
      ["ligne 4366", "0", "19.190"],
      ["FODEC", "0", "1.000"],
      ["ligne 401", "120.190", "0"],
    ]);
    // Plus que le droit de la facture : refusé.
    expect(
      lignes(
        avoir(
          [{ code: "TVA19", ht: "10.000", tva: "1.900" }],
          "23.900",
          "extourne",
          AU_COUT,
          [{ code: "FODEC", montant: "12.000" }],
          FODEC_LU,
        ),
      ),
    ).toBe("avoir_excede_la_facture");
  });

  it("le FODEC au coût que rien ne retrouve : l'extourne exacte se propose, avec sa réserve ; un partiel se refuse", () => {
    // Le cabinet a renommé la ligne : la lecture ne la désigne plus.
    const renommee = AU_COUT.map((l) => (l.libelle === "FODEC" ? { ...l, libelle: "Droits" } : l));
    const r = avoir(
      AVOIR_TOTAL,
      "1201.900",
      "selon_avoir",
      renommee,
      [{ code: "FODEC", montant: "10.000" }],
      FODEC_LU,
    );
    expect(r.ok && r.reserves).toEqual([{ code: "droit_au_cout", droit: "FODEC" }]);
    expect(r.ok && r.lignes.map((l) => [l.libelle, l.debit, l.credit])).toEqual([
      ["FOURNISSEUR D'ESSAI", "0", "1000.000"],
      ["Droits", "0", "10.000"],
      ["ligne 4366", "0", "191.900"],
      ["ligne 401", "1201.900", "0"],
    ]);
    expect(
      lignes(
        avoir(
          [{ code: "TVA19", ht: "100.000", tva: "19.190" }],
          "120.190",
          "extourne",
          renommee,
          [{ code: "FODEC", montant: "1.000" }],
          FODEC_LU,
        ),
      ),
    ).toBe("droit_au_cout_non_attribue");
    // Un droit que la lecture de la facture ne porte pas reste hors facture.
    expect(
      lignes(
        avoir(AVOIR_TOTAL, "1201.900", "selon_avoir", renommee, [
          { code: "FODEC", montant: "10.000" },
        ]),
      ),
    ).toBe("avoir_hors_facture");
  });
});
