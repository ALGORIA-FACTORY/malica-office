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
  if (actuel && dossierDeLaPiece(actuel, types) === d.code && actuel.typeDeDocument) {
    return actuel.typeDeDocument;
  }
  return d.typeParDefaut;
}

/**
 * La pièce tombe-t-elle dans la période de la carte ? Le mois en cours
 * (`AAAA-MM`) pour le quotidien, l'année pour un PV ou une déclaration. La
 * date de la pièce d'abord ; celle de la photo quand la lecture n'en a pas.
 */
export function dansLaPeriode(
  p: Pick<PieceLue, "dateDocument" | "createdAt">,
  periode: Dossier["periode"],
  moisCourant: string,
): boolean {
  const date = (p.dateDocument ?? p.createdAt).slice(0, 7);
  return periode === "mois" ? date === moisCourant : date.slice(0, 4) === moisCourant.slice(0, 4);
}
