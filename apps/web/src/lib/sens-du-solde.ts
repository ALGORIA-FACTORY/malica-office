/** Qualifie une valeur du moteur sans recalculer son montant. Zéro n'est pas un crédit. */
export function sensDuSolde(solde: string | null): "inconnu" | "nul" | "du" | "credit" {
  if (solde === null || solde.trim() === "") return "inconnu";
  const valeur = Number(solde);
  if (!Number.isFinite(valeur)) return "inconnu";
  if (valeur === 0) return "nul";
  return valeur > 0 ? "du" : "credit";
}
