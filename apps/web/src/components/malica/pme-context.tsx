import { createContext, useContext, useEffect, type ReactNode } from "react";

import type { MonForfait } from "@malica/socle/ports/repositories";

import type { OuverturesDuForfait } from "@/lib/forfait";
import type { ElementDeFile } from "@/lib/hors-ligne/file";
import { dossierDuJournal } from "@/lib/journal-atelier";

export type CaptureKind = "photo" | "images" | "pdf";

/** Ce qui attend de partir pour ce dossier, et les deux gestes sur un échec. */
export interface FileDAttente {
  elements: ReadonlyArray<ElementDeFile>;
  reessayer: (cle: string) => void;
  abandonner: (cle: string) => void;
}

/**
 * Le forfait tel que les écrans en ont besoin : la ligne, ce qu'elle ouvre, et
 * la RAISON de son absence.
 *
 * Les trois états se disent différemment, et c'est tout l'intérêt de les
 * distinguer : on ne sait pas encore (rien à dire), l'appel a échoué (« le
 * compteur n'est pas lu »), il n'y a pas de licence (« pas encore
 * d'abonnement »). Un seul « — » pour les trois ferait conclure à une panne
 * là où il n'y en a pas.
 */
interface ForfaitDuContexte {
  /** La ligne, ou `null` : pas de licence sur ce compte, ou pas encore lue. */
  ligne: MonForfait | null;
  /** La première lecture est en cours. Rien n'est encore vrai ni faux. */
  enCours: boolean;
  /** L'appel a échoué. Les lectures du mois, elles, n'ont pas bougé. */
  illisible: boolean;
  /** Ce que l'offre ouvre — calculé À UN SEUL ENDROIT (`lib/forfait.ts`). */
  ouvertures: OuverturesDuForfait;
}

export interface PmeContextValue {
  tenantId: string;
  entityId: string | null;
  jurisdiction: string;
  currency: string;
  packId: string | null;
  orgName: string;
  /**
   * Le matricule fiscal du dossier.
   *
   * Il descend du shell parce que le reçu de paiement le porte en mention
   * obligatoire : sans lui, le Socle refuse de produire le document plutôt
   * que de le fabriquer à moitié.
   */
  matricule: string | null;
  /**
   * Les dossiers de cet utilisateur, et de quoi en changer.
   *
   * Ils descendent du shell parce que l'accueil porte désormais le bandeau :
   * il doit pouvoir proposer le changement de dossier sans redemander la liste
   * à l'API, que le shell a déjà.
   */
  dossiers: ReadonlyArray<{ id: string; name: string }>;
  choisirDossier: (id: string) => void;
  /** Vrai si ce compte suit aussi un cabinet — sinon la bascule n'a nulle part où aller. */
  aUnCabinet: boolean;
  /** Geste cœur : un tap, moins de dix secondes. Piloté par le shell. */
  capture: (kind: CaptureKind) => void;
  /**
   * Rouvrir l'appareil photo depuis n'importe quel écran.
   *
   * Le numériseur vit dans la coque ; sans ce geste, « corriger » depuis une
   * pièce obligerait à revenir à l'accueil pour retrouver l'obturateur.
   */
  ouvrirScanner: () => void;
  capturing: boolean;
  captureError: string | null;
  /** La file hors ligne de ce dossier : ce que la liste et l'accueil montrent. */
  file: FileDAttente;
  /**
   * L'ABONNEMENT, LU UNE FOIS.
   *
   * La règle du câblage est explicite : « un écran lit
   * `facturation.monForfait` une fois, au niveau du layout `pme.tsx`, et le
   * passe par contexte. Aucun écran n'appelle deux fois. » Elle n'était pas
   * appliquée — trois écrans l'appelaient chacun pour soi, sur deux clés de
   * cache différentes, avec deux règles de dégradation divergentes.
   *
   * La licence appartient à la PERSONNE, pas au dossier : rien ici ne porte
   * `tenantId`, et changer de société ne change pas le forfait.
   */
  forfait: ForfaitDuContexte;
}

const PmeContext = createContext<PmeContextValue | null>(null);

export function PmeProvider({ value, children }: { value: PmeContextValue; children: ReactNode }) {
  /*
   * ====================== LE DOSSIER, REMIS AU JOURNAL DES PANNES — UNE SEULE FOIS
   *
   * `audit.journal_client` est sous RLS de dossier : consigner une panne
   * demande de dire dans quel dossier on écrit. Le journal n'a pas de contexte
   * React — il est appelé depuis des `catch`, parfois hors de tout composant —
   * et c'est donc ici, au seul endroit qui connaît le dossier courant, qu'il
   * l'apprend. Il l'oublie au démontage : une panne survenue après la
   * déconnexion n'appartient à personne.
   */
  useEffect(() => {
    dossierDuJournal(value.tenantId);
    return () => dossierDuJournal(null);
  }, [value.tenantId]);

  return <PmeContext.Provider value={value}>{children}</PmeContext.Provider>;
}

export function usePme(): PmeContextValue {
  const value = useContext(PmeContext);
  if (!value) throw new Error("usePme hors du contexte PME");
  return value;
}
