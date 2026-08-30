/**
 * Les erreurs du client de base ne sont pas des `Error` : sans normalisation,
 * l'écran retombe sur un libellé générique et masque la cause réelle
 * (déséquilibre, autorisation, motif du Socle). On les remonte telles quelles.
 */
export function dbError(error: unknown, context: string): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const e = error as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter((p): p is string => !!p && p.length > 0);
    const msg = parts.join(" · ") || "erreur inconnue";
    const out = new Error(e.code ? `${context} — ${msg} (${e.code})` : `${context} — ${msg}`);
    return out;
  }
  return new Error(`${context} — ${String(error)}`);
}

/** Lance l'erreur normalisée si présente. */
export function throwIf(error: unknown, context: string): void {
  if (error) throw dbError(error, context);
}
