import { createContext, useContext, type ReactNode } from "react";

import type { ElementDeFile } from "@/lib/hors-ligne/file";

export type CaptureKind = "photo" | "pdf";

/** Ce qui attend de partir pour ce dossier, et les deux gestes sur un échec. */
export interface FileDAttente {
  elements: ReadonlyArray<ElementDeFile>;
  reessayer: (cle: string) => void;
  abandonner: (cle: string) => void;
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
}

const PmeContext = createContext<PmeContextValue | null>(null);

export function PmeProvider({ value, children }: { value: PmeContextValue; children: ReactNode }) {
  return <PmeContext.Provider value={value}>{children}</PmeContext.Provider>;
}

export function usePme(): PmeContextValue {
  const value = useContext(PmeContext);
  if (!value) throw new Error("usePme hors du contexte PME");
  return value;
}
