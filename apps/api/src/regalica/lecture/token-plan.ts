import type { FieldCitation, PageToken, ReadFlag, TokenRef } from "@regalica/socle/ports/regalica";
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
 * Normalise un texte de token en chaîne décimale.
 * Accepte « 1 234,560 », « 1.234,56 », « 12 345.678 TND », « (123,45) ».
 * Retourne null si le token ne porte pas de nombre — la valeur reste alors
 * absente et drapeautée : jamais devinée.
 */
export function normalizeAmount(text: string): string | null {
  let s = text
    .replace(/\u00a0|\u202f|\s/g, "")
    .replace(/[A-Za-z\u0600-\u06FF%]/g, "")
    .replace(/[^\d.,()\-+]/g, "");
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/^\+/, "");

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const decimalSep = lastDot > lastComma ? "." : lastComma > -1 ? "," : null;

  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    const intPart = s.slice(0, idx).replace(/[.,]/g, "");
    const fracPart = s.slice(idx + 1).replace(/[.,]/g, "");
    // Un POINT suivi de trois chiffres reste ambigu (« 1.234 ») : on le lit
    // comme séparateur de milliers. La virgule, elle, sépare les décimales —
    // le dinar en compte trois.
    const ambiguousThousands =
      decimalSep === "." &&
      fracPart.length === 3 &&
      intPart.length > 0 &&
      intPart.length <= 3 &&
      !/[.,]/.test(s.slice(0, idx));
    s = ambiguousThousands ? `${intPart}${fracPart}` : `${intPart || "0"}.${fracPart}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const out = `${negative ? "-" : ""}${s}`;
  return out;
}

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
  kind: "amount" | "date" | "text",
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
  const citation: FieldCitation = {
    field,
    page: token.page,
    ordinal: token.ordinal,
    zone: binding?.zone ?? zone ?? null,
    ui_field: binding?.uiField ?? field,
    ui_role: kind === "amount" ? "montant" : kind === "date" ? "date" : "texte",
    bbox: { x0: token.x0, y0: token.y0, x1: token.x1, y1: token.y1 },
  };
  if (kind === "amount") {
    /*
     * ============================== « 1 000,000 » LU COMME « 1 »
     *
     * En Tunisie comme en France, les milliers se séparent par une ESPACE :
     * « 1 000,000 TND ». Le découpage en jetons se fait sur les espaces — le
     * montant arrive donc en deux morceaux, « 1 » et « 000,000 ».
     *
     * Le schéma prévoit une plage de jetons (`ordinal_end`) pour ce cas, et
     * elle n'était honorée que pour le TEXTE : la branche des montants rendait
     * la main avant de l'atteindre. Un total de 1 190 dinars devenait 1 dinar,
     * sans le moindre signalement — l'erreur la plus grave qu'un produit
     * fiscal puisse commettre, parce qu'elle a l'air d'un montant.
     *
     * On ne recolle QUE ce que le modèle a lui-même désigné. Joindre des
     * jetons qu'il n'a pas cités reviendrait à fabriquer un montant, ce que la
     * règle R2 interdit.
     */
    const texte = texteDeLaPlage(tokens, ref, token);
    const value = normalizeAmount(texte);
    return value === null
      ? {
          value: null,
          citation,
          flag: { field, code: "VALUE_NOT_A_NUMBER", detail: token.text },
        }
      : { value, citation, flag: null };
  }
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

export type { FieldCitation, PageToken, ReadFlag, TokenRef } from "@regalica/socle/ports/regalica";
