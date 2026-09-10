import type { FieldCitation, PageToken, ReadFlag, TokenRef } from "@malica/socle/ports/malica";

import { enDecimal, treillisMontant, type Hypothese } from "./montants.ts";
/**
 * Plan de tokens — R2 « zéro hallucination dès la lecture ».
 *
 * Le plan de tokens est la seule vérité de ce qui est écrit sur la pièce.
 * Le modèle de vision ne transcrit jamais un montant : il désigne un token
 * (page + ordinal) déjà présent dans ce plan. Toute valeur émise est ensuite
 * relue depuis le texte du token — jamais depuis la réponse du modèle.
 *
 * Module pur : aucun réseau, aucune base, aucun framework.
 */

export interface CitationBinding {
  zone?: string | null;
  uiField?: string | null;
}

/** Retrouve un token dans le plan. */
function findToken(tokens: readonly PageToken[], ref: TokenRef): PageToken | null {
  return tokens.find((t) => t.page === ref.page && t.ordinal === ref.ordinal) ?? null;
}

/**
/**
 * ================================== CE QUI A ÉTÉ RETIRÉ D'ICI, ET POURQUOI
 *
 * Ce module portait `normalizeAmount`, qui rendait UNE valeur par token. Pour
 * y arriver, il tranchait ce que le papier ne tranche pas : « 2.800 » y était
 * lu 2 800 dinars, par une règle fixe. Sur un ticket, c'est 2,800 dinar — et
 * l'erreur ne se voyait pas, puisque le résultat avait la forme d'un montant.
 *
 * La lecture d'un montant vit désormais dans `montants.ts` : elle rend TOUTES
 * les lectures admissibles, et c'est l'arithmétique de la facture qui choisit
 * (`lireMontantDuPlan`, plus bas). Ce qu'elle ne choisit pas est demandé à
 * l'écran plutôt que deviné.

/**
 * Une date existe-t-elle vraiment ?
 *
 * ============================================== POURQUOI CE CONTRÔLE EXISTE
 *
 * La version précédente assemblait les trois nombres sans les vérifier. Un
 * token mal découpé — « 45/13/2026 », ou une date américaine « 12/25/2026 »
 * lue comme jour/mois — produisait « 2026-13-45 » : une chaîne parfaitement
 * conforme au format ISO, donc acceptée par le contrat, et pourtant impossible.
 *
 * Sur un produit fiscal, ce n'est pas un détail de présentation : la date
 * décide de la PÉRIODE DE TVA et du taux applicable. Une date fausse qui passe
 * les contrôles est pire qu'une date absente, qui elle se voit.
 */
function dateReelle(y: string, m: string, d: string): boolean {
  const annee = Number(y);
  const mois = Number(m);
  const jour = Number(d);
  if (mois < 1 || mois > 12 || jour < 1) return false;
  // Le mois 0 du mois suivant : le dernier jour du mois demandé.
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return jour <= dernier;
}

export function normalizeDate(text: string): string | null {
  const s = text.trim();
  const rendre = (y: string, m: string, d: string): string | null =>
    dateReelle(y, m, d) ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;

  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return rendre(iso[1]!, iso[2]!, iso[3]!);

  const dmy = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const yRaw = dmy[3]!;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    // Jour/mois : la convention tunisienne et française. On ne bascule PAS sur
    // mois/jour quand le premier nombre dépasse 12 — ce serait deviner la
    // provenance du document, et une écriture datée au jugé est une écriture
    // fausse. Une date qui n'existe pas est rendue absente, et demandée.
    return rendre(y, dmy[2]!, dmy[1]!);
  }
  return null;
}

/** La citation d'un token : ce que l'écran surligne, et à quel titre. */
function citer(
  token: PageToken,
  field: string,
  role: "montant" | "date" | "texte",
  zone?: string | null,
  binding?: CitationBinding,
): FieldCitation {
  return {
    field,
    page: token.page,
    ordinal: token.ordinal,
    zone: binding?.zone ?? zone ?? null,
    ui_field: binding?.uiField ?? field,
    ui_role: role,
    bbox: { x0: token.x0, y0: token.y0, x1: token.x1, y1: token.y1 },
  };
}

export interface ResolvedValue {
  /** Valeur relue depuis le token, jamais depuis le modèle. */
  value: string | null;
  citation: FieldCitation | null;
  flag: ReadFlag | null;
}

/**
 * Le texte d'une plage de jetons, ou celui du jeton seul.
 *
 * Le modèle désigne parfois une VALEUR qui s'étale sur plusieurs jetons : un
 * montant coupé par l'espace des milliers, un libellé en plusieurs mots. La
 * plage est celle qu'il a lui-même donnée — on ne l'étend jamais.
 */
function texteDeLaPlage(tokens: readonly PageToken[], ref: TokenRef, token: PageToken): string {
  if (typeof ref.ordinalEnd !== "number" || ref.ordinalEnd <= ref.ordinal) return token.text;
  const plage = tokens
    .filter((t) => t.page === ref.page && t.ordinal >= ref.ordinal && t.ordinal <= ref.ordinalEnd!)
    .sort((a, b) => a.ordinal - b.ordinal);
  return plage.length > 1 ? plage.map((t) => t.text).join(" ") : token.text;
}

/**
 * Filtre du plan de tokens : traduit une désignation de token en valeur.
 * `kind` décide de la relecture : montant, date ou texte brut.
 */
export function resolveFromTokenPlan(
  tokens: readonly PageToken[],
  field: string,
  ref: TokenRef | null | undefined,
  kind: "date" | "text",
  zone?: string | null,
  binding?: CitationBinding,
): ResolvedValue {
  if (!ref) {
    return { value: null, citation: null, flag: { field, code: "MISSING_CITATION" } };
  }
  const token = findToken(tokens, ref);
  if (!token) {
    return {
      value: null,
      citation: null,
      flag: {
        field,
        code: "TOKEN_NOT_FOUND",
        detail: `page ${ref.page} · token ${ref.ordinal}`,
      },
    };
  }
  const citation = citer(token, field, kind === "date" ? "date" : "texte", zone, binding);
  if (kind === "date") {
    const value = normalizeDate(token.text);
    return value === null
      ? {
          value: null,
          citation,
          flag: { field, code: "DATE_UNREADABLE", detail: token.text },
        }
      : { value, citation, flag: null };
  }
  return { value: texteDeLaPlage(tokens, ref, token), citation, flag: null };
}

/** Un montant lu au plan : sa valeur si elle est certaine, et toutes ses lectures. */
export interface MontantLu extends ResolvedValue {
  hypotheses: Hypothese[];
}

/**
 * Lit un montant au plan de tokens, sans jamais trancher à la place du papier.
 *
 * Trois sorties, et c'est tout le dispositif :
 *
 *   une seule lecture admissible  → la valeur, sans drapeau ;
 *   plusieurs lectures            → aucune valeur, drapeau « SEPARATEUR_AMBIGU »
 *                                   qui porte les deux lectures, pour que
 *                                   l'écran pose la question ;
 *   aucune lecture                → aucune valeur, drapeau « pas un nombre ».
 *
 * La deuxième sortie est celle qui manquait. Le solveur (`read-piece.ts`) la
 * reprend ensuite : quand l'arithmétique de la facture ne laisse qu'une
 * lecture debout, le drapeau devient « DECIDE_PAR_ARITHMETIQUE ».
 */
export function lireMontantDuPlan(
  tokens: readonly PageToken[],
  field: string,
  ref: TokenRef | null | undefined,
  decimales: number,
  zone?: string | null,
  binding?: CitationBinding,
): MontantLu {
  if (!ref) {
    return {
      value: null,
      citation: null,
      flag: { field, code: "MISSING_CITATION" },
      hypotheses: [],
    };
  }
  const token = findToken(tokens, ref);
  if (!token) {
    return {
      value: null,
      citation: null,
      flag: {
        field,
        code: "TOKEN_NOT_FOUND",
        detail: `page ${ref.page} · token ${ref.ordinal}`,
      },
      hypotheses: [],
    };
  }
  const citation = citer(token, field, "montant", zone, binding);
  const texte = texteDeLaPlage(tokens, ref, token);
  const hypotheses = treillisMontant(texte, decimales);

  if (hypotheses.length === 0) {
    return {
      value: null,
      citation,
      flag: { field, code: "VALUE_NOT_A_NUMBER", detail: token.text },
      hypotheses,
    };
  }
  if (hypotheses.length === 1) {
    return {
      value: enDecimal(hypotheses[0]!.millimes, decimales),
      citation,
      flag: null,
      hypotheses,
    };
  }
  return {
    value: null,
    citation,
    flag: {
      field,
      code: "SEPARATEUR_AMBIGU",
      detail: `« ${texte} » se lit ${hypotheses.map((h) => enDecimal(h.millimes, decimales)).join(" ou ")}`,
    },
    hypotheses,
  };
}

export type { FieldCitation, PageToken, ReadFlag, TokenRef } from "@malica/socle/ports/malica";
