/**
 * Ce qui reste à envoyer, et la pièce d'après — partagé par l'écran
 * « Envoyé » de la fiche et le lot de la bibliothèque (maquette validée le
 * 27 octobre 2026).
 *
 * Une seule définition de « reste à transmettre » : la pièce est dans la
 * société (`entite`), le dirigeant n'a pas DÉCIDÉ de la garder, et le cabinet
 * ne l'a pas retournée (un retour se renvoie par sa propre carte, avec la
 * preuve du geste). Pour le siège (lot 4), ce qui reste est ce qui n'est pas
 * encore parti chez le propriétaire : son statut le dit, « À envoyer ».
 */
import type { Droit, Visibility } from "@malica/socle/ports/repositories";
import {
  statutDuCircuit,
  statutPme,
  type CircuitInterne,
  type SuiviDEnvoi,
} from "@malica/socle/statut-d-envoi";

export interface PieceAEnvoyer {
  id: string;
  vis: Visibility;
  gardeeLe?: string | null;
  status: string;
  suivi?: SuiviDEnvoi | null;
  circuit?: CircuitInterne | null;
  transmiseLe?: string | null;
}

/**
 * Où part le geste « Envoyer » (lot 4) : le siège envoie au propriétaire, qui
 * transmet au comptable — s'il y en a un. `null` : personne à qui envoyer.
 * La base choisit de même (`piece_envoyer`) ; l'écran ne fait que le dire.
 */
export type DestinationDEnvoi = "proprietaire" | "cabinet";

export function destinationDeLEnvoi(
  droits: readonly Droit[] | undefined,
  aUnCabinet: boolean,
): DestinationDEnvoi | null {
  if (droits?.includes("envoi.cabinet")) return aUnCabinet ? "cabinet" : null;
  if (droits?.includes("envoi.proprietaire")) return "proprietaire";
  return null;
}

/**
 * Partie vers cette destination ? Chez le propriétaire, la pièce RESTE dans
 * la société (`entite`) : c'est le circuit qui le dit, pas la visibilité
 * (revue Codex de #146 — l'écran « Envoyé » n'apparaissait jamais).
 */
export function partieVers(p: PieceAEnvoyer, d: DestinationDEnvoi): boolean {
  if (d === "cabinet") return p.vis === "partage";
  return (
    statutDuCircuit({
      vis: p.vis,
      status: p.status,
      gardeeLe: p.gardeeLe ?? null,
      suivi: p.suivi ?? null,
      circuit: p.circuit ?? null,
    }).chez === "proprietaire"
  );
}

/** L'heure de la base pour ce départ. */
export function partieLeVers(p: PieceAEnvoyer, d: DestinationDEnvoi): string | null {
  return d === "cabinet" ? (p.transmiseLe ?? null) : (p.circuit?.envoyeeLe ?? null);
}

export function resteATransmettre(p: PieceAEnvoyer): boolean {
  if (p.vis !== "entite" || p.gardeeLe || p.status === "retournee") return false;
  // Le siège : ce qui n'est pas encore parti chez le propriétaire.
  if (p.circuit && !p.circuit.recoit) return statutPme(p) === "a_envoyer";
  return true;
}

/**
 * La pièce suivante à décider, après `courante` dans l'ordre de la liste —
 * puis depuis le début. `null` : il n'y en a plus, et « Pièce suivante » ne
 * s'affiche pas.
 */
export function pieceSuivanteATransmettre<P extends PieceAEnvoyer>(
  pieces: readonly P[],
  courante: string,
): P | null {
  const rang = pieces.findIndex((p) => p.id === courante);
  const ordre = rang < 0 ? pieces : [...pieces.slice(rang + 1), ...pieces.slice(0, rang)];
  return ordre.find((p) => p.id !== courante && resteATransmettre(p)) ?? null;
}

/** Une pièce restée : `refus` est la phrase d'un refus rédigé (4xx), sinon `null`. */
export interface Restee {
  id: string;
  refus: string | null;
}

export interface EtatDeLEnvoi {
  parties: readonly string[];
  restees: readonly Restee[];
}

/**
 * Ajoute le résultat d'une tentative à ce qui était déjà su.
 *
 * Réessayer UNE pièce ne dit rien des autres restées : elles gardent leur
 * place (revue Codex de #125 — réessayer B effaçait C, jamais retentée, et
 * l'écran annonçait que tout était parti).
 */
export function fusionnerLEnvoi(
  avant: EtatDeLEnvoi | null,
  tentees: readonly string[],
  resultat: EtatDeLEnvoi,
): EtatDeLEnvoi {
  return {
    parties: [...(avant?.parties ?? []), ...resultat.parties],
    restees: [
      ...(avant?.restees ?? []).filter((r) => !tentees.includes(r.id)),
      ...resultat.restees,
    ],
  };
}
