import type { PaiementDUnePiece } from "@malica/socle/ports/repositories";

/** Les annulations ne comptent pas ; seul le constat « non payé » vaut zéro sans montant. */
export function totalDesPaiements(paiements: ReadonlyArray<PaiementDUnePiece>): number | null {
  let total = 0;
  for (const paiement of paiements) {
    if (paiement.eteint) continue;
    if (paiement.moyenCode === "non_paye" && paiement.montantMineur === null) continue;
    if (!Number.isSafeInteger(paiement.montantMineur)) return null;
    const eteint = paiement.detteEteinteMineur ?? paiement.montantMineur;
    if (!Number.isSafeInteger(eteint) || eteint! < paiement.montantMineur!) return null;
    total += eteint!;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
