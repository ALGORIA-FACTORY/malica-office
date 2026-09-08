import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Organization } from "@malica/socle/ports/repositories";

interface CabinetValue {
  org: Organization;
  panel: ReactNode | null;
  setPanel: (node: ReactNode | null) => void;
}

const CabinetContext = createContext<CabinetValue | null>(null);

export function CabinetProvider({
  org,
  children,
  render,
}: {
  org: Organization;
  children?: ReactNode;
  render: (value: CabinetValue) => ReactNode;
}) {
  const [panel, setPanel] = useState<ReactNode | null>(null);
  const value = useMemo<CabinetValue>(() => ({ org, panel, setPanel }), [org, panel]);
  return (
    <CabinetContext.Provider value={value}>
      {render(value)}
      {children}
    </CabinetContext.Provider>
  );
}

export function useCabinet(): CabinetValue {
  const ctx = useContext(CabinetContext);
  if (!ctx) throw new Error("useCabinet doit être utilisé dans CabinetProvider");
  return ctx;
}

/** Chaque écran déclare la parole de Malica affichée dans la colonne de droite. */
export function useMalicaPanel(node: ReactNode, deps: unknown[] = []): void {
  const { setPanel } = useCabinet();
  useEffect(() => {
    setPanel(node);
    return () => setPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
