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

export interface PageToken {
  page: number;
  ordinal: number;
  text: string;
  /** Coordonnées normalisées 0..1 dans la page. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence?: number | null;
}

export interface TokenRef {
  page: number;
  ordinal: number;
  /**
   * Fin de plage, pour un champ textuel porté par plusieurs tokens contigus
   * (« DREAM OPTIC SARL »). La valeur reste relue dans le plan : on ne fait que
   * concaténer des tokens existants, jamais compléter un mot absent.
   */
  ordinalEnd?: number;
}

export interface FieldCitation extends TokenRef {
  field: string;
  zone?: string | null;
  /**
   * Champ confié à l'interface : sans ambiguïté, la citation dit quelle valeur
   * l'écran affiche et à quel titre. La relecture d'un audit n'a plus à deviner
   * quel libellé portait ce token.
   */
  ui_field?: string | null;
  ui_role?: "montant" | "texte" | "date" | null;
  /** Coordonnées normalisées du token cité, telles que surlignées par l'UI. */
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface CitationBinding {
  zone?: string | null;
  uiField?: string | null;
}

export interface ReadFlag {
  field: string;
  code:
    | "MISSING_CITATION"
    | "TOKEN_NOT_FOUND"
    | "VALUE_NOT_A_NUMBER"
    | "DATE_UNREADABLE"
    | "DERIVED_BY_SOCLE";
  detail?: string;
}

/** Retrouve un token dans le plan. */
export function findToken(tokens: readonly PageToken[], ref: TokenRef): PageToken | null {
  return (
    tokens.find((t) => t.page === ref.page && t.ordinal === ref.ordinal) ?? null
  );
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
      decimalSep === "." && fracPart.length === 3 && intPart.length > 0 && intPart.length <= 3 && !/[.,]/.test(s.slice(0, idx));
    s = ambiguousThousands
      ? `${intPart}${fracPart}`
      : `${intPart || "0"}.${fracPart}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const out = `${negative ? "-" : ""}${s}`;
  return out;
}

/** Normalise un texte de token en date ISO. Retourne null si illisible. */
export function normalizeDate(text: string): string | null {
  const s = text.trim();
  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const dmy = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const [, d, m, yRaw] = dmy;
    const y = yRaw!.length === 2 ? `20${yRaw}` : yRaw!;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
    const value = normalizeAmount(token.text);
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
  if (typeof ref.ordinalEnd === "number" && ref.ordinalEnd > ref.ordinal) {
    const span = tokens
      .filter(
        (t) => t.page === ref.page && t.ordinal >= ref.ordinal && t.ordinal <= ref.ordinalEnd!,
      )
      .sort((a, b) => a.ordinal - b.ordinal);
    if (span.length > 1) {
      return { value: span.map((t) => t.text).join(" "), citation, flag: null };
    }
  }
  return { value: token.text, citation, flag: null };
}
