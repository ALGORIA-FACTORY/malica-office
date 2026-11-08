/**
 * Les cabinets de la personne, regroupés depuis les fiches de ses sociétés
 * (planche 6) : chacun avec les sociétés qu'il tient et ce qui attend un
 * geste — les pièces qu'il a retournées.
 */
import type { FicheDeSociete, PieceLue } from "@malica/socle/ports/repositories";

export interface CabinetDeLaPersonne {
  id: string;
  nom: string;
  societes: string[];
  aRepondre: number;
}

export function cabinetsDesSocietes(
  fiches: readonly FicheDeSociete[],
  piecesParSociete: ReadonlyMap<string, readonly PieceLue[]>,
): CabinetDeLaPersonne[] {
  const par = new Map<string, CabinetDeLaPersonne>();
  for (const f of fiches) {
    if (!f.cabinetId || !f.cabinet) continue;
    const c = par.get(f.cabinetId) ?? {
      id: f.cabinetId,
      nom: f.cabinet,
      societes: [],
      aRepondre: 0,
    };
    c.societes.push(f.tenantId);
    c.aRepondre += (piecesParSociete.get(f.tenantId) ?? []).filter(
      (p) => p.status === "retournee",
    ).length;
    par.set(f.cabinetId, c);
  }
  // Ce qui attend d'abord, puis le plus de sociétés.
  return [...par.values()].sort(
    (a, b) => b.aRepondre - a.aRepondre || b.societes.length - a.societes.length,
  );
}
