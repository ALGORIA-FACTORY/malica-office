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
import { lireLeSens } from "@malica/socle/sens-de-la-piece";
import { D, toFixedStr } from "@malica/socle/domain/decimal";

import { enDecimal, resoudreFacture, type Contrainte } from "./montants.ts";
import {
  lireMontantDuPlan,
  resolveFromTokenPlan,
  type FieldCitation,
  type PageToken,
  type ReadFlag,
  type TokenRef,
} from "./token-plan.ts";
import type { VisionSelection } from "./vision.ts";

export interface BuiltRead {
  contract: string;
  extract: Record<string, unknown>;
  citations: FieldCitation[];
  flags: ReadFlag[];
  valid: boolean;
}

/**
 * Une désignation de token, telle que le modèle la rend.
 *
 * Elle était déclarée `{ page, ordinal }`, sans la fin de plage. Le type
 * mentait sans rien casser : la structure passait, `ordinalEnd` arrivait bien
 * à la relecture, et personne ne pouvait le savoir en lisant ce fichier. Le
 * jour où il a fallu comprendre pourquoi « 2 800,000 » se lisait « 2,000 »,
 * ce type a fait partie des raisons de chercher ailleurs.
 */
type Ref = TokenRef | null | undefined;

export function buildExtractFromTokenPlan(params: {
  tokens: readonly PageToken[];
  selection: VisionSelection;
  decimals: number;
  /*
   * Le matricule de la fiche du dossier. OBLIGATOIRE, et null quand la fiche
   * n'en porte pas — jamais absent du paramètre.
   *
   * C'est lui qui permet de DÉDUIRE le sens de la pièce au lieu de le croire :
   * le dossier connaît son propre matricule, donc sa position sur le document
   * dit si la pièce est un achat ou une vente. Le rendre facultatif aurait
   * permis à un appelant de perdre cette garantie sans s'en apercevoir.
   */
  matriculeDossier: string | null;
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
  //
  // Les DROITS HORS TVA en font partie, et c'est une correction du 5 octobre
  // 2026 : l'équation était « TTC = HT + TVA », sans eux. Sur la facture de
  // loyer du 4 octobre — 3 020,000 + 573,800 + 1,000 de timbre = 3 594,800 —
  // elle tombait à 3 593,800. Presque toute facture tunisienne porte un droit
  // de timbre, donc presque toute facture tunisienne violait cette contrainte.
  const droits = selection.other_charges.map((_, k) => `other_charges[${k}].amount`);
  const contraintes: Contrainte[] = [
    { type: "somme", total: "totals.ttc", parties: ["totals.base_ht", "totals.vat", ...droits] },
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
        parties: [
          ...selection.lines.map((_, i) => `lines[${i}].${champ}`),
          // Même raison que ci-dessus : le TTC du pied porte les droits hors
          // TVA, que les lignes par taux, elles, ne portent pas.
          ...(champ === "ttc" ? droits : []),
        ],
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

  /*
   * Le sens de la pièce, déduit des matricules relus au plan.
   *
   * Placé ICI et pas plus haut : il a besoin des références, qui viennent
   * d'être relues. Et placé dans le filtre et non dans les contrôles, parce
   * qu'un contrôle en aval ne fait que signaler — il ne rend pas le sens juste,
   * et c'est `document_kind` qui décide du journal dans lequel la pièce part.
   */
  const sens = lireLeSens({
    matriculeDossier: params.matriculeDossier,
    matriculeEmetteur: references["matricule_fiscal"] ?? null,
    matriculeClient: references["matricule_fiscal_client"] ?? null,
    sensDuModele: selection.document_kind,
  });
  if (sens.signalement) {
    flags.push({
      field: "document_kind",
      code: "SENS_A_CONFIRMER",
      detail: sens.signalement,
    });
  }

  const candidate = {
    contract: "extract.v1",
    // Illisible, un champ reste VIDE : jamais « » ni « 0 », qui passaient la
    // validation du contrat et pouvaient finir dans une écriture (3B, 18 sept.).
    issuer: issuer ?? null,
    document_date: documentDate ?? null,
    currency: selection.currency.toUpperCase(),
    lines,
    articles,
    other_charges: otherCharges,
    totals: {
      base_ht: totalBase ?? null,
      vat: totalVat ?? null,
      ttc: totalTtc ?? null,
    },
    references,
    // La confiance globale du désignateur, sous une clé stable : c'est
    // elle qui groupe les propositions du cabinet par confiance.
    field_confidence: { overall: selection.overall_confidence },
    /*
     * LE SENS EST DÉDUIT, PAS CRU.
     *
     * Le dossier connaît son matricule : la position de celui-ci sur la pièce
     * dit si elle est un achat ou une vente, sans appeler personne. Le modèle
     * n'est consulté que là où aucun matricule n'est lisible, et confronté
     * partout ailleurs.
     *
     * Quand la déduction refuse de trancher — matricule du dossier des deux
     * côtés, d'aucun des deux, ou incomplet — `document_kind` reste null. Le
     * contrat l'exige non nul, donc la lecture se dit PARTIELLE et l'écran pose
     * la question. C'est exactement ce qu'on veut : pas de choix silencieux sur
     * le sens d'une pièce.
     */
    document_kind: sens.sens,
  };

  /*
   * Les équations qui ne tiennent pas, dites une fois chacune.
   *
   * Posé le 5 octobre 2026. Jusque-là le solveur évaluait ses contraintes pour
   * CHOISIR entre des lectures, et ne disait jamais rien quand il n'avait rien
   * à choisir : une facture dont tous les montants sont nets mais faux passait
   * en silence. C'est ce qui est arrivé au loyer du 4 octobre.
   *
   * Le détail porte les deux nombres, délibérément : « la facture ne tient
   * pas » n'apprend rien à qui doit la corriger, alors que l'écart entre ce
   * que l'équation donne et ce que la pièce imprime désigne le montant à
   * relire. Ici, 576,800 contre 3,000 — l'ordre de grandeur suffit à voir
   * qu'un montant a été amputé.
   */
  for (const v of resolution.violations) {
    flags.push({
      field: v.champ,
      code: "ARITHMETIQUE_INCOHERENTE",
      detail:
        `${v.parties.join(" + ")} donne ${enDecimal(v.calcule, decimals)}, ` +
        `la pièce porte ${enDecimal(v.lu, decimals)}`,
    });
  }

  const parsed = ExtractV1.safeParse(candidate);
  return {
    contract: parsed.success ? "extract.v1" : "extract.v1.partiel",
    extract: candidate,
    citations,
    flags,
    valid: parsed.success,
  };
}
