/**
 * Ce qu'un retour du cabinet demande au client, dit en un geste.
 *
 * Maquette « Retours du cabinet et pièces à confirmer », validée le
 * 25 octobre 2026. Le geste vient du référentiel (`ref.rejet_motifs.geste`) :
 * le cabinet choisit un motif, et le client lit UNE action, la même sur
 * l'aperçu du cabinet et sur la fiche de la pièce — d'où ce tableau unique.
 */
import type { GesteDeRetour } from "@malica/socle/ports/repositories";

import type { MessageKey } from "@/i18n";

export const LIBELLE_DU_GESTE: Record<GesteDeRetour, MessageKey> = {
  joindre_document: "pme.retour.geste.joindre_document",
  joindre_facture_conforme: "pme.retour.geste.joindre_facture_conforme",
  reprendre_photo: "pme.retour.geste.reprendre_photo",
  corriger_date: "pme.retour.geste.corriger_date",
  repondre: "pme.retour.geste.repondre",
  demander_suppression: "pme.retour.geste.demander_suppression",
  voir_reglement: "pme.retour.geste.voir_reglement",
};

/**
 * Ce que dit la ligne « c'est fait », quand le geste laisse une trace que la
 * base sait dater après le retour. Les gestes sans trace (`voir_reglement`,
 * `demander_suppression`) n'en ont pas : ils n'attendent rien pour renvoyer.
 */
export const FAIT_DU_GESTE: Partial<Record<GesteDeRetour, MessageKey>> = {
  joindre_document: "pme.retour.fait.joindre",
  joindre_facture_conforme: "pme.retour.fait.joindre",
  reprendre_photo: "pme.retour.fait.photo",
  corriger_date: "pme.retour.fait.date",
  repondre: "pme.retour.fait.reponse",
};

/**
 * La pièce est CORRIGÉE quand le geste demandé a laissé sa trace. La base dit
 * « fait » d'un geste sans trace (`preuve = 'aucune'` : un doublon, un
 * règlement annulé) dès le retour : rien n'y a été corrigé, et un doublon
 * annoncé « Corrigée — prête à renvoyer » invitait à renvoyer la copie en
 * trop (recette du 1er novembre 2026). Elle reste « Retournée » ; son geste
 * reste en tête.
 */
export function estCorrigee(geste: GesteDeRetour, fait: boolean): boolean {
  return fait && FAIT_DU_GESTE[geste] != null;
}

/**
 * Les sorties d'une pièce retournée (« Malica sans blocage », 28 octobre
 * 2026) : rien ne bloque. `geste` est le geste propre au motif quand aucune
 * autre sortie ne le porte déjà (joindre un document, corriger la date, voir
 * le règlement).
 */
export type SortieDuRetour =
  "geste" | "renvoyer" | "reprendre_photo" | "repondre" | "garder" | "supprimer";

/** Le geste du motif, dit par la sortie qui le fait quand il y en a une. */
const SORTIE_DU_GESTE: Partial<Record<GesteDeRetour, SortieDuRetour>> = {
  reprendre_photo: "reprendre_photo",
  repondre: "repondre",
  demander_suppression: "supprimer",
};

/**
 * Dans l'ordre de l'écran, chacune une fois : la principale d'abord — le
 * geste demandé tant qu'il n'est pas fait, « Renvoyer » ensuite —, puis les
 * autres.
 */
export function sortiesDuRetour(geste: GesteDeRetour, fait: boolean): SortieDuRetour[] {
  const duMotif = SORTIE_DU_GESTE[geste] ?? "geste";
  const ordre: SortieDuRetour[] = estCorrigee(geste, fait)
    ? ["renvoyer", duMotif, "reprendre_photo", "repondre", "garder", "supprimer"]
    : [duMotif, "renvoyer", "reprendre_photo", "repondre", "garder", "supprimer"];
  return [...new Set(ordre)];
}

/**
 * Un retour par pièce, le plus récent. Le cabinet peut retourner deux fois la
 * même pièce (renvoyée, puis retournée encore) : chaque retour laisse sa
 * notification, et l'écran « Il vous attend » montrait alors deux cartes pour
 * une seule facture (recette du 29 octobre 2026). Une notification sans pièce
 * n'est pas une carte : elle n'aurait aucun geste à porter.
 */
export function dernierRetourParPiece<T extends { createdAt: string }>(
  retours: readonly T[],
  pieceDe: (retour: T) => string | undefined,
): T[] {
  const parPiece = new Map<string, T>();
  for (const retour of retours) {
    const pieceId = pieceDe(retour);
    if (!pieceId) continue;
    const deja = parPiece.get(pieceId);
    if (!deja || Date.parse(retour.createdAt) > Date.parse(deja.createdAt)) {
      parPiece.set(pieceId, retour);
    }
  }
  return [...parPiece.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Un fait du journal de la pièce, tel que la comptabilité le lit. */
interface FaitDeLaPiece {
  id: string;
  action: string;
  at: string;
  payload: unknown;
}

/**
 * Ce que le client a répondu au DERNIER retour de la comptabilité, du plus
 * récent au plus ancien (recette du 11 novembre 2026).
 *
 * La réponse partait — un fait au journal, une alerte — mais l'écran de la
 * pièce ne la montrait pas : la comptabilité devait la trouver dans ses
 * alertes. Elle se lit ici dans le journal déjà chargé, sans autre requête.
 * Une réponse d'un siège à son propriétaire (`chez`) n'est pas adressée à la
 * comptabilité ; une réponse à un retour plus ancien ne se répète pas.
 */
export function reponsesAuDernierRetour(
  faits: readonly FaitDeLaPiece[],
): Array<{ id: string; texte: string; le: string }> {
  const dernierRetour = faits
    .filter((f) => f.action === "piece.retournee")
    .reduce<number | null>((t, f) => Math.max(t ?? 0, Date.parse(f.at)), null);
  return faits
    .flatMap((f) => {
      if (f.action !== "piece.reponse_client") return [];
      const p = (f.payload ?? {}) as { texte?: unknown; chez?: unknown };
      if (typeof p.texte !== "string" || p.texte.trim() === "" || p.chez === "proprietaire")
        return [];
      if (dernierRetour !== null && Date.parse(f.at) < dernierRetour) return [];
      return [{ id: f.id, texte: p.texte, le: f.at }];
    })
    .sort((a, b) => Date.parse(b.le) - Date.parse(a.le));
}
