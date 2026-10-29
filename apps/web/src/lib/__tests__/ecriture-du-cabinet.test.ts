import { describe, expect, it } from "vitest";

import type { Ecriture, PropositionDePiece } from "@malica/socle/ports/repositories";

import { ecritureDeDepart, inchangee, relue } from "@/lib/ecriture-du-cabinet";

const proposition = {
  ok: true,
  verdict: "à comptabiliser",
  verdictCode: null,
  packVersionId: "pack",
  proposition: {
    journal: "ACH",
    libelle: "Achat — FOURNISSEUR",
    pivot: { entry_date: "2026-10-27" },
    lignes: [
      { account_code: "607", libelle: "Achats", debit: "1655.135", credit: "0", tax_code: null },
      { account_code: "4366", libelle: "TVA", debit: "314.475", credit: "0", tax_code: null },
      { account_code: "401", libelle: "Tiers", debit: "0", credit: "1969.610", tax_code: null },
    ],
  },
} as unknown as PropositionDePiece;

describe("l'écriture du cabinet part de ce qui existe", () => {
  it("la prise en charge d'abord, puis la proposition, sinon rien", () => {
    const vivante = {
      journal: "ACH",
      dateEcriture: "2026-10-27",
      libelle: "Achat",
      lines: [
        { ordinal: 1, accountCode: "622", libelle: "x", debit: "1", credit: "0", taxCode: null },
      ],
    } as unknown as Ecriture;
    expect(ecritureDeDepart(vivante, proposition).depart).toBe("inscrite");
    expect(ecritureDeDepart(vivante, proposition).lignes[0]?.account_code).toBe("622");
    const p = ecritureDeDepart(null, proposition);
    expect([p.depart, p.journal, p.date, p.lignes.length]).toEqual([
      "proposee",
      "ACH",
      "2026-10-27",
      3,
    ]);
    const rien = ecritureDeDepart(null, {
      ok: false,
      raison: "Montants incohérents",
    } as PropositionDePiece);
    expect([rien.depart, rien.lignes]).toEqual(["rien", []]);
  });
});

describe("validée telle que proposée, ou forcée", () => {
  const depart = ecritureDeDepart(null, proposition);

  it("des montants récrits autrement ne changent rien : « 1 655,135 » vaut 1655.135", () => {
    const tapee = {
      ...depart,
      lignes: depart.lignes.map((l, i) =>
        i === 0 ? relue({ ...l, debit: "1 655,135", credit: "" }) : l,
      ),
    };
    expect(inchangee(tapee, depart, 3)).toBe(true);
  });

  it("un compte, un montant, le journal ou le libellé changés : forcée", () => {
    const autre = (f: (l: typeof depart) => typeof depart) => inchangee(f(depart), depart, 3);
    expect(
      autre((d) => ({
        ...d,
        lignes: d.lignes.map((l, i) => (i ? l : { ...l, account_code: "622" })),
      })),
    ).toBe(false);
    expect(
      autre((d) => ({
        ...d,
        lignes: d.lignes.map((l, i) => (i ? l : { ...l, debit: "1655.136" })),
      })),
    ).toBe(false);
    expect(autre((d) => ({ ...d, journal: "OD" }))).toBe(false);
    expect(autre((d) => ({ ...d, libelle: "Autre libellé" }))).toBe(false);
    expect(autre((d) => ({ ...d, lignes: d.lignes.slice(1) }))).toBe(false);
  });

  it("un montant illisible n'égale rien", () => {
    const tapee = {
      ...depart,
      lignes: depart.lignes.map((l, i) => (i ? l : relue({ ...l, debit: "1,6,5" }))),
    };
    expect(inchangee(tapee, depart, 3)).toBe(false);
  });
});
