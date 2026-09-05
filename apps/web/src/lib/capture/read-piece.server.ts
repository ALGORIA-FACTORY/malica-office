/**
 * Le filtre — traduit une désignation de tokens en extract.v1.
 *
 * Aucune valeur ne provient de la réponse du modèle : chaque champ est relu
 * depuis le plan de tokens. Un TTC absent de la pièce est calculé par les
 * primitives du Socle (jamais par le modèle) et explicitement drapeauté.
 */

import { ExtractV1 } from "@/verticals/regalica-office/socle/contracts/extract.v1";
import { D, toFixedStr } from "@/verticals/regalica-office/socle/domain/decimal";

import {
  resolveFromTokenPlan,
  type FieldCitation,
  type PageToken,
  type ReadFlag,
} from "./token-plan";
import type { VisionSelection } from "./vision.server";

export interface BuiltRead {
  contract: string;
  extract: Record<string, unknown>;
  citations: FieldCitation[];
  flags: ReadFlag[];
  valid: boolean;
}

export function buildExtractFromTokenPlan(params: {
  tokens: readonly PageToken[];
  selection: VisionSelection;
  decimals: number;
}): BuiltRead {
  const { tokens, selection, decimals } = params;
  const citations: FieldCitation[] = [];
  const flags: ReadFlag[] = [];

  const take = (
    field: string,
    ref: { page: number; ordinal: number } | null | undefined,
    kind: "amount" | "date" | "text",
    zone?: string,
    uiField?: string,
  ): string | null => {
    const r = resolveFromTokenPlan(tokens, field, ref ?? null, kind, zone ?? null, {
      zone: zone ?? null,
      // Le champ confié à l'UI est nommé explicitement : la relecture d'audit
      // sait quel libellé d'écran portait ce token surligné.
      uiField: uiField ?? field,
    });
    if (r.citation) citations.push(r.citation);
    if (r.flag) flags.push(r.flag);
    return r.value;
  };

  const issuer = take("issuer", selection.issuer, "text", "entete", "piece.emetteur");
  const documentDate = take(
    "document_date",
    selection.document_date,
    "date",
    "entete",
    "piece.date",
  );

  const lines: Array<Record<string, string>> = [];
  selection.lines.forEach((line, i) => {
    const base = take(`lines[${i}].base_ht`, line.base_ht, "amount", "totaux", "ligne.base.ht");
    const vat = take(`lines[${i}].vat_amount`, line.vat_amount, "amount", "totaux", "ligne.tva");
    let ttc = take(`lines[${i}].ttc`, line.ttc, "amount", "totaux", "ligne.ttc");
    if (ttc === null && base !== null && vat !== null) {
      ttc = toFixedStr(D(base).plus(vat), decimals);
      flags.push({
        field: `lines[${i}].ttc`,
        code: "DERIVED_BY_SOCLE",
        detail: "TTC = base HT + TVA (primitives du Socle)",
      });
    }
    if (base === null || vat === null || ttc === null) return;
    lines.push({
      label: line.label,
      tax_code: line.tax_code,
      base_ht: base,
      vat_amount: vat,
      ttc,
    });
  });

  const totalBase = take(
    "totals.base_ht",
    selection.totals.base_ht,
    "amount",
    "totaux",
    "piece.total.ht",
  );
  const totalVat = take("totals.vat", selection.totals.vat, "amount", "totaux", "piece.total.tva");
  const totalTtc = take("totals.ttc", selection.totals.ttc, "amount", "totaux", "piece.total.ttc");

  // Beaucoup de factures ne ventilent la TVA qu'au pied : aucune ligne ne survit
  // alors au filtre. On reconstitue une ligne unique à partir des totaux —
  // valeurs relues dans le plan de tokens, arithmétique confiée au Socle.
  if (lines.length === 0 && totalBase !== null) {
    const taxCode = selection.lines[0]?.tax_code ?? null;
    let vat = totalVat;
    if (vat === null && totalTtc !== null) {
      vat = toFixedStr(D(totalTtc).minus(D(totalBase)), decimals);
      flags.push({
        field: "lines[0].vat_amount",
        code: "DERIVED_BY_SOCLE",
        detail: "TVA = TTC − base HT (primitives du Socle)",
      });
    }
    // Le TTC de la ligne est HT + TVA, jamais le TTC imprimé : celui-ci peut
    // contenir un droit hors TVA. L'écart éventuel est traité par le Socle au
    // moment de l'écriture (résidu attribué au pack ou blocage).
    const ttc = vat !== null ? toFixedStr(D(totalBase).plus(D(vat)), decimals) : null;

    if (taxCode && vat !== null && ttc !== null) {
      lines.push({
        label: selection.lines[0]?.label ?? "Ligne",
        tax_code: taxCode,
        base_ht: totalBase,
        vat_amount: vat,
        ttc,
      });
      take("lines[0].base_ht", selection.totals.base_ht, "amount", "totaux");
      take("lines[0].vat_amount", selection.totals.vat, "amount", "totaux");
      flags.push({
        field: "lines[0].ttc",
        code: "DERIVED_BY_SOCLE",
        detail: "TTC de ligne = base HT + TVA (le TTC imprimé peut porter un droit hors TVA)",
      });

      flags.push({
        field: "lines[0]",
        code: "DERIVED_BY_SOCLE",
        detail: "ligne unique reconstituée depuis les totaux du pied de facture",
      });
    }
  }

  // Articles : la désignation et les quantités servent l'analyse. Aucun de ces
  // champs n'entre dans l'équilibre ; tous restent adossés à un token cité.
  const articles: Array<Record<string, string | null>> = [];
  selection.articles.forEach((a, i) => {
    const designation = take(
      `articles[${i}].designation`,
      a.designation,
      "text",
      "corps",
      "article.designation",
    );
    if (!designation) return;
    articles.push({
      designation,
      quantity: take(`articles[${i}].quantity`, a.quantity, "amount", "corps", "article.quantite"),
      unit_price_ht: take(
        `articles[${i}].unit_price_ht`,
        a.unit_price_ht,
        "amount",
        "corps",
        "article.pu.ht",
      ),
      unit_price_ttc: take(
        `articles[${i}].unit_price_ttc`,
        a.unit_price_ttc,
        "amount",
        "corps",
        "article.pu.ttc",
      ),
      total_ht: take(`articles[${i}].total_ht`, a.total_ht, "amount", "corps", "article.total.ht"),
      tax_code: a.tax_code ?? null,
    });
  });

  // Droits hors TVA : le montant est lu au plan de tokens, le compte viendra du
  // pack au moment de la proposition d'écriture.
  const otherCharges: Array<Record<string, string>> = [];
  selection.other_charges.forEach((c, i) => {
    const amount = take(`other_charges[${i}].amount`, c.amount, "amount", "totaux", "piece.droit");
    if (amount === null) return;
    otherCharges.push({ code: c.code, label: "", amount });
  });

  const references: Record<string, string> = {};
  for (const [key, ref] of Object.entries(selection.references)) {
    const v = take(`references.${key}`, ref, "text", "entete", `piece.reference.${key}`);
    if (v !== null) references[key] = v;
  }

  const candidate = {
    contract: "extract.v1",
    issuer: issuer ?? "",
    document_date: documentDate ?? "",
    currency: selection.currency.toUpperCase(),
    lines,
    articles,
    other_charges: otherCharges,
    totals: {
      base_ht: totalBase ?? "0",
      vat: totalVat ?? "0",
      ttc: totalTtc ?? "0",
    },
    references,
    // La confiance globale du désignateur, sous une clé stable : c'est
    // elle qui groupe les propositions du cabinet par confiance.
    field_confidence: { overall: selection.overall_confidence },
    document_kind: selection.document_kind,
  };

  const parsed = ExtractV1.safeParse(candidate);
  return {
    contract: parsed.success ? "extract.v1" : "extract.v1.partiel",
    extract: candidate,
    citations,
    flags,
    valid: parsed.success,
  };
}
