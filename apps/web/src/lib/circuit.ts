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
  FaitDeDemande,
  Visibility,
} from "@malica/socle/ports/repositories";
import type { CircuitInterne, StatutDuCircuit } from "@malica/socle/statut-d-envoi";

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

  const envoyer: EtapeDeDemande | null =
    p.vis !== "entite"
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
    garder: a(droits, "piece.garder") && aUnCabinet && p.vis === "entite" && !p.gardeeLe,
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

/** L'état d'une demande, tel que la personne qui l'a faite le lit. */
export interface EtatDeMaDemande {
  fait: FaitDeDemande["fait"];
  note: string | null;
  createdAt: string;
  /**
   * Accordée par le propriétaire sur une pièce déjà chez le comptable : la
   * demande y est partie d'elle-même (« Demande transmise à {cabinet} »), et
   * c'est désormais la réponse du comptable que la personne attend.
   */
  transmise: boolean;
}

/**
 * Le dernier fait de MA demande, à l'étape où je la fais. Les faits viennent
 * du plus récent au plus ancien (`collab.demandesDUnePiece`).
 */
export function etatDeMaDemande(
  faits: readonly FaitDeDemande[],
  objet: DemandeSurPiece,
  etape: EtapeDeDemande | null,
): EtatDeMaDemande | null {
  if (!etape) return null;
  const duMeme = faits.filter((f) => f.objet === objet);
  const mienne = duMeme.find((f) => f.etape === etape);
  if (!mienne) return null;
  if (etape === "proprietaire" && mienne.fait === "accordee") {
    const auComptable = duMeme.find(
      (f) => f.etape === "cabinet" && Date.parse(f.createdAt) >= Date.parse(mienne.createdAt),
    );
    if (auComptable)
      return {
        fait: auComptable.fait,
        note: auComptable.note,
        createdAt: auComptable.createdAt,
        transmise: true,
      };
  }
  return { fait: mienne.fait, note: mienne.note, createdAt: mienne.createdAt, transmise: false };
}

/**
 * La demande d'un siège qui attend le propriétaire : son objet, ou rien. Le
 * propriétaire tranche ; l'écran ne la montre qu'à qui reçoit.
 */
export function demandeDuSiegeATrancher(
  faits: readonly FaitDeDemande[],
  droits: readonly Droit[],
): DemandeSurPiece | null {
  if (!a(droits, "circuit.recevoir")) return null;
  return (
    OBJETS.find(
      (o) => faits.find((f) => f.objet === o && f.etape === "proprietaire")?.fait === "demandee",
    ) ?? null
  );
}
