import { describe, expect, it } from "vitest";
import { ConfigurationFiscaleSchema, RegleFiscaleSchema } from "../ports/fiscalite.ts";

const regle = {
  famille: "tva",
  operation: "vente",
  typeOperation: "Prestation de test",
  code: "ESSAI",
  applicabilite: "applicable",
  mode: "taux",
  valeur: "8.375",
  assiette: "Base du scénario",
  dansBaseTva: null,
  deductibilite: "a_qualifier",
  referenceLegale: "Référence du scénario, sans portée réglementaire",
  conditions: "",
  justificatif: "",
};

describe("le paramétrage fiscal ne comble pas les inconnues", () => {
  it("conserve exactement les décimales déclarées", () => {
    expect(RegleFiscaleSchema.parse(regle).valeur).toBe("8.375");
  });
  it("exige une source et une assiette pour un prélèvement proportionnel", () => {
    expect(RegleFiscaleSchema.safeParse({ ...regle, referenceLegale: "" }).success).toBe(false);
    expect(RegleFiscaleSchema.safeParse({ ...regle, assiette: "" }).success).toBe(false);
  });
  it("une exonération ou suspension exige sa preuve et ne porte pas un taux résiduel", () => {
    for (const applicabilite of ["exonere", "suspendu"]) {
      const r = { ...regle, applicabilite, mode: "aucun", valeur: null };
      expect(RegleFiscaleSchema.safeParse(r).success).toBe(false);
      expect(
        RegleFiscaleSchema.safeParse({ ...r, justificatif: "Attestation du scénario" }).success,
      ).toBe(true);
      expect(
        RegleFiscaleSchema.safeParse({ ...r, justificatif: "Attestation", valeur: "8.375" })
          .success,
      ).toBe(false);
    }
  });
  it("une inconnue reste sans prélèvement inventé", () => {
    expect(
      RegleFiscaleSchema.safeParse({
        ...regle,
        applicabilite: "a_qualifier",
        referenceLegale: "",
        mode: "aucun",
        valeur: null,
      }).success,
    ).toBe(true);
    expect(RegleFiscaleSchema.safeParse({ ...regle, applicabilite: "a_qualifier" }).success).toBe(
      false,
    );
  });
  it("refuse les valeurs négatives, infinies et les règles en double", () => {
    for (const valeur of ["-2", "Infinity", "NaN", "1e2", "101"])
      expect(RegleFiscaleSchema.safeParse({ ...regle, valeur }).success).toBe(false);
    expect(
      ConfigurationFiscaleSchema.safeParse({
        activite: "Essai",
        regimeImposition: null,
        regimeTva: null,
        prorataTva: null,
        regles: [regle, regle],
      }).success,
    ).toBe(false);
  });
});
