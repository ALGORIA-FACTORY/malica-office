/**
 * Ce que la fiche d'une pièce qui en ACCOMPAGNE une autre affirme et propose,
 * dérivé en un seul endroit.
 *
 * Maquette « Reçus et justificatifs d'une pièce », validée par Wissem le
 * 25 octobre 2026. Trois cas dessinés :
 *
 *   recu          un reçu produit par Malica, dont les règlements vivent ;
 *   recuPerime    un reçu dont un règlement attesté a été annulé — il reste
 *                 lisible, barré d'un tampon, et un nouveau reçu se produit ;
 *   justificatif  la photo qui prouve un règlement.
 *
 * Deux cas que la maquette ne dessine pas, et que la base produit :
 *
 *   justificatifPerime  la photo d'un règlement annulé (une correction de
 *                       règlement laisse la preuve sur l'ancien) ;
 *   justificatifSeul    une photo rattachée à aucun règlement.
 *
 * Ils gardent les gestes du justificatif — « Rattacher à un autre règlement »
 * est précisément leur sortie — et disent leur état sans l'inventer.
 *
 * La BASE décide de tout ce qui compte (`piece_qui_accompagne`) ; ce module ne
 * fait que choisir les mots et les gestes. Aucun libellé ici : des clés.
 */
import type { MessageKey } from "@/i18n";
import type { PieceQuiAccompagne, ReglementAccompagne } from "@malica/socle/ports/repositories";

type CasDeLaFiche =
  "recu" | "recuPerime" | "justificatif" | "justificatifPerime" | "justificatifSeul";

export interface FicheQuiAccompagne {
  cas: CasDeLaFiche;
  /** Vert quand la pièce compte, ambre sinon. */
  ton: "ok" | "am";
  etat: MessageKey;
  /** Le règlement que la phrase cite : l'annulé quand il y en a un, sinon le premier. */
  cite: ReglementAccompagne | null;
  /** Le reçu barré d'un tampon « Annulé », en gris. */
  tampon: boolean;
  /** « Produire un nouveau reçu », le geste principal d'un reçu qui ne compte plus. */
  nouveauRecu: boolean;
  peutRattacher: boolean;
  peutReprendre: boolean;
  supprimer: MessageKey;
  titreSuppression: MessageKey;
  expliqueSuppression: MessageKey;
  note: MessageKey;
}

export function ficheQuiAccompagne(f: PieceQuiAccompagne): FicheQuiAccompagne {
  const annule = f.annulation
    ? (f.reglements.find((r) => r.id === f.annulation!.paiementId) ?? null)
    : null;
  const cite = annule ?? f.reglements[0] ?? null;

  if (f.genre === "recu") {
    const perime = !f.vaut;
    return {
      cas: perime ? "recuPerime" : "recu",
      ton: perime ? "am" : "ok",
      etat: perime ? "pme.accompagne.etat.neVautPlus" : "pme.accompagne.etat.valide",
      cite,
      tampon: perime,
      nouveauRecu: perime,
      peutRattacher: false,
      peutReprendre: false,
      supprimer: "pme.accompagne.supprimer.recu",
      titreSuppression: "pme.accompagne.feuille.supprimer.recu",
      expliqueSuppression: perime
        ? "pme.accompagne.feuille.supprimer.recuPerime.explique"
        : "pme.accompagne.feuille.supprimer.recu.explique",
      note: perime ? "pme.accompagne.note.recuPerime" : "pme.accompagne.note.recu",
    };
  }

  const cas: CasDeLaFiche = !f.vaut
    ? "justificatifPerime"
    : f.reglements.length === 0
      ? "justificatifSeul"
      : "justificatif";
  return {
    cas,
    ton: cas === "justificatif" ? "ok" : "am",
    etat:
      cas === "justificatif"
        ? "pme.accompagne.etat.joint"
        : cas === "justificatifPerime"
          ? "pme.accompagne.etat.neVautPlus"
          : "pme.accompagne.etat.sansReglement",
    cite,
    tampon: false,
    nouveauRecu: false,
    peutRattacher: true,
    peutReprendre: true,
    supprimer: "pme.accompagne.supprimer.justificatif",
    titreSuppression: "pme.accompagne.feuille.supprimer.justificatif",
    expliqueSuppression: "pme.accompagne.feuille.supprimer.justificatif.explique",
    note: "pme.accompagne.note.justificatif",
  };
}

/**
 * Le total de ce que la pièce atteste, en unités mineures — `null` si un
 * montant manque : on ne somme pas un inconnu.
 */
export function totalAtteste(reglements: readonly ReglementAccompagne[]): number | null {
  let total = 0;
  for (const r of reglements) {
    if (r.montantMineur === null) return null;
    total += r.montantMineur;
  }
  return total;
}

/**
 * Reprendre la photo d'une pièce TRANSMISE : la base le refuse
 * (`refus.accompagne.transmise`), et l'écran le dit AVANT d'ouvrir l'appareil
 * — sinon la nouvelle photo serait prise, envoyée, et resterait orpheline.
 */
export function repriseRefusee(f: Pick<PieceQuiAccompagne, "vis">): MessageKey | null {
  return f.vis === "partage" ? "refus.accompagne.transmise" : null;
}

/**
 * La clé d'idempotence d'un reçu : la facture et les règlements qu'il atteste.
 *
 * Deux appuis sur « Générer le reçu », ou un dépôt rejoué depuis la file hors
 * ligne, donnent la même clé, donc le même reçu (la base rend celui qui
 * existe). Un règlement de plus, ou un de moins, fait un autre reçu.
 */
export function cleDuRecu(pieceId: string, paiements: ReadonlyArray<string>): string {
  return `recu:${pieceId}:${[...paiements].sort().join(",")}`;
}
