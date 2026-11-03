/**
 * Les pièces de la personne, rangées par société et par siège — ce que
 * l'abonnement ouvre.
 *
 * Le dossier ouvert et la bibliothèque regroupent tous deux par société et par
 * siège (maquettes validées par Wissem le 1er novembre 2026). La lecture et les
 * règles vivent ici, une fois.
 */
import type { PieceLue } from "@malica/socle/ports/repositories";

import { usePme } from "@/components/malica/pme-context";
import { usePiecesLues, usePiecesLuesDesSocietes } from "@/hooks/use-pieces-lues";
import { useI18n } from "@/i18n";

/** Une pièce et la société où elle est rangée. */
interface PieceDeSociete {
  piece: PieceLue;
  societe: string;
}

export function usePiecesDesSocietes() {
  const pme = usePme();
  const { t } = useI18n();

  /*
   * TOUTES LES SOCIÉTÉS DE LA PERSONNE (3 novembre 2026). Le sélecteur de
   * l'en-tête est parti : le propriétaire voit toutes ses sociétés, chacune
   * à part. L'offre de la société ouverte ne décide plus de ce qu'il voit des
   * autres — elle ne décidait que d'une société parmi plusieurs, sans le
   * dire. Une seule société ne regroupe rien.
   */
  const parSociete = pme.dossiers.length > 1;
  const parSiege = pme.forfait.ouvertures.sieges;

  const lues = usePiecesLues();
  const autresIds = parSociete
    ? pme.dossiers.filter((d) => d.id !== pme.tenantId).map((d) => d.id)
    : [];
  const autres = usePiecesLuesDesSocietes(autresIds);

  // Une pièce privée n'est ni dans la bibliothèque ni dans un dossier.
  const deLaSociete = (lot: readonly PieceLue[] | undefined, societe: string) =>
    (lot ?? []).filter((p) => p.vis !== "personnel").map((piece) => ({ piece, societe }));
  const toutes: PieceDeSociete[] = [
    ...deLaSociete(lues.data, pme.tenantId),
    ...autres.flatMap((q, i) => deLaSociete(q.data, autresIds[i]!)),
  ];

  const nomDeSociete = (id: string) => pme.dossiers.find((d) => d.id === id)?.name ?? "";

  /** Les pièces d'un lot, par siège (l'auteur), le nom de la personne en clair. */
  const parSieges = (lot: readonly PieceLue[]) => {
    const sieges = new Map<string, { nom: string; pieces: PieceLue[] }>();
    for (const piece of lot) {
      const id = piece.auteurId;
      if (!id) continue;
      const prenom = piece.circuit?.auteur ?? "—";
      const nom = piece.circuit?.mienne ? t("pme.dossier.vous", { nom: prenom }) : prenom;
      const g = sieges.get(id) ?? { nom, pieces: [] };
      g.pieces.push(piece);
      sieges.set(id, g);
    }
    return sieges;
  };

  /*
   * La fiche d'une pièce lit son contexte (cabinet, droits, gestes, cache) sur
   * la société OUVERTE. Une pièce d'une autre société ouvre donc d'abord sa
   * société, sinon elle s'afficherait avec le cabinet et les droits d'une autre.
   */
  const societeDe = new Map(toutes.map((x) => [x.piece.id, x.societe]));
  const ouvrirSaSociete = (pieceId: string) => {
    const id = societeDe.get(pieceId);
    if (id && id !== pme.tenantId) pme.choisirDossier(id);
  };

  return {
    toutes,
    parSociete,
    parSiege,
    chargement: lues.isPending || autres.some((q) => q.isPending),
    nomDeSociete,
    parSieges,
    ouvrirSaSociete,
  };
}
