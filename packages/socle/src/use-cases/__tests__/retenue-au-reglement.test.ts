import { describe, expect, it } from "vitest";
import { construireReglement, type EntreeReglement } from "../ecriture-de-reglement.ts";
import {
  constaterLaRetenue,
  lireLaQualification,
  RetenueNonQualifiee,
} from "../retenue-au-reglement.ts";

const BASE = {
  ttc: "2000.000",
  paye: "1970.000",
  seuil: null,
  decimales: 3,
  taux: [
    { code: "IR", taux: "0.015", libelle: "Retenue IR", seuil: "1000", famille: "ir" as const },
    {
      code: "TVA",
      taux: "0.25",
      libelle: "TVA retenue",
      base: "tva" as const,
      famille: "tva" as const,
    },
  ],
};
const q = {
  codes: ["IR"],
  baseReglee: "2000.000",
  justification: "Certificat RS-1, opération qualifiée",
};

describe("retenue explicitement qualifiée", () => {
  it("1970 sur 2000 ne prouve jamais une retenue de 30", () => {
    expect(constaterLaRetenue(BASE)).toEqual({ cas: "a_confirmer" });
  });
  it("le seuil ne suffit pas à rendre un impôt applicable", () => {
    expect(constaterLaRetenue({ ...BASE, paye: BASE.ttc })).toEqual({ cas: "a_confirmer" });
  });
  it("un paiement partiel sans retenue conserve 30 de dette", () => {
    expect(
      constaterLaRetenue({ ...BASE, qualification: { ...q, codes: [], baseReglee: "1970.000" } }),
    ).toEqual({ cas: "sans_objet" });
  });
  it("une retenue qualifiée a le montant calculé, sans ajustement", () => {
    expect(constaterLaRetenue({ ...BASE, qualification: q })).toMatchObject({
      cas: "operee",
      montant: "30.000",
    });
  });
  it("une retenue sur un versement partiel utilise sa part brute", () => {
    expect(
      constaterLaRetenue({
        ...BASE,
        paye: "985.000",
        qualification: { ...q, baseReglee: "1000.000" },
      }),
    ).toMatchObject({ cas: "operee", montant: "15.000", ttc: "1000.000" });
  });

  it("distingue l'assiette qualifiée de la dette brute, sans taxer une somme exclue", () => {
    expect(
      constaterLaRetenue({
        ...BASE,
        ttc: "2001.000",
        paye: "1971.000",
        qualification: { ...q, baseReglee: "2001.000", assietteIR: "2000.000" },
      }),
    ).toMatchObject({ cas: "operee", montant: "30.000", ttc: "2001.000" });
  });
  it("l'impôt et la TVA retenue sont explicitement cumulés", () => {
    const c = constaterLaRetenue({
      ...BASE,
      ttc: "2380.000",
      tva: "380.000",
      paye: "2249.300",
      qualification: { ...q, codes: ["IR", "TVA"], baseReglee: "2380.000", tvaReglee: "380.000" },
    });
    expect(c).toMatchObject({ cas: "operee", montant: "130.700" });
    if (c.cas === "operee") expect(c.retenues.map((r) => r.montant)).toEqual(["35.700", "95.000"]);
  });
  it.each([
    { ...q, codes: ["INCONNU"] },
    { ...q, codes: ["IR", "IR"] },
    { ...q, justification: " " },
    { ...q, baseReglee: "2100.000" },
    { ...q, baseReglee: "2000.0001" },
    { ...q, codes: ["TVA"], tvaReglee: "381.000" },
  ])("refuse une qualification invalide : %j", (qualification) => {
    expect(() => constaterLaRetenue({ ...BASE, tva: "380.000", qualification })).toThrow(
      RetenueNonQualifiee,
    );
  });
  it("ne modifie pas une taxe d'un millime pour expliquer le net", () => {
    expect(() => constaterLaRetenue({ ...BASE, paye: "1970.001", qualification: q })).toThrow(
      /ne correspondent/,
    );
  });
  it("refuse la TVA retenue sans TVA connue", () => {
    expect(() => constaterLaRetenue({ ...BASE, qualification: { ...q, codes: ["TVA"] } })).toThrow(
      /TVA/,
    );
  });
});

const ACHAT: EntreeReglement = {
  sens: "facture_achat",
  montant: "1940.066",
  devise: "TND",
  decimales: 3,
  payeLe: "2026-10-13",
  moyenLibelle: "Chèque",
  tresorerieAccount: "532",
  journalCode: "BQ",
  counterpartyAccount: "401",
  tiers: "COMPTOIR DU CENTRE SUARL",
  reference: "4512871",
  referencePiece: "GS-2026-77120",
  retenue: { montant: "29.544", compte: "432", libelle: "RAS acquisitions 1,5 %" },
};

describe("l'écriture d'un règlement avec retenue", () => {
  it("achat : 401 au débit pour le TTC, 532 au crédit pour le net, 432 pour la retenue", () => {
    const e = construireReglement(ACHAT);
    expect(e.lignes).toEqual([
      expect.objectContaining({ account_code: "401", debit: "1969.610", credit: "0.000" }),
      expect.objectContaining({ account_code: "532", debit: "0.000", credit: "1940.066" }),
      expect.objectContaining({ account_code: "432", debit: "0.000", credit: "29.544" }),
    ]);
  });

  it("vente : la banque reçoit le net, la retenue subie est une créance, le client s'éteint au TTC", () => {
    const e = construireReglement({
      ...ACHAT,
      sens: "facture_vente",
      counterpartyAccount: "411",
      retenue: { montant: "29.544", compte: "4353", libelle: "RAS subie 1,5 %" },
    });
    expect(e.lignes).toEqual([
      expect.objectContaining({ account_code: "532", debit: "1940.066" }),
      expect.objectContaining({ account_code: "4353", debit: "29.544" }),
      expect.objectContaining({ account_code: "411", credit: "1969.610" }),
    ]);
  });

  it("s'équilibre toujours", () => {
    const e = construireReglement(ACHAT);
    const s = (k: "debit" | "credit") => e.lignes.reduce((a, l) => a + Number(l[k]) * 1000, 0);
    expect(s("debit")).toBe(s("credit"));
  });

  it("le libellé relie le règlement à sa facture et à son fournisseur", () => {
    const e = construireReglement(ACHAT);
    expect(e.libelle).toContain("COMPTOIR DU CENTRE SUARL");
    expect(e.libelle).toContain("GS-2026-77120");
  });

  it("une retenue sans compte au paramétrage est refusée, pas devinée", () => {
    expect(() =>
      construireReglement({ ...ACHAT, retenue: { montant: "29.544", compte: "", libelle: "x" } }),
    ).toThrow(/retenue/);
  });
});

/*
 * Décision du 24 octobre 2026 (Wissem Barouni) : sous le seuil légal, aucune
 * qualification n'est demandée. Un taux sans seuil (honoraires) ne déclenche
 * pas la question à lui seul : le règlement ne connaît pas la nature de
 * l'opération, le comptable la déclare s'il le faut.
 */
describe("sous le seuil, aucune question", () => {
  const AVEC_HONORAIRES = {
    ...BASE,
    taux: [
      ...BASE.taux,
      { code: "HON", taux: "0.10", libelle: "Honoraires", seuil: null, famille: "ir" as const },
    ],
  };
  it("un paiement de 50 sous le seuil de 1 000 n'appelle aucune qualification", () => {
    expect(constaterLaRetenue({ ...AVEC_HONORAIRES, ttc: "50.000", paye: "50.000" })).toEqual({
      cas: "sans_objet",
    });
  });
  it("au seuil exactement, la question est posée (montant égal ou supérieur)", () => {
    expect(constaterLaRetenue({ ...AVEC_HONORAIRES, ttc: "1000.000", paye: "1000.000" })).toEqual({
      cas: "a_confirmer",
    });
  });
  it("sous le seuil, le comptable peut quand même déclarer une retenue sans seuil", () => {
    expect(
      constaterLaRetenue({
        ...AVEC_HONORAIRES,
        ttc: "500.000",
        paye: "450.000",
        qualification: { codes: ["HON"], baseReglee: "500.000", justification: "Certificat H-1" },
      }),
    ).toMatchObject({ cas: "operee", montant: "50.000" });
  });
  it("« sans retenue » n'exige aucun texte", () => {
    expect(
      constaterLaRetenue({
        ...BASE,
        paye: BASE.ttc,
        qualification: { codes: [], baseReglee: BASE.ttc, justification: "" },
      }),
    ).toEqual({ cas: "sans_objet" });
  });
  it("une retenue déclarée exige sa référence", () => {
    expect(() =>
      constaterLaRetenue({ ...BASE, qualification: { ...q, justification: "  " } }),
    ).toThrow(RetenueNonQualifiee);
  });
});

describe("la qualification reçue est relue", () => {
  it("garde ses seuls champs connus", () => {
    expect(lireLaQualification({ ...q, tvaReglee: null })).toEqual({ ...q, tvaReglee: null });
  });
  it("refuse un champ étranger, qui finirait sinon dans l'audit", () => {
    expect(() => lireLaQualification({ ...q, note: "<script>" })).toThrow(RetenueNonQualifiee);
  });
  it("refuse un montant qui n'est pas un texte", () => {
    expect(() => lireLaQualification({ ...q, baseReglee: 2000 })).toThrow(RetenueNonQualifiee);
  });
});
