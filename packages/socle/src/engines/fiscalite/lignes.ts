import { D, toFixedStr, sum } from "../../domain/decimal.ts";
import type { FiscalCharge } from "../../ports/repositories.ts";
import type {
  QualificationFiscale,
  LigneFiscaleCalculee,
} from "../../ports/qualification-fiscale.ts";
import type { ConfigurationFiscale } from "../../ports/fiscalite.ts";

/** Assiettes qualifiées, barèmes datés ; aucun taux réglementaire dans le code. */
export function calculerLignesFiscales(e: {
  qualification: QualificationFiscale;
  codesTva: readonly string[];
  droits: readonly FiscalCharge[];
  profil: ConfigurationFiscale | null;
  prorata: string | null;
  regimeTva: string | null;
  decimales: number;
}): LigneFiscaleCalculee[] {
  const q = e.qualification;
  if (
    new Set(q.lignes.map((l) => l.index)).size !== e.codesTva.length ||
    q.lignes.some((l) => l.index >= e.codesTva.length)
  )
    throw new Error("La qualification doit couvrir chaque ligne fiscale de la lecture courante.");
  const arrondi = (x: string) => toFixedStr(D(x), e.decimales);
  return [...q.lignes]
    .sort((a, b) => a.index - b.index)
    .map((l) => {
      if (!D(l.baseHt).eq(arrondi(l.baseHt)))
        throw new Error("La base qualifiée dépasse la précision de la devise.");
      let deduction = D(0);
      if (q.documentKind === "facture_vente") {
        if (l.deduction !== "deductible")
          throw new Error("Une TVA collectée ne reçoit pas un prorata de déduction.");
        deduction = D(1);
      } else if (l.deduction === "deductible") {
        if (e.regimeTva === null || e.regimeTva === "non_assujetti")
          throw new Error("Le régime du dossier ne permet pas cette déduction de TVA.");
        deduction = D(1);
      } else if (l.deduction === "prorata") {
        if (e.prorata === null || e.regimeTva !== "partiel")
          throw new Error("Un prorata daté et le régime d’assujetti partiel sont nécessaires.");
        const p = D(e.prorata);
        if (!p.isFinite() || p.lt(0) || p.gt(100)) throw new Error("Prorata invalide.");
        deduction = p.div(100);
      }
      const droits = l.droits.map((d) => {
        const def = e.droits.find((r) => r.code === d.code && r.documentKind === q.documentKind);
        if (!def || def.rate == null)
          throw new Error(`Le droit proportionnel « ${d.code} » est absent du barème daté.`);
        const regles =
          e.profil?.regles.filter(
            (r) =>
              r.code === d.code &&
              r.operation === (q.documentKind === "facture_achat" ? "achat" : "vente"),
          ) ?? [];
        if (e.profil && regles.length !== 1)
          throw new Error(`Le traitement de « ${d.code} » doit être unique dans le profil.`);
        const r = regles[0];
        if (
          r &&
          r.applicabilite !== "applicable" &&
          r.applicabilite !== "a_qualifier" &&
          !D(d.assiette).isZero()
        )
          throw new Error(`L’assiette de « ${d.code} » contredit le profil fiscal.`);
        const rate = r?.applicabilite === "applicable" ? D(r.valeur!).div(100) : D(def.rate);
        if (r?.applicabilite === "applicable" && r.mode !== "taux")
          throw new Error("Un droit proportionnel exige un taux.");
        if (
          D(d.assiette).lt(0) ||
          (def.basis === "base_ht" && q.contexte !== "importation" && D(d.assiette).gt(l.baseHt))
        )
          throw new Error(`L’assiette de « ${d.code} » dépasse la base HT qualifiée.`);
        return {
          code: d.code,
          assiette: d.assiette,
          montant: arrondi(D(d.assiette).mul(rate).toString()),
          taxable: r?.dansBaseTva ?? def.taxable ?? false,
          compte: def.accountCode,
          incorporeAuCout: q.documentKind === "facture_achat" && def.incorporeAuCoutAchat === true,
        };
      });
      return {
        index: l.index,
        baseHt: l.baseHt,
        compteCout: l.compteCout,
        tauxDeduction: deduction.toString(),
        droits,
        majorationTva: arrondi(
          sum(droits.filter((d) => d.taxable).map((d) => d.montant)).toString(),
        ),
      };
    });
}
