import { D } from "../../domain/decimal.ts";
import type { ConfigurationFiscale, RegleFiscale } from "../../ports/fiscalite.ts";
import type { TaxRate, FiscalCharge } from "../../ports/repositories.ts";

/** Un profil fournit des attentes, jamais des montants absents de la pièce. */
export function appliquerAttentesFiscales(e: {
  configuration: ConfigurationFiscale;
  dateEffet: string;
  operation: "achat" | "vente";
  codesTva: string[];
  droits: Array<{ code: string; amount: string }>;
  taxRates: readonly TaxRate[];
  fiscalCharges: readonly FiscalCharge[];
}): { taxRates: TaxRate[]; fiscalCharges: FiscalCharge[]; tvaNonDeductible: boolean } {
  const c = e.configuration;
  const regles = c.regles.filter((r) => r.operation === e.operation);
  if (!regles.length) throw new Error("Le profil fiscal ne qualifie pas ce sens d’opération.");
  if (regles.some((r) => r.applicabilite === "a_qualifier"))
    throw new Error("Des règles fiscales de ce dossier restent à qualifier dans les paramètres.");
  const unique = (rs: RegleFiscale[], code: string) => {
    if (rs.length !== 1)
      throw new Error(`Le traitement de « ${code} » doit être précisé pour ce type d’opération.`);
    return rs[0]!;
  };
  let taux = [...e.taxRates];
  const deductibilites = new Set<string>();
  for (const code of new Set(e.codesTva)) {
    const r = unique(
      regles.filter((r) => r.famille === "tva" && r.code === code),
      code,
    );
    if (r.applicabilite === "applicable" && (r.mode !== "taux" || r.valeur === null))
      throw new Error("Le taux de TVA attendu n’est pas défini.");
    const origine = taux
      .filter((t) => t.code === code)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    if (!origine)
      throw new Error(
        `Le code TVA « ${code} » doit être ajouté au référentiel avec son imputation avant utilisation.`,
      );
    const rate =
      r.applicabilite === "applicable" ? D(r.valeur!).div(100).toString() : D(0).toString();
    taux = [
      ...taux.filter((t) => t.code !== code),
      { ...origine, rate, validFrom: e.dateEffet, validTo: null },
    ];
    if (e.operation === "achat" && D(rate).gt(0)) deductibilites.add(r.deductibilite);
  }
  if (
    deductibilites.has("a_qualifier") ||
    deductibilites.has("partielle") ||
    deductibilites.size > 1 ||
    c.prorataTva !== null
  ) {
    throw new Error(
      "La déduction partielle ou mixte de TVA exige une qualification par ligne avant proposition automatique.",
    );
  }
  if (c.regimeTva === null) throw new Error("Le régime TVA du dossier reste à qualifier.");
  if (c.regimeTva === "non_assujetti" && deductibilites.has("oui"))
    throw new Error("Le profil d’un non-assujetti ne peut pas prévoir de TVA déductible.");
  const droits = e.fiscalCharges.map((d) => ({ ...d }));
  for (const droit of e.droits) {
    const r = unique(
      regles.filter((r) => r.famille !== "tva" && r.code === droit.code),
      droit.code,
    );
    if (r.applicabilite !== "applicable" && !D(droit.amount).isZero())
      throw new Error(`Le droit « ${droit.code} » contredit le profil fiscal du dossier.`);
    if (r.applicabilite === "applicable" && r.mode === "taux")
      throw new Error(
        `L’assiette du droit proportionnel « ${droit.code} » doit être qualifiée par ligne avant proposition automatique.`,
      );
    if (r.dansBaseTva && !D(droit.amount).isZero())
      throw new Error(
        `L’intégration de « ${droit.code} » à l’assiette TVA nécessite un contrôle par ligne.`,
      );
    const d = droits.find(
      (d) =>
        d.code === droit.code &&
        d.documentKind === (e.operation === "achat" ? "facture_achat" : "facture_vente"),
    );
    if (!d)
      throw new Error(`Le droit « ${droit.code} » ne dispose pas d’imputation au référentiel.`);
    d.fixedAmount = r.applicabilite === "applicable" ? r.valeur : D(0).toString();
  }
  for (const r of regles.filter((r) => r.famille !== "tva" && r.applicabilite === "applicable")) {
    if (!e.droits.some((d) => d.code === r.code))
      throw new Error(
        `Le droit attendu « ${r.code} » n’a pas été identifié sur la pièce ; vérifiez son applicabilité.`,
      );
  }
  return {
    taxRates: taux,
    fiscalCharges: droits,
    tvaNonDeductible: c.regimeTva === "non_assujetti" || deductibilites.has("non"),
  };
}

/** Le certificat, la base et le seuil restent qualifiés au règlement. */
export function attentesDeRetenue<T extends { code: string; taux: string; seuil?: string | null }>(
  c: ConfigurationFiscale,
  operation: "paiement_emis" | "paiement_recu",
  taux: readonly T[],
  codesDeclares: readonly string[] | undefined,
): T[] {
  const rs = c.regles.filter((r) => r.famille === "retenue" && r.operation === operation);
  if (!rs.length || rs.some((r) => r.applicabilite === "a_qualifier"))
    throw new Error(
      "Les retenues de ce sens de règlement restent à qualifier dans le profil fiscal.",
    );
  const applicables = rs.filter((r) => r.applicabilite === "applicable");
  for (const code of codesDeclares ?? []) {
    if (!applicables.some((r) => r.code === code))
      throw new Error(
        `La retenue « ${code} » n’est pas applicable selon le profil fiscal ; qualifiez l’exception dans les paramètres du client.`,
      );
  }
  return applicables.map((r) => {
    if (
      applicables.filter((x) => x.code === r.code).length !== 1 ||
      r.mode !== "taux" ||
      r.valeur === null
    )
      throw new Error(`Le taux de retenue « ${r.code} » est ambigu ou incomplet.`);
    const origine = taux.find((t) => t.code === r.code);
    if (!origine)
      throw new Error(
        `La retenue « ${r.code} » doit disposer d’une assiette et d’un seuil au référentiel avant utilisation.`,
      );
    return {
      ...origine,
      ...(r.seuil !== undefined ? { seuil: r.seuil } : {}),
      taux: D(r.valeur).div(100).toString(),
    };
  });
}
