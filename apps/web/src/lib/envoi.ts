/**
 * L'envoi, vu de l'écran : partie vers quelle destination, à quelle heure, et
 * la pièce d'après — partagé par l'écran « Envoyé » de la fiche, le lot de la
 * bibliothèque, Mon espace et la fin de la capture (maquette du 27 octobre
 * 2026).
 *
 * CE QUI RESTE À ENVOYER n'est pas défini ici : c'est le prédicat du Socle
 * (`resteAEnvoyer`, sur `gestesDuCircuit`), que chaque écran reçoit de
 * `useDestinationDeLEnvoi` — une seule réponse à « puis-je l'envoyer, et à
 * qui ? » (revue Codex de #146).
 */
import type { Visibility } from "@malica/socle/ports/repositories";
import {
  statutDuCircuit,
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

/** Où part le geste « Envoyer » (`destinationDesEnvois`, au Socle). */
export type DestinationDEnvoi = "proprietaire" | "cabinet";

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

/**
 * Une pièce que la comptabilité a reçue et qui s'y compte : transmise, pas
 * retournée, et pas un document joint non lu — un bon de livraison joint à sa
 * facture part avec elle et se voit à côté d'elle, il n'est pas une pièce de
 * plus (recette du 11 novembre 2026). La file de la comptabilité suit la même
 * règle (`TRANSMISE`, côté serveur).
 */
export function compteCommeTransmise(p: {
  vis: Visibility;
  status: string;
  jointe?: boolean | null;
}): boolean {
  return p.vis === "partage" && p.status !== "retournee" && !(p.jointe && p.status === "capturee");
}

/** L'heure de la base pour ce départ. */
export function partieLeVers(p: PieceAEnvoyer, d: DestinationDEnvoi): string | null {
  return d === "cabinet" ? (p.transmiseLe ?? null) : (p.circuit?.envoyeeLe ?? null);
}

/**
 * La pièce suivante à décider, après `courante` dans l'ordre de la liste —
 * puis depuis le début. `reste` est LE prédicat (`resteAEnvoyer`). `null` : il
 * n'y en a plus, et « Pièce suivante » ne s'affiche pas.
 */
export function pieceSuivanteATransmettre<P extends PieceAEnvoyer>(
  pieces: readonly P[],
  courante: string,
  reste: (p: P) => boolean,
): P | null {
  const rang = pieces.findIndex((p) => p.id === courante);
  const ordre = rang < 0 ? pieces : [...pieces.slice(rang + 1), ...pieces.slice(0, rang)];
  return ordre.find((p) => p.id !== courante && reste(p)) ?? null;
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
