/**
 * Les pièces qui font la TVA du mois d'une société — une seule règle pour l'écran de la
 * société et pour le chiffre par société (`chiffre-par-societe.ts`).
 *
 * Avec une comptabilité mandatée : les pièces TRANSMISES du mois (le cabinet ne déclare que
 * ce qu'il a reçu, décision du 10 octobre 2026).
 *
 * Sans comptabilité : les pièces comptabilisées, PLUS celles qui tiennent et que personne
 * n'a encore reprises, en estimation (`pieces_qui_comptent_v.estimation`, que
 * `extraitsTransmis` rend au mois de leur facture). Le dirigeant, 24 novembre 2026 : « sans
 * comptabilité, compter dans la TVA les mêmes pièces que dans les charges, avec la mention
 * Estimation sur les deux écrans ». Avant, la pièce MAP de juillet pesait 400 aux charges
 * et 0 à la TVA. Une pièce présente des deux côtés n'est comptée qu'une fois : l'écriture
 * l'emporte sur la lecture.
 */
import { office } from "@/verticals/malica-office/composition";

type Extrait = Awaited<ReturnType<ReturnType<typeof office>["office"]["bookedExtracts"]>>[number];

export interface ExtraitsDeLaTva {
  lignes: Extrait[];
  /** Au moins une pièce vient de la lecture seule : le chiffre est une estimation. */
  estimation: boolean;
}

export async function extraitsDeLaTvaDuMois(
  tenantId: string,
  aUnCabinet: boolean,
  du: string,
  au: string,
): Promise<ExtraitsDeLaTva> {
  if (aUnCabinet) {
    return { lignes: await office().office.extraitsTransmis(tenantId, du, au), estimation: false };
  }
  const [ecrites, lues] = await Promise.all([
    office().office.bookedExtracts(tenantId, du, au),
    office().office.extraitsTransmis(tenantId, du, au),
  ]);
  const dejaEcrites = new Set(ecrites.map((e) => e.pieceId.toLowerCase()));
  const enPlus = lues.filter((l) => !dejaEcrites.has(l.pieceId.toLowerCase()));
  return { lignes: [...ecrites, ...enPlus], estimation: enPlus.length > 0 };
}
