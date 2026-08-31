import { createContext, useContext, type ReactNode } from "react";

export type CaptureKind = "photo" | "pdf";

export interface PmeContextValue {
  tenantId: string;
  entityId: string | null;
  jurisdiction: string;
  currency: string;
  packId: string | null;
  orgName: string;
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
