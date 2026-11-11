/**
 * Les achats et les ventes d'un dossier, mois par mois.
 *
 * Pur : il reçoit les pièces lues (sens, total TTC relevé, devise, date du
 * document) et rend une série de mois. Il ne lit rien, n'appelle rien (R1).
 *
 * ============================================================ CE QU'IL COMPTE
 *
 * Les factures d'achat et de vente dont le total ET la date ont été relevés
 * (R2), dans la devise du dossier, sur les `nb` mois qui finissent à `jusqua`.
 * Ce qui ne se compte pas est DIT : total non lu, autre devise (aucun cours
 * n'est appliqué), date non lue. Un mois sans pièce rend `null`, pas zéro : on
 * ne sait pas qu'il n'y a rien eu, on sait qu'aucune pièce lue ne le dit.
 *
 * Ce n'est PAS un chiffre d'affaires comptable : ce sont les totaux TTC des
 * pièces lues. L'appelant doit le dire tel quel.
 */
import { moisGlissants } from "../../exercice.ts";
import { sommeDecimale } from "../../somme-decimale.ts";

export interface PieceLuePourLesMois {
  kind: string | null;
  total: string | null;
  devise: string | null;
  /** AAAA-MM-JJ ; `null` si la date n'a pas été lue. */
  dateDocument: string | null;
}

export interface MoisDePieces {
  /** AAAA-MM. */
  mois: string;
  /** La somme TTC des achats du mois ; `null` si aucune pièce lue. */
  achats: string | null;
  ventes: string | null;
  piecesAchats: number;
  piecesVentes: number;
}

export interface PiecesParMois {
  devise: string;
  mois: MoisDePieces[];
  totalAchats: string;
  totalVentes: string;
  /** Les factures écartées des sommes, tous sens confondus. */
  ecartees: { sansTotal: number; autreDevise: number; sansDate: number };
}

const ACHAT = "facture_achat";
const VENTE = "facture_vente";

export function piecesParMois(
  pieces: readonly PieceLuePourLesMois[],
  devise: string,
  decimales: number,
  jusqua: string,
  nb: number,
): PiecesParMois {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(jusqua)) throw new Error(`mois illisible : ${jusqua}`);
  const fenetre = moisGlissants(jusqua, nb);
  const cases = new Map(
    fenetre.map((m) => [m, { achats: [] as string[], ventes: [] as string[] }]),
  );
  const ecartees = { sansTotal: 0, autreDevise: 0, sansDate: 0 };

  for (const p of pieces) {
    if (p.kind !== ACHAT && p.kind !== VENTE) continue;
    const mois =
      p.dateDocument && /^\d{4}-\d{2}-\d{2}/.test(p.dateDocument)
        ? p.dateDocument.slice(0, 7)
        : null;
    if (!mois) {
      ecartees.sansDate += 1;
      continue;
    }
    const c = cases.get(mois);
    // Hors de la fenêtre : ni comptée, ni écartée — elle n'est pas demandée.
    if (!c) continue;
    if (!p.total || !/^-?\d+(?:[.,]\d+)?$/.test(p.total.trim())) {
      ecartees.sansTotal += 1;
      continue;
    }
    if ((p.devise ?? devise) !== devise) {
      ecartees.autreDevise += 1;
      continue;
    }
    (p.kind === ACHAT ? c.achats : c.ventes).push(p.total);
  }

  const mois = fenetre.map((m) => {
    const c = cases.get(m)!;
    return {
      mois: m,
      achats: c.achats.length > 0 ? sommeDecimale(c.achats, decimales) : null,
      ventes: c.ventes.length > 0 ? sommeDecimale(c.ventes, decimales) : null,
      piecesAchats: c.achats.length,
      piecesVentes: c.ventes.length,
    };
  });
  const tous = [...cases.values()];
  return {
    devise,
    mois,
    totalAchats: sommeDecimale(
      tous.flatMap((c) => c.achats),
      decimales,
    ),
    totalVentes: sommeDecimale(
      tous.flatMap((c) => c.ventes),
      decimales,
    ),
    ecartees,
  };
}
