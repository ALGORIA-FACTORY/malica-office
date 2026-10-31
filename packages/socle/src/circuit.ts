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
import type { CircuitInterne, StatutDuCircuit } from "./statut-d-envoi.ts";

const OBJETS: readonly DemandeSurPiece[] = ["rappel", "suppression"];

export interface PieceDuCircuit {
  vis: Visibility;
  status: string;
  gardeeLe: string | null;
  statut: StatutDuCircuit;
  circuit: CircuitInterne | null;
}

export interface GestesDuCircuit {
  /** « Envoyer » : au propriétaire (le siège), au comptable, ou rien ici. */
  envoyer: EtapeDeDemande | null;
  /** « Garder » : décider de ne pas l'envoyer au comptable. */
  garder: boolean;
  /** Le propriétaire retourne au siège la pièce qu'il en a reçue. */
  retournerAuSiege: boolean;
  /** Ouvrir la pièce la « voit » : le propriétaire, pièce reçue d'un siège. */
  voirALOuverture: boolean;
  /** À qui se demande un rappel ou une suppression, ou rien. */
  demanderA: EtapeDeDemande | null;
  /** « Renvoyer » sur la carte de retour est le geste de cette personne. */
  renvoyer: boolean;
  /** « Garder » sur la carte d'un retour du comptable. */
  garderLeRetour: boolean;
  /** La rendre à Mon espace : la sienne, qui n'est pas en route. */
  mettreAuPrive: boolean;
  /** La supprimer sans rien demander. */
  supprimer: boolean;
}

const a = (droits: readonly Droit[], d: Droit) => droits.includes(d);

export function gestesDuCircuit(
  p: PieceDuCircuit,
  droits: readonly Droit[],
  aUnCabinet: boolean,
): GestesDuCircuit {
  const versLeComptable = a(droits, "envoi.cabinet");
  const versLeProprietaire = a(droits, "envoi.proprietaire");
  const recoit = a(droits, "circuit.recevoir");
  const dernier = p.circuit?.dernier ?? null;
  const mienne = p.circuit?.mienne ?? false;
  const enRoute = dernier === "envoyee" || dernier === "retournee";
  const retour = p.statut.statut === "retour";
  const libre = p.status === "capturee" || p.status === "lue";
  // Retournée au siège : la main est à lui. Le propriétaire attend sa
  // reprise ; il n'envoie ni ne garde ce qu'il vient de lui rendre.
  const chezLeSiege = p.statut.chez === "siege";

  const envoyer: EtapeDeDemande | null =
    p.vis !== "entite" || chezLeSiege
      ? null
      : versLeComptable
        ? aUnCabinet
          ? "cabinet"
          : null
        : versLeProprietaire && p.statut.statut === "a_envoyer"
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

  return {
    envoyer,
    garder:
      a(droits, "piece.garder") && aUnCabinet && p.vis === "entite" && !p.gardeeLe && !chezLeSiege,
    retournerAuSiege: recoit && p.vis === "entite" && dernier === "envoyee",
    voirALOuverture:
      recoit &&
      p.vis === "entite" &&
      (p.statut.statut === "recue" || p.statut.statut === "corrigee"),
    demanderA,
    renvoyer: retour && (p.statut.chez === "proprietaire" ? versLeProprietaire : versLeComptable),
    garderLeRetour: retour && p.statut.chez === "cabinet" && a(droits, "piece.garder"),
    mettreAuPrive: p.vis === "entite" && mienne && !enRoute,
    supprimer:
      libre &&
      (p.vis === "personnel" ||
        (p.vis === "entite" &&
          (a(droits, "piece.supprimer_toutes") || (mienne && dernier !== "envoyee")))),
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
  gardeeLe: string | null,
): CarteDuRecu | null {
  if (!g?.retournerAuSiege) return null;
  return { envoyerAuComptable: g.envoyer === "cabinet" && !gardeeLe, retourner: true };
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
