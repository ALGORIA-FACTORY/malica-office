import { createContext, useContext, type ReactNode } from "react";

export type CaptureKind = "photo" | "pdf";

export interface PmeContextValue {
  tenantId: string;
  entityId: string | null;
  jurisdiction: string;
  currency: string;
  packId: string | null;
  orgName: string;
  /** Geste cœur : un tap, moins de dix secondes. Piloté par le shell. */
  capture: (kind: CaptureKind) => void;
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
