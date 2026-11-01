/**
 * Les sept dossiers — UNE règle pour la capture, l'accueil, la page Dossier,
 * la bibliothèque et la fiche.
 *
 * 25 octobre 2026, maquette validée par Wissem : « Achats, Ventes, Banque,
 * Tickets et reçus, Gouvernance, Fiscal et social, Autres — cohérent lors du
 * parcours de lecture ». Avant, l'accueil montrait une carte par TYPE et
 * seulement s'il avait des pièces ; la capture proposait six types qui
 * n'étaient pas ceux de l'accueil ; la bibliothèque appelait « dossier » une
 * catégorie de dépense.
 *
 * Tout vient du référentiel (`ref.dossiers`, `ref.document_types.dossier`) :
 * ces fonctions ne connaissent aucun code de dossier.
 */
import type { PieceLue } from "@malica/socle/ports/repositories";

import { moisLocal } from "@/lib/lisible";

export interface Dossier {
  code: string;
  libelle: string;
  teinte: string;
  periode: "mois" | "annee";
  typeParDefaut: string;
}

export interface TypeRange {
  code: string;
  dossier: string;
  dossierSiVente: string | null;
}

type PieceTypee = Pick<PieceLue, "typeDeDocument" | "kind">;

/**
 * Le dossier d'une pièce : celui de son type ; pour un type qui change de
 * dossier selon le sens (un avoir émis), celui de la vente quand la lecture a
 * lu une vente. Sans type, aucun — jamais deviné.
 */
export function dossierDeLaPiece(p: PieceTypee, types: readonly TypeRange[]): string | null {
  const t = types.find((x) => x.code === p.typeDeDocument);
  if (!t) return null;
  return p.kind === "facture_vente" && t.dossierSiVente ? t.dossierSiVente : t.dossier;
}

/**
 * Le type qu'écrit le choix d'un dossier. À la capture : son type par défaut.
 * En correction : le type actuel s'il est déjà dans ce dossier — choisir le
 * dossier où la pièce se trouve ne doit pas effacer ce que la lecture a
 * précisé (un reçu de paiement reste un reçu de paiement).
 */
export function typePourLeDossier(
  d: Dossier,
  actuel: PieceTypee | null,
  types: readonly TypeRange[],
): string {
  const t = types.find((x) => x.code === actuel?.typeDeDocument);
  /*
   * Un type rangé selon le sens (un avoir) GARDE son type entre ses deux
   * dossiers : réécrire un avoir en « facture de vente » le ferait compter
   * comme une vente (revue du 25 octobre). Le sens se corrige à part.
   */
  if (t && (t.dossier === d.code || t.dossierSiVente === d.code)) return t.code;
  return d.typeParDefaut;
}

/**
 * Le mois d'une pièce (`AAAA-MM`) : celui de sa date quand la lecture en a
 * rendu une LISIBLE, sinon celui de la photo. Une date d'une autre forme ne
 * fait pas disparaître la pièce de toutes les cartes.
 */
export function moisDeLaPiece(p: Pick<PieceLue, "dateDocument" | "createdAt">): string {
  const lue = p.dateDocument && /^\d{4}-\d{2}-\d{2}/.test(p.dateDocument) ? p.dateDocument : null;
  // La photo est un instant : son mois se lit à l'heure du lecteur, comme le mois en cours.
  return lue ? lue.slice(0, 7) : moisLocal(new Date(p.createdAt));
}

/**
 * La période qu'une carte de dossier MONTRE : la plus récente qui a des
 * pièces, sans dépasser la période en cours ; la période en cours quand le
 * dossier est vide.
 *
 * 1er novembre 2026, Wissem : « Achats, Ventes dans la bibliothèque sont
 * vides, pourquoi ? ». La carte comptait le mois CALENDAIRE en cours, à la
 * date de la facture : le 1er du mois, et tant que les factures du mois
 * précédent arrivent, Achats et Ventes disaient « Aucune pièce » sur un
 * dossier plein. La carte et sa page lisent cette même règle.
 */
export function periodeMontree(
  pieces: ReadonlyArray<Pick<PieceLue, "dateDocument" | "createdAt">>,
  periode: Dossier["periode"],
  moisCourant: string,
): string {
  const cle = (mois: string) => (periode === "mois" ? mois : mois.slice(0, 4));
  const courante = cle(moisCourant);
  const passees = pieces.map((p) => cle(moisDeLaPiece(p))).filter((m) => m <= courante);
  return passees.length === 0 ? courante : passees.reduce((a, b) => (b > a ? b : a));
}

/** La pièce tombe-t-elle dans la période montrée (`AAAA-MM` ou `AAAA`) ? */
export function dansLaPeriodeMontree(
  p: Pick<PieceLue, "dateDocument" | "createdAt">,
  montree: string,
): boolean {
  return moisDeLaPiece(p).startsWith(montree);
}
