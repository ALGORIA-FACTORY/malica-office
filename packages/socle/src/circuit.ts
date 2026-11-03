/**
 * Ce que la fiche d'une pièce PROPOSE dans le circuit siège → propriétaire →
 * comptable (« Malica sans blocage », lot 4), dérivé en un seul endroit.
 *
 * Les droits viennent du référentiel (`acces.monAcces`), le statut du Socle
 * (`statutDuCircuit`), les demandes de leurs faits. L'écran ne propose que ce
 * qui peut aboutir ; la base refait chaque contrôle, et c'est elle qui décide.
 */
import type {
  DemandeSurPiece,
  Droit,
  EtapeDeDemande,
  EtatDeDemande,
  Visibility,
} from "./ports/repositories.ts";
import {
  statutDuCircuit,
  type CircuitInterne,
  type FaitsDeLaPiece,
  type StatutDuCircuit,
} from "./statut-d-envoi.ts";

const OBJETS: readonly DemandeSurPiece[] = ["rappel", "suppression"];

export interface PieceDuCircuit {
  vis: Visibility;
  status: string;
  gardeeLe: string | null;
  statut: StatutDuCircuit;
  circuit: CircuitInterne | null;
  /**
   * Un reçu ou un justificatif : il ne se lit jamais et suit sa pièce
   * (`app.piece_accompagne`). Absent : une pièce ordinaire.
   */
  accompagne?: boolean | null;
}

export interface GestesDuCircuit {
  /** « Envoyer » : au propriétaire (le siège), au comptable, ou rien ici. */
  envoyer: EtapeDeDemande | null;
  /** « Garder » : décider de ne pas l'envoyer au comptable. */
  garder: boolean;
  /**
   * La mettre de côté à la capture — ne pas la lire, ou ne pas l'envoyer :
   * la même décision que « Garder » (`capture_piece_garder`), prise sur un
   * lot qui vient d'être photographié, avec ou sans cabinet. Elle est à qui
   * tient `piece.garder` ; le siège n'a rien à décider pour le propriétaire.
   */
  mettreDeCote: boolean;
  /** Le propriétaire retourne au siège la pièce qu'il en a reçue. */
  retournerAuSiege: boolean;
  /** Ouvrir la pièce la « voit » : le propriétaire, pièce reçue d'un siège. */
  voirALOuverture: boolean;
  /** À qui se demande une suppression, ou rien. */
  demanderA: EtapeDeDemande | null;
  /**
   * À qui se demande un rappel, ou rien : comme la suppression, sauf une
   * pièce prise en charge, qui ne se rappelle plus.
   */
  rappeler: EtapeDeDemande | null;
  /** « Renvoyer » sur la carte de retour est le geste de cette personne. */
  renvoyer: boolean;
  /** « Garder » sur la carte d'un retour du comptable. */
  garderLeRetour: boolean;
  /** La rendre à Mon espace : la sienne, qui n'est pas en route. */
  mettreAuPrive: boolean;
  /**
   * La supprimer sans rien demander : la sienne, ou toute pièce avec
   * `piece.supprimer_toutes`, tant qu'elle n'est pas partie — ou rendue par
   * le comptable (« Malica sans blocage »). La base refait chaque contrôle
   * (`capture_piece_supprimer`).
   */
  supprimer: boolean;
}

const a = (droits: readonly Droit[], d: Droit) => droits.includes(d);

/**
 * Où partent les envois de cette personne : le siège envoie au propriétaire,
 * qui transmet au comptable — s'il y en a un. `null` : personne à qui
 * envoyer. La base choisit de même (`piece_envoyer`).
 */
export function destinationDesEnvois(
  droits: readonly Droit[] | undefined,
  aUnCabinet: boolean,
): EtapeDeDemande | null {
  if (droits?.includes("envoi.cabinet")) return aUnCabinet ? "cabinet" : null;
  if (droits?.includes("envoi.proprietaire")) return "proprietaire";
  return null;
}

export function gestesDuCircuit(
  p: PieceDuCircuit,
  droits: readonly Droit[],
  aUnCabinet: boolean,
): GestesDuCircuit {
  const versLeComptable = a(droits, "envoi.cabinet");
  const versLeProprietaire = a(droits, "envoi.proprietaire");
  const versOu = destinationDesEnvois(droits, aUnCabinet);
  const recoit = a(droits, "circuit.recevoir");
  const dernier = p.circuit?.dernier ?? null;
  const mienne = p.circuit?.mienne ?? false;
  const enRoute = dernier === "envoyee" || dernier === "retournee";
  const retour = p.statut.statut === "retour";
  const libre = p.status === "capturee" || p.status === "lue";
  const supprimeToutes = a(droits, "piece.supprimer_toutes");
  // Rendue par le comptable : elle est à nouveau au client, sans rien demander.
  const rendue = retour && p.vis === "partage" && p.status === "retournee";
  // Retournée au siège : la main est à lui. Le propriétaire attend sa
  // reprise ; il n'envoie ni ne garde ce qu'il vient de lui rendre.
  const chezLeSiege = p.statut.chez === "siege";
  // Une pièce non lue ne part pas au cabinet : on transmet ce qu'on connaît
  // (3 novembre 2026). Un reçu, un justificatif ne se lisent jamais : ils
  // suivent leur pièce. La base tient la même règle (`une_piece_non_lue_ne_part_pas`).
  const nonLue = p.status === "capturee" && !p.accompagne;

  const envoyer: EtapeDeDemande | null =
    p.vis !== "entite" || chezLeSiege
      ? null
      : versOu === "cabinet"
        ? nonLue
          ? null
          : "cabinet"
        : versOu === "proprietaire" && p.statut.statut === "a_envoyer"
          ? "proprietaire"
          : null;

  const demanderA: EtapeDeDemande | null = retour
    ? null
    : versLeComptable
      ? p.vis === "partage"
        ? "cabinet"
        : null
      : versLeProprietaire && ((p.vis === "entite" && dernier === "envoyee") || p.vis === "partage")
        ? "proprietaire"
        : null;

  const mettreDeCote =
    a(droits, "piece.garder") && p.vis !== "partage" && !p.gardeeLe && !chezLeSiege;

  return {
    envoyer,
    garder: mettreDeCote && aUnCabinet && p.vis === "entite",
    mettreDeCote,
    retournerAuSiege: recoit && p.vis === "entite" && dernier === "envoyee",
    voirALOuverture:
      recoit &&
      p.vis === "entite" &&
      (p.statut.statut === "recue" || p.statut.statut === "corrigee"),
    demanderA,
    rappeler: p.statut.statut === "prise_en_charge" ? null : demanderA,
    renvoyer: retour && (p.statut.chez === "proprietaire" ? versLeProprietaire : versLeComptable),
    garderLeRetour: retour && p.statut.chez === "cabinet" && a(droits, "piece.garder"),
    mettreAuPrive: p.vis === "entite" && mienne && !enRoute,
    supprimer:
      (rendue && (mienne || supprimeToutes)) ||
      (libre &&
        (p.vis === "personnel" ||
          (p.vis === "entite" && (supprimeToutes || (mienne && dernier !== "envoyee"))))),
  };
}

/** La carte d'une pièce qu'un siège a envoyée au propriétaire. */
export interface CarteDuRecu {
  /** L'envoyer au comptable : un cabinet engagé, et pas gardée. */
  envoyerAuComptable: boolean;
  /** La retourner au siège : toujours, tant qu'elle est reçue. */
  retourner: true;
}

/**
 * Le retour au siège vient du circuit, jamais de l'envoi au comptable :
 * sans cabinet engagé, ou après « Garder », la pièce reçue se retourne
 * encore (revue Codex de #146). `null` pour qui ne la reçoit pas.
 */
export function carteDuRecu(
  g: GestesDuCircuit | null,
  reste: EtapeDeDemande | null,
): CarteDuRecu | null {
  if (!g?.retournerAuSiege) return null;
  // L'envoi au comptable : le seul prédicat (`resteAEnvoyer`).
  return { envoyerAuComptable: reste === "cabinet", retourner: true };
}

/**
 * CE QUI RESTE À ENVOYER — le seul prédicat (revue Codex de #146).
 *
 * L'envoi en lot, son compte (« N pièces ne sont pas encore parties »), la
 * pièce suivante à décider, Mon espace et la fin de la capture le lisent tous :
 * une pièce reste à envoyer si la fiche y propose « Envoyer »
 * (`gestesDuCircuit`), et, vers le comptable, que la décision de la garder
 * n'est pas en vigueur — un bouton de masse ne défait pas une décision. Rend la destination, ou
 * `null`. Une pièce retournée au siège n'y est donc jamais pour le propriétaire.
 */
export function resteAEnvoyer(
  p: FaitsDeLaPiece,
  droits: readonly Droit[],
  aUnCabinet: boolean,
): EtapeDeDemande | null {
  const faits = { ...p, gardeeLe: p.gardeeLe ?? null, circuit: p.circuit ?? null };
  const vers = gestesDuCircuit(
    { ...faits, statut: statutDuCircuit(faits) },
    droits,
    aUnCabinet,
  ).envoyer;
  // La décision de garder porte sur l'envoi au comptable, et le lot ne la
  // défait pas ; elle ne retient pas le siège, qui envoie au propriétaire.
  return vers === "cabinet" && p.gardeeLe ? null : vers;
}

/** L'état d'une demande, tel que la personne qui l'a faite le lit. */
export interface EtatDeMaDemande {
  fait: EtatDeDemande["fait"];
  note: string | null;
  createdAt: string;
  /**
   * Accordée par le propriétaire sur une pièce déjà chez le comptable : la
   * demande y est partie (« Demande transmise à {cabinet} »), et c'est
   * désormais la réponse du comptable que la personne attend.
   */
  transmise: boolean;
}

/**
 * MA demande, à l'étape où je la fais, d'après l'état que la base lit par
 * étape (`collab.etatDesDemandes`). Transmise, c'est l'étape « cabinet » qui
 * répond : la base le dit par un fait, l'écran ne compare aucune heure (revue
 * Codex de #146).
 */
export function etatDeMaDemande(
  etats: readonly EtatDeDemande[],
  objet: DemandeSurPiece,
  etape: EtapeDeDemande | null,
): EtatDeMaDemande | null {
  if (!etape) return null;
  const a = (e: EtapeDeDemande) => etats.find((x) => x.objet === objet && x.etape === e);
  const mienne = a(etape);
  if (!mienne) return null;
  const auComptable = mienne.transmise ? a("cabinet") : undefined;
  const lue = auComptable ?? mienne;
  return {
    fait: lue.fait,
    note: lue.note,
    createdAt: lue.createdAt,
    transmise: Boolean(auComptable),
  };
}

/**
 * La demande d'un siège qui attend le propriétaire : son objet, ou rien. Le
 * propriétaire tranche ; l'écran ne la montre qu'à qui reçoit.
 */
export function demandeDuSiegeATrancher(
  etats: readonly EtatDeDemande[],
  droits: readonly Droit[],
): DemandeSurPiece | null {
  if (!a(droits, "circuit.recevoir")) return null;
  return (
    OBJETS.find((o) =>
      etats.some((e) => e.objet === o && e.etape === "proprietaire" && e.fait === "demandee"),
    ) ?? null
  );
}
