/**
 * Ce que la fiche d'une pièce (côté PME) affirme, dérivé en un seul endroit
 * pour qu'elle ne se contredise jamais.
 *
 * 25 octobre 2026, staging, pièce « COMPTOIR » : quatre écritures de
 * RÈGLEMENT (deux paiements, deux annulations), aucune écriture de pièce. La
 * fiche disait « Écriture comptabilisée » pendant que le parcours disait
 * « Étape 2 · Lue », et la question du montant avait disparu : la personne
 * ne pouvait plus avancer. N'importe quelle écriture inscrite passait pour
 * celle de la pièce.
 */
import type { Ecriture, PieceStatus, Visibility } from "@malica/socle/ports/repositories";

/**
 * L'écriture de la pièce, et elle seule : la vivante (inscrite, de nature
 * « pièce », ni contre-passation ni contre-passée). Un règlement ou une
 * écriture annulée ne comptabilise pas la pièce.
 */
export function ecritureDeLaPiece(ecritures: readonly Ecriture[] | undefined): Ecriture | null {
  return (ecritures ?? []).find((e) => e.vivante) ?? null;
}

/** Le rang de chaque statut dans le parcours : Reçue 1 … Vue 5. */
const RANG_DU_STATUT: Readonly<Record<PieceStatus, number>> = {
  capturee: 1,
  lue: 2,
  proposee: 3,
  comptabilisee: 4,
  supervisee: 5,
  retournee: 3,
};

/** Le rang à partir duquel une pièce est comptée (l'étape « Comptée »). */
export const RANG_COMPTEE = RANG_DU_STATUT.comptabilisee;

export interface AvancementDeLaPiece {
  /** L'étape atteinte du parcours. */
  atteint: number;
  /** La pièce est comptabilisée : vrai si et seulement si `atteint >= RANG_COMPTEE`. */
  comptee: boolean;
}

/**
 * L'avancement, UNE source pour le parcours et pour « comptée ».
 *
 * Comptée par son écriture vivante, OU par son statut — l'écriture peut
 * tarder d'une requête, et une pièce comptée ne doit jamais reposer la
 * question du montant. Une écriture vivante pousse le parcours au moins à
 * l'étape « Comptée » : « Étape 2 » et « Écriture comptabilisée » ne peuvent
 * plus s'afficher ensemble.
 */
export function avancementDeLaPiece(
  status: PieceStatus,
  ecriture: Ecriture | null,
): AvancementDeLaPiece {
  const rang = RANG_DU_STATUT[status] ?? 1;
  const atteint = ecriture ? Math.max(rang, RANG_COMPTEE) : rang;
  return { atteint, comptee: atteint >= RANG_COMPTEE };
}

/** Les étapes du parcours, dans l'ordre du PRODUIT, et le rang qui les atteint. */
const ETAPES = [
  ["recue", 1],
  ["lue", 2],
  ["confirmee", 3],
  ["comptee", RANG_COMPTEE],
  ["vue", RANG_DU_STATUT.supervisee],
  ["declaree", 6],
] as const;

type CleDEtape = (typeof ETAPES)[number][0];
type EtatDEtape = "faite" | "courante" | "attente";

export interface ParcoursDeLaPiece extends AvancementDeLaPiece {
  /** Chaque étape : faite, en cours (la prochaine), ou en attente. */
  etapes: ReadonlyArray<{ cle: CleDEtape; etat: EtatDEtape }>;
  /** La dernière étape faite — celle que la pastille et le parcours nomment. */
  derniere: CleDEtape;
  /** L'étape qui vient, s'il y en a une. */
  prochaine: CleDEtape | null;
  /** La pastille du haut de la fiche. */
  pastille: {
    cle:
      | "pme.status.supervisee"
      | "pme.dossier.etat.comptabilisee"
      | "pme.home.etat.retour"
      | "pme.charges.answer.verifier"
      | "pme.refus.titre";
    ton: "ok" | "am" | "az" | "neutre";
  };
}

/**
 * Le parcours ET la pastille, d'une seule dérivation.
 *
 * Audit du 25 octobre 2026 : une pièce comptée portait la pastille
 * « Comptabilisée » pendant que le parcours disait « Comptée : en cours », en
 * ambre ; une pièce supervisée gardait « Comptabilisée » sous « Étape 5 ·
 * Vue ». Deux calculs voisins, deux réponses. L'étape ATTEINTE est faite ; la
 * suivante est en cours ; et la pastille nomme l'étape atteinte.
 *
 * « Déclarée » n'a pas encore d'état dans le produit : elle reste en attente,
 * jamais « en cours ».
 */
export function parcoursDeLaPiece(
  status: PieceStatus,
  ecriture: Ecriture | null,
): ParcoursDeLaPiece {
  const { atteint, comptee } = avancementDeLaPiece(status, ecriture);
  const etapes = ETAPES.map(([cle, rang]) => ({
    cle,
    etat: (rang <= atteint
      ? "faite"
      : rang === atteint + 1 && cle !== "declaree"
        ? "courante"
        : "attente") as EtatDEtape,
  }));
  const derniere = [...ETAPES].reverse().find(([, rang]) => rang <= atteint)?.[0] ?? "recue";
  const prochaine = ETAPES.find(([, rang]) => rang > atteint)?.[0] ?? null;
  const pastille: ParcoursDeLaPiece["pastille"] =
    atteint >= RANG_DU_STATUT.supervisee
      ? { cle: "pme.status.supervisee", ton: "ok" }
      : comptee
        ? { cle: "pme.dossier.etat.comptabilisee", ton: "ok" }
        : status === "retournee"
          ? { cle: "pme.home.etat.retour", ton: "az" }
          : status === "lue" || status === "proposee"
            ? { cle: "pme.charges.answer.verifier", ton: "am" }
            : { cle: "pme.refus.titre", ton: "neutre" };
  return { atteint, comptee, etapes, derniere, prochaine, pastille };
}

/**
 * La pièce est entre les mains du cabinet : partagée. C'est là seulement
 * qu'une suppression se DEMANDE — `piece_demander` refuse toute autre pièce,
 * et un bouton qui ne peut qu'échouer ne se montre pas.
 */
export function partageeAvecLeCabinet(vis: Visibility): boolean {
  return vis === "partage";
}

/**
 * La note sur une demande de suppression, à montrer ou non.
 *
 * Une pièce rappelée au privé peut garder une vieille demande en attente :
 * ce n'est plus à la comptabilité d'accorder quoi que ce soit, et la note
 * cacherait le « Supprimer » ordinaire. Hors partage, rien.
 */
export function noteDeSuppression(
  fait: string | null,
  vis: Visibility,
): "demandee" | "refusee" | null {
  if (!partageeAvecLeCabinet(vis)) return null;
  return fait === "demandee" || fait === "refusee" ? fait : null;
}

/**
 * Ce que dit l'étiquette d'une ligne lue (maquette « C », 25 octobre 2026).
 *
 * Une pièce COMPTÉE a été confirmée par la personne : ses lignes ne sont plus
 * « à vérifier » ni seulement « source » — elles sont « confirmé ». Avant, la
 * confiance du jugement décide ; tant qu'elle n'est pas connue, on ne dit rien
 * de faux (« inconnue » : l'écran propose seulement de voir la zone source).
 */
export type EtiquetteDeLecture = "confirme" | "aVerifier" | "source" | "inconnue";

export function etiquetteDeLecture(ligne: {
  comptee: boolean;
  confianceConnue: boolean;
  aVerifier: boolean;
}): EtiquetteDeLecture {
  if (ligne.comptee) return "confirme";
  if (!ligne.confianceConnue) return "inconnue";
  return ligne.aVerifier ? "aVerifier" : "source";
}

const JOUR_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La date à enregistrer depuis le champ « Date », ou `null` s'il n'y a rien à
 * écrire.
 *
 * Audit du 25 octobre 2026 : le jour du scan proposé ne s'enregistrait que si
 * on le CHANGEAIT — garder la date proposée n'écrivait rien, et la pièce
 * restait « date à indiquer ». La valeur affichée est donc enregistrable
 * telle quelle (en quittant le champ), sauf si c'est déjà celle qui est
 * enregistrée ou celle qui est en train de l'être. Une saisie incomplète
 * (chaîne vide d'un champ `date`) n'écrit rien.
 */
export function dateAEnregistrer(
  saisie: string,
  enregistree: string | null,
  enCours: string | null,
): string | null {
  if (!JOUR_ISO.test(saisie)) return null;
  if (saisie === enregistree || saisie === enCours) return null;
  return saisie;
}
