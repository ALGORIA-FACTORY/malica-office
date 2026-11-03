/**
 * LES GESTES DU CIRCUIT — la seule porte du web (revue Codex de #146).
 *
 * Trois fois, un écran a proposé un geste du circuit d'après `vis`, `status`
 * ou `gardeeLe` lus sur place, alors que `gestesDuCircuit` (Socle) disait
 * non : le lot comptait une pièce retournée au siège, puis l'onglet Suivi
 * offrait « Transmettre » sur cette même pièce. Chaque fois la base refusait,
 * et l'écran avait promis un geste impossible.
 *
 * La règle est donc tenue par la structure, pas par la vigilance :
 *   - envoyer, garder (et mettre de côté), demander un rappel ou une
 *     suppression, supprimer, renvoyer, mettre au privé n'appellent la base
 *     QUE d'ici — `circuit-a-une-seule-porte.test.ts` lit le code et échoue si
 *     un autre fichier appelle ces méthodes ;
 *   - chaque hook rend `null` quand le Socle ne propose pas le geste : un
 *     écran ne peut pas dessiner un bouton qu'il n'a pas reçu ;
 *   - les hooks de lot ne font partir que ce que le Socle permet, pièce par
 *     pièce (`resteAEnvoyer`, `gestesDuCircuit`).
 *
 * La base refait chaque contrôle : ceci décide de ce que l'écran MONTRE.
 */
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";

import { gestesDuCircuit, resteAEnvoyer, type GestesDuCircuit } from "@malica/socle/circuit";
import type {
  DemandeSurPiece,
  EnvoiDUnePiece,
  EtapeDeDemande,
} from "@malica/socle/ports/repositories";
import { statutDuCircuit, type FaitsDeLaPiece } from "@malica/socle/statut-d-envoi";

import type { EtatDeLEnvoi, Restee } from "@/lib/envoi";
import { unParUn } from "@/lib/un-par-un";
import { office } from "@/verticals/malica-office/composition";

import { useMonAcces } from "./use-mon-acces";
import { useMonCabinet } from "./use-mon-cabinet";

/** Une pièce et ses faits, tels que la liste et la fiche les lisent. */
export type PieceDuCircuitWeb = FaitsDeLaPiece & { id: string };

type Options<R, V> = Omit<UseMutationOptions<R, unknown, V>, "mutationFn">;

/** Un geste offert : la mutation, et rien quand le Socle ne l'offre pas. */
export type GesteOffert<R, V = void> = UseMutationResult<R, unknown, V>;

/**
 * Ce que le Socle permet à cette personne, sur ces faits. `null` tant que ses
 * droits ne sont pas lus : rien n'est promis.
 */
function useLeCircuit(tenantId: string | null | undefined) {
  const acces = useMonAcces(tenantId);
  const cabinet = useMonCabinet(tenantId);
  const droits = acces.data?.droits ?? null;
  const aUnCabinet = Boolean(cabinet.data);
  const faits = (f: FaitsDeLaPiece) => ({
    vis: f.vis,
    status: f.status,
    gardeeLe: f.gardeeLe ?? null,
    suivi: f.suivi ?? null,
    circuit: f.circuit ?? null,
    accompagne: f.accompagne ?? null,
  });
  return {
    gestesDe: (f: FaitsDeLaPiece): GestesDuCircuit | null => {
      if (!droits) return null;
      const p = faits(f);
      return gestesDuCircuit({ ...p, statut: statutDuCircuit(p) }, droits, aUnCabinet);
    },
    resteDe: (f: FaitsDeLaPiece): EtapeDeDemande | null =>
      droits ? resteAEnvoyer(faits(f), droits, aUnCabinet) : null,
  };
}

/** Les gestes d'une pièce, pour cette personne : le seul calcul du web. */
export function useGestesDuCircuit(
  tenantId: string | null | undefined,
  faits: FaitsDeLaPiece | null,
): GestesDuCircuit | null {
  const { gestesDe } = useLeCircuit(tenantId);
  return faits ? gestesDe(faits) : null;
}

/**
 * À qui une pièce reste à envoyer, par cette personne — le seul prédicat
 * (`resteAEnvoyer`) : la pièce suivante à décider, la carte d'une pièce reçue.
 */
export function useResteAEnvoyer(
  tenantId: string | null | undefined,
): (p: FaitsDeLaPiece) => EtapeDeDemande | null {
  return useLeCircuit(tenantId).resteDe;
}

/* ================================================================ ENVOYER */

/**
 * « Envoyer » une pièce — au propriétaire pour le siège, au comptable pour
 * qui transmet. Aussi « Transmettre quand même » une pièce gardée : défaire
 * sa décision est un geste explicite. `null` quand la fiche ne l'offre pas
 * (retournée au siège, partie, sans destinataire).
 */
export function useEnvoyer(
  tenantId: string | null | undefined,
  piece: PieceDuCircuitWeb | null,
  options: Options<EnvoiDUnePiece, void> = {},
): (GesteOffert<EnvoiDUnePiece> & { vers: EtapeDeDemande }) | null {
  const { gestesDe } = useLeCircuit(tenantId);
  const id = piece?.id ?? null;
  const mutation = useMutation({
    ...options,
    mutationFn: () => office().collab.envoyer(exiger(id)),
  });
  const vers = piece ? (gestesDe(piece)?.envoyer ?? null) : null;
  return vers ? { ...mutation, vers } : null;
}

/**
 * ENVOYER EN LOT — ce qui reste à envoyer, et rien d'autre (`resteAEnvoyer`).
 * Une pièce gardée, retournée, partie ou d'un autre passage est écartée ici,
 * et la porte de la base (`piece_envoyer_en_lot`) l'écarte aussi. Rend les
 * identifiants envoyés.
 */
export function useEnvoyerEnLot(
  tenantId: string | null | undefined,
  options: Options<readonly string[], readonly PieceDuCircuitWeb[]> = {},
) {
  const { resteDe } = useLeCircuit(tenantId);
  const reste = (p: FaitsDeLaPiece) => resteDe(p) !== null;
  const mutation = useMutation({
    ...options,
    mutationFn: async (pieces: readonly PieceDuCircuitWeb[]) => {
      const ids = pieces.filter(reste).map((p) => p.id);
      if (ids.length > 0) await office().collab.transmettreLesPieces(ids);
      return ids;
    },
  });
  return { ...mutation, reste };
}

/**
 * Le même lot, une pièce après l'autre : une panne au milieu laisse les
 * premières parties, et chaque pièce restée garde sa raison (`refusDe` : la
 * phrase d'un refus rédigé, ou `null`). La fin de la capture le dit pièce par
 * pièce.
 */
export function useEnvoyerUneAUne(
  tenantId: string | null | undefined,
  refusDe: (e: unknown) => string | null,
  options: Options<EtatDeLEnvoi, readonly PieceDuCircuitWeb[]> = {},
) {
  const { resteDe } = useLeCircuit(tenantId);
  const reste = (p: FaitsDeLaPiece) => resteDe(p) !== null;
  const mutation = useMutation({
    ...options,
    mutationFn: async (pieces: readonly PieceDuCircuitWeb[]) => {
      const parties: string[] = [];
      const restees: Restee[] = [];
      for (const id of pieces.filter(reste).map((p) => p.id)) {
        try {
          await office().collab.transmettreLesPieces([id]);
          parties.push(id);
        } catch (e) {
          restees.push({ id, refus: refusDe(e) });
        }
      }
      return { parties, restees };
    },
  });
  return { ...mutation, reste };
}

/* ================================================================= GARDER */

/**
 * « Garder » une pièce : décider de ne pas l'envoyer au comptable — sur la
 * fiche, ou sur la carte d'un retour du comptable. `null` sinon.
 */
export function useGarder(
  tenantId: string | null | undefined,
  piece: PieceDuCircuitWeb | null,
  options: Options<{ changed: boolean }, void> = {},
): GesteOffert<{ changed: boolean }> | null {
  const { gestesDe } = useLeCircuit(tenantId);
  const id = piece?.id ?? null;
  const mutation = useMutation({
    ...options,
    mutationFn: () => office().collab.garderPiece(exiger(id)),
  });
  const g = piece ? gestesDe(piece) : null;
  return g?.garder || g?.garderLeRetour ? mutation : null;
}

/**
 * La mettre de côté, en lot, à la capture : ne pas la lire, ou ne pas
 * l'envoyer. Seules les pièces que le Socle permet de garder le sont ; le
 * siège, qui n'a rien à décider pour le propriétaire, n'écrit rien — et la
 * base, qui le lui refuserait, n'est pas appelée.
 */
export function useMettreDeCote(
  tenantId: string | null | undefined,
  options: Options<readonly string[], readonly PieceDuCircuitWeb[]> = {},
) {
  const { gestesDe } = useLeCircuit(tenantId);
  const peut = (p: FaitsDeLaPiece) => gestesDe(p)?.mettreDeCote ?? false;
  const mutation = useMutation({
    ...options,
    mutationFn: async (pieces: readonly PieceDuCircuitWeb[]) => {
      const ids = pieces.filter(peut).map((p) => p.id);
      for (const id of ids) await office().collab.garderPiece(id);
      return ids;
    },
  });
  return { ...mutation, peut };
}

/* ============================================================== DEMANDER */

/**
 * Demander un rappel ou une suppression — au propriétaire (le siège), ou au
 * comptable. `a` dit à qui. `null` quand rien ne se demande ici.
 */
export function useDemander(
  tenantId: string | null | undefined,
  piece: PieceDuCircuitWeb | null,
  objet: DemandeSurPiece,
  options: Options<{ dejaDemandee: boolean }, void> = {},
): (GesteOffert<{ dejaDemandee: boolean }> & { a: EtapeDeDemande }) | null {
  const { gestesDe } = useLeCircuit(tenantId);
  const id = piece?.id ?? null;
  const mutation = useMutation({
    ...options,
    mutationFn: () => office().collab.demanderSurPiece(exiger(id), objet),
  });
  const g = piece ? gestesDe(piece) : null;
  const a = objet === "rappel" ? (g?.rappeler ?? null) : (g?.demanderA ?? null);
  return a ? { ...mutation, a } : null;
}

/* ============================================================== SUPPRIMER */

/** `false` de la base : la pièce n'est plus visible. Ce n'est pas un succès. */
async function supprimerUne(id: string): Promise<void> {
  if (!(await office().capture.supprimer(id))) throw new Error(`suppression sans effet : ${id}`);
}

/**
 * Effacer le dépôt qu'un geste vient de faire et qui n'a pas abouti — un
 * remplacement de justificatif refusé, une photo arrivée après l'abandon. Ce
 * n'est pas un geste de l'écran : la pièce est la sienne, née à l'instant,
 * jamais partie, et la base refait le contrôle. L'appelant relance l'erreur du
 * geste qui a échoué ; celle-ci ne la masque pas.
 */
export async function effacerUnDepotAvorte(id: string): Promise<void> {
  await office().capture.supprimer(id);
}

/** Supprimer une pièce sans rien demander. `null` quand elle se demande. */
export function useSupprimer(
  tenantId: string | null | undefined,
  piece: PieceDuCircuitWeb | null,
  options: Options<void, void> = {},
): GesteOffert<void> | null {
  const { gestesDe } = useLeCircuit(tenantId);
  const id = piece?.id ?? null;
  const mutation = useMutation({ ...options, mutationFn: () => supprimerUne(exiger(id)) });
  return piece && gestesDe(piece)?.supprimer ? mutation : null;
}

/**
 * Supprimer un lot (Mon espace), l'un après l'autre : un arrêt en route se dit
 * (`LotInterrompu`). Seules partent les pièces que le Socle permet de
 * supprimer.
 */
export function useSupprimerEnLot(
  tenantId: string | null | undefined,
  options: Options<readonly string[], readonly PieceDuCircuitWeb[]> = {},
) {
  const { gestesDe } = useLeCircuit(tenantId);
  const peut = (p: FaitsDeLaPiece) => gestesDe(p)?.supprimer ?? false;
  const mutation = useMutation({
    ...options,
    mutationFn: (pieces: readonly PieceDuCircuitWeb[]) =>
      unParUn(
        pieces.filter(peut).map((p) => p.id),
        supprimerUne,
      ),
  });
  return { ...mutation, peut };
}

/**
 * Supprimer ses pièces de Mon espace laissées dans une société qu'on a
 * quittée. Hors de la société, aucun droit ne se lit : la liste
 * (`monEspaceHorsSociete`) ne rend que des pièces privées dont on est
 * l'auteur, celles que `gestesDuCircuit` laisse toujours supprimer, et la base
 * le refait (`capture_piece_supprimer`).
 */
export function useSupprimerDeMonEspaceParti(
  options: Options<readonly string[], readonly string[]> = {},
) {
  return useMutation({
    ...options,
    mutationFn: (ids: readonly string[]) => unParUn(ids, supprimerUne),
  });
}

/* ======================================================= LES AUTRES GESTES */

/** « Renvoyer » une pièce retournée, depuis sa carte. `null` sinon. */
export function useRenvoyer(
  tenantId: string | null | undefined,
  piece: PieceDuCircuitWeb | null,
  options: Options<{ le: string }, void> = {},
): GesteOffert<{ le: string }> | null {
  const { gestesDe } = useLeCircuit(tenantId);
  const id = piece?.id ?? null;
  const mutation = useMutation({
    ...options,
    mutationFn: () => office().capture.renvoyer(exiger(id)),
  });
  return piece && gestesDe(piece)?.renvoyer ? mutation : null;
}

/** La remettre à Mon espace : la sienne, qui n'est pas en route. `null` sinon. */
export function useMettreAuPrive(
  tenantId: string | null | undefined,
  piece: PieceDuCircuitWeb | null,
  options: Options<boolean, void> = {},
): GesteOffert<boolean> | null {
  const { gestesDe } = useLeCircuit(tenantId);
  const id = piece?.id ?? null;
  const mutation = useMutation({
    ...options,
    mutationFn: () => office().collab.setPieceVis(exiger(id), "personnel"),
  });
  return piece && gestesDe(piece)?.mettreAuPrive ? mutation : null;
}

/**
 * Un geste n'est rendu qu'avec sa pièce : sans elle, le hook a rendu `null`
 * et aucun bouton n'existe. Si cela arrivait quand même, c'est une erreur
 * qui se dit, jamais un appel sans pièce.
 */
function exiger(id: string | null): string {
  if (!id) throw new Error("geste du circuit sans pièce");
  return id;
}
