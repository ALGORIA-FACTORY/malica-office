/**
 * Le filtre — traduit une désignation de tokens en extract.v1.
 *
 * Aucune valeur ne provient de la réponse du modèle : chaque champ est relu
 * depuis le plan de tokens. Un TTC absent de la pièce est calculé par les
 * primitives du Socle (jamais par le modèle) et explicitement drapeauté.
 *
 * ====================================================== LES DEUX PASSES
 *
 * Les montants se lisent en deux temps, et l'ordre compte.
 *
 * 1. On relève TOUS les montants de la pièce sous forme de treillis : chaque
 *    token rend les lectures que son texte admet, jamais une seule choisie
 *    d'autorité (« 2.800 » vaut 2,800 ou 2 800 — le papier ne dit pas lequel).
 *
 * 2. On pose les équations de la facture — quantité × prix unitaire, somme des
 *    lignes, HT + TVA = TTC — et on laisse le solveur trancher. Ce qui reste
 *    ambigu après ça est demandé à l'écran, et n'entre pas dans l'écriture.
 *
 * L'inverse — assembler d'abord, corriger ensuite — ne marche pas : une ligne
 * dont un montant est ambigu tombe du filtre, et son équation avec elle. Le
 * solveur doit voir la facture entière avant qu'on en jette la moindre part.
 */

import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import { D, toFixedStr } from "@malica/socle/domain/decimal";

import { enDecimal, resoudreFacture, type Contrainte } from "./montants.ts";
import {
  lireMontantDuPlan,
  resolveFromTokenPlan,
  type FieldCitation,
  type PageToken,
  type ReadFlag,
} from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

export interface BuiltRead {
  contract: string;
  extract: Record<string, unknown>;
  citations: FieldCitation[];
  flags: ReadFlag[];
  valid: boolean;
}

type Ref = { page: number; ordinal: number } | null | undefined;

export function buildExtractFromTokenPlan(params: {
  tokens: readonly PageToken[];
  selection: VisionSelection;
  decimals: number;
}): BuiltRead {
  const { tokens, selection, decimals } = params;
  const citations: FieldCitation[] = [];
  const flags: ReadFlag[] = [];

  /* ------------------------------------ 1. le relevé et ses équations */

  const treillis = new Map<string, { ref: Ref; hypotheses: ReturnType<typeof lireHypotheses> }>();
  function lireHypotheses(field: string, ref: Ref) {
    return lireMontantDuPlan(tokens, field, ref ?? null, decimals).hypotheses;
  }
  const relever = (field: string, ref: Ref): void => {
    treillis.set(field, { ref, hypotheses: lireHypotheses(field, ref) });
  };

  selection.lines.forEach((l, i) => {
    relever(`lines[${i}].base_ht`, l.base_ht);
    relever(`lines[${i}].vat_amount`, l.vat_amount);
    relever(`lines[${i}].ttc`, l.ttc);
  });
  relever("totals.base_ht", selection.totals.base_ht);
  relever("totals.vat", selection.totals.vat);
  relever("totals.ttc", selection.totals.ttc);
  selection.articles.forEach((a, j) => {
    relever(`articles[${j}].quantity`, a.quantity);
    relever(`articles[${j}].unit_price_ht`, a.unit_price_ht);
    relever(`articles[${j}].unit_price_ttc`, a.unit_price_ttc);
    relever(`articles[${j}].total_ht`, a.total_ht);
  });
  selection.other_charges.forEach((c, k) => relever(`other_charges[${k}].amount`, c.amount));

  // Les équations. Aucune ne connaît de taux : un taux vit dans le paramétrage
  // daté (R4), et la TVA n'entre ici que comme un montant lu, additionné.
  const contraintes: Contrainte[] = [
    { type: "somme", total: "totals.ttc", parties: ["totals.base_ht", "totals.vat"] },
  ];
  selection.lines.forEach((_, i) =>
    contraintes.push({
      type: "somme",
      total: `lines[${i}].ttc`,
      parties: [`lines[${i}].base_ht`, `lines[${i}].vat_amount`],
    }),
  );
  if (selection.lines.length > 0) {
    for (const [total, champ] of [
      ["totals.base_ht", "base_ht"],
      ["totals.vat", "vat_amount"],
      ["totals.ttc", "ttc"],
    ] as const) {
      contraintes.push({
        type: "somme",
        total,
        parties: selection.lines.map((_, i) => `lines[${i}].${champ}`),
      });
    }
  }
  selection.articles.forEach((_, j) =>
    contraintes.push({
      type: "produit",
      total: `articles[${j}].total_ht`,
      quantite: `articles[${j}].quantity`,
      unitaire: `articles[${j}].unit_price_ht`,
    }),
  );
  if (selection.articles.length > 0) {
    contraintes.push({
      type: "somme",
      total: "totals.base_ht",
      parties: selection.articles.map((_, j) => `articles[${j}].total_ht`),
    });
  }

  const resolution = resoudreFacture(
    [...treillis.entries()].map(([champ, t]) => ({ champ, hypotheses: t.hypotheses })),
    contraintes,
    { decimales: decimals },
  );

  /* --------------------------------- 2. l'assemblage de l'extrait */

  const take = (
    field: string,
    ref: Ref,
    kind: "date" | "text",
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

  /**
   * Un montant : la lecture quand elle est unique, la décision du solveur
   * quand l'arithmétique a tranché, et sinon rien — avec le drapeau qui dit
   * quelles lectures restaient en lice, pour que l'écran pose la question.
   */
  const montant = (field: string, ref: Ref, zone?: string, uiField?: string): string | null => {
    const m = lireMontantDuPlan(tokens, field, ref ?? null, decimals, zone ?? null, {
      zone: zone ?? null,
      uiField: uiField ?? field,
    });
    if (m.citation) citations.push(m.citation);

    const decide = resolution.valeurs.get(field);
    if (m.hypotheses.length > 1 && decide?.decidePar === "arithmetique") {
      const valeur = enDecimal(decide.millimes, decimals);
      flags.push({
        field,
        code: "DECIDE_PAR_ARITHMETIQUE",
        detail: `${m.flag?.detail ?? ""} — la facture ne boucle qu'avec ${valeur}`,
      });
      return valeur;
    }
    if (m.flag) flags.push(m.flag);
    return m.value;
  };

  /** Cite un token déjà lu sous un second nom de champ, sans le relire. */
  const citerAussi = (field: string, ref: Ref, zone?: string): void => {
    const m = lireMontantDuPlan(tokens, field, ref ?? null, decimals, zone ?? null, {
      zone: zone ?? null,
      uiField: field,
    });
    if (m.citation) citations.push(m.citation);
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
    const base = montant(`lines[${i}].base_ht`, line.base_ht, "totaux", "ligne.base.ht");
    const vat = montant(`lines[${i}].vat_amount`, line.vat_amount, "totaux", "ligne.tva");
    let ttc = montant(`lines[${i}].ttc`, line.ttc, "totaux", "ligne.ttc");
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

  const totalBase = montant("totals.base_ht", selection.totals.base_ht, "totaux", "piece.total.ht");
  const totalVat = montant("totals.vat", selection.totals.vat, "totaux", "piece.total.tva");
  const totalTtc = montant("totals.ttc", selection.totals.ttc, "totaux", "piece.total.ttc");

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
      citerAussi("lines[0].base_ht", selection.totals.base_ht, "totaux");
      citerAussi("lines[0].vat_amount", selection.totals.vat, "totaux");
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
      quantity: montant(`articles[${i}].quantity`, a.quantity, "corps", "article.quantite"),
      unit_price_ht: montant(
        `articles[${i}].unit_price_ht`,
        a.unit_price_ht,
        "corps",
        "article.pu.ht",
      ),
      unit_price_ttc: montant(
        `articles[${i}].unit_price_ttc`,
        a.unit_price_ttc,
        "corps",
        "article.pu.ttc",
      ),
      total_ht: montant(`articles[${i}].total_ht`, a.total_ht, "corps", "article.total.ht"),
      tax_code: a.tax_code ?? null,
    });
  });

  // Droits hors TVA : le montant est lu au plan de tokens, le compte viendra du
  // pack au moment de la proposition d'écriture.
  const otherCharges: Array<Record<string, string>> = [];
  selection.other_charges.forEach((c, i) => {
    const amount = montant(`other_charges[${i}].amount`, c.amount, "totaux", "piece.droit");
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
