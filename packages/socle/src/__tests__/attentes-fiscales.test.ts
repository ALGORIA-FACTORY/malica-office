import { describe, expect, it } from "vitest";
import {
  appliquerAttentesFiscales,
  attentesDeRetenue,
  retenueDuProfilAQualifier,
} from "../engines/fiscalite/profil.ts";
import type { ConfigurationFiscale, RegleFiscale } from "../ports/fiscalite.ts";

const r: RegleFiscale = {
  famille: "tva",
  operation: "vente",
  typeOperation: "Scénario",
  code: "TEST",
  applicabilite: "applicable",
  mode: "taux",
  valeur: "8.375",
  assiette: "Base du scénario",
  dansBaseTva: null,
  deductibilite: "oui",
  referenceLegale: "Source du scénario de test",
  conditions: "",
  justificatif: "",
};
const c: ConfigurationFiscale = {
  activite: "Scénario",
  regimeImposition: null,
  regimeTva: "assujetti",
  prorataTva: null,
  regles: [r],
};
const entree = {
  configuration: c,
  dateEffet: "2026-10-25",
  operation: "vente" as const,
  codesTva: ["TEST"],
  droits: [],
  taxRates: [
    {
      code: "TEST",
      label: "Scénario",
      rate: "0.01",
      validFrom: "2020-01-01",
      validTo: null,
      jurisdiction: "ESSAI",
    },
  ],
  fiscalCharges: [],
};

describe("le profil fiscal contrôle les attentes sans inventer la pièce", () => {
  it("utilise exactement le taux de la version du dossier", () => {
    const a = appliquerAttentesFiscales(entree);
    expect(a.taxRates[0]!.rate).toBe("0.08375");
    expect(a.taxRates[0]!.validFrom).toBe("2026-10-25");
    expect(entree.taxRates[0]!.rate).toBe("0.01");
  });
  it("une ambiguïté de type d'opération ou une inconnue empêche l'automatisme", () => {
    expect(() =>
      appliquerAttentesFiscales({
        ...entree,
        configuration: {
          ...c,
          regles: [{ ...r, applicabilite: "a_qualifier", mode: "aucun", valeur: null }],
        },
      }),
    ).toThrow(/qualifier/);
    expect(() =>
      appliquerAttentesFiscales({
        ...entree,
        configuration: { ...c, regles: [r, { ...r, typeOperation: "Autre" }] },
      }),
    ).toThrow(/type d’opération/);
  });
  it("ne traite pas une taxe proportionnelle taxable en TVA comme une simple charge", () => {
    const f: RegleFiscale = { ...r, famille: "fodec", code: "F_TEST", dansBaseTva: true };
    expect(() =>
      appliquerAttentesFiscales({
        ...entree,
        configuration: { ...c, regles: [r, f] },
        droits: [{ code: "F_TEST", amount: "5.00" }],
      }),
    ).toThrow(/par ligne/);
  });
  it("une qualification de TVA ne valide pas une autre obligation inconnue", () => {
    expect(() =>
      appliquerAttentesFiscales({
        ...entree,
        qualification: [],
        configuration: {
          ...c,
          regles: [
            r,
            {
              ...r,
              famille: "autre",
              code: "AUTRE",
              applicabilite: "a_qualifier",
              mode: "aucun",
              valeur: null,
            },
          ],
        },
      }),
    ).toThrow(/qualifier/);
  });
  it("un prorata d'achat ne réduit jamais la TVA collectée sur les ventes", () => {
    expect(
      appliquerAttentesFiscales({
        ...entree,
        configuration: { ...c, regimeTva: "partiel", prorataTva: 60 },
      }).taxRates[0]!.rate,
    ).toBe("0.08375");
  });
  it("le timbre attendu ne devient jamais un montant ajouté à la pièce", () => {
    const timbre: RegleFiscale = {
      ...r,
      famille: "timbre",
      code: "T_TEST",
      mode: "montant",
      valeur: "2.375",
    };
    const e = {
      ...entree,
      configuration: { ...c, regles: [r, timbre] },
      fiscalCharges: [
        {
          code: "T_TEST",
          label: "Test",
          documentKind: "facture_vente" as const,
          accountCode: "TEST",
          fixedAmount: "1",
          legalReference: "Source test",
        },
      ],
    };
    expect(() => appliquerAttentesFiscales(e)).toThrow(/n’a pas été identifié/);
    expect(
      appliquerAttentesFiscales({ ...e, droits: [{ code: "T_TEST", amount: "2.375" }] })
        .fiscalCharges[0]!.fixedAmount,
    ).toBe("2.375");
  });
  it("ne déduit pas la TVA d'un non-assujetti et refuse une ventilation partielle non qualifiée", () => {
    expect(() =>
      appliquerAttentesFiscales({
        ...entree,
        operation: "achat",
        configuration: { ...c, regimeTva: "non_assujetti", regles: [{ ...r, operation: "achat" }] },
      }),
    ).toThrow(/non-assujetti/);
    expect(() =>
      appliquerAttentesFiscales({
        ...entree,
        operation: "achat",
        configuration: { ...c, regles: [{ ...r, operation: "achat", deductibilite: "partielle" }] },
      }),
    ).toThrow(/par ligne/);
  });
  it("applique le taux de retenue daté mais conserve l'assiette et le seuil gouvernés", () => {
    const cfg: ConfigurationFiscale = {
      ...c,
      regles: [{ ...r, famille: "retenue", operation: "paiement_emis" }],
    };
    const taux = attentesDeRetenue(
      cfg,
      "paiement_emis",
      [{ code: "TEST", taux: "0.01", seuil: "123.456", base: "ttc" }],
      ["TEST"],
    );
    expect(taux[0]).toEqual({ code: "TEST", taux: "0.08375", seuil: "123.456", base: "ttc" });
    expect(() => attentesDeRetenue(cfg, "paiement_emis", taux, ["AUTRE"])).toThrow(
      /pas applicable/,
    );
  });
  it("un nouveau seuil de retenue est versionné avec le taux", () => {
    const cfg: ConfigurationFiscale = {
      ...c,
      regles: [{ ...r, famille: "retenue", operation: "paiement_emis", seuil: "234.567" }],
    };
    const a = attentesDeRetenue(
      cfg,
      "paiement_emis",
      [{ code: "TEST", taux: "0.01", seuil: "123.456" }],
      ["TEST"],
    );
    expect(a[0]!.seuil).toBe("234.567");
  });
  it("le profil ne pose aucune question sous le seuil, mais qualifie la borne et les cas sans seuil", () => {
    expect(retenueDuProfilAQualifier([{ seuil: "234.567" }], "234.566")).toBe(false);
    expect(retenueDuProfilAQualifier([{ seuil: "234.567" }], "234.567")).toBe(true);
    expect(retenueDuProfilAQualifier([{ seuil: null }], "1.000")).toBe(true);
    expect(retenueDuProfilAQualifier([], "9999.000")).toBe(false);
    const a = attentesDeRetenue(
      { ...c, regles: [{ ...r, famille: "retenue", operation: "paiement_emis" }] },
      "paiement_emis",
      [{ code: "TEST", taux: "0.01", libelle: "Ancien taux" }],
      ["TEST"],
    );
    expect(a[0]!.libelle).toContain("8.375 %");
  });
});
