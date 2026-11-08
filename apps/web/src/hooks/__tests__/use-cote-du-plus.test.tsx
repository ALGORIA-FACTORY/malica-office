// @vitest-environment jsdom
/**
 * Le côté du « + » : la barre du bas et le réglage ont chacun leur instance du
 * crochet. Choisir dans l'un se voit aussitôt dans l'autre — y compris pour un
 * compte qui n'a encore aucun profil (revue de #275).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ lire: vi.fn(), ecrire: vi.fn() }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ identity: { monProfil: api.lire, ecrireCoteDuPlus: api.ecrire } }),
}));

import { useCoteDuPlus } from "../use-cote-du-plus";

beforeEach(() => {
  window.localStorage.clear();
  api.lire.mockReset();
  api.ecrire.mockReset();
});

function deuxInstances() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const enveloppe = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const barre = renderHook(() => useCoteDuPlus(), { wrapper: enveloppe });
  const reglage = renderHook(() => useCoteDuPlus(), { wrapper: enveloppe });
  return { barre, reglage };
}

describe("le côté du « + »", () => {
  it("à droite par défaut", async () => {
    api.lire.mockResolvedValue(null);
    const { barre } = deuxInstances();
    await waitFor(() => expect(api.lire).toHaveBeenCalled());
    expect(barre.result.current.cote).toBe("droite");
  });

  it("sans profil encore, le choix du réglage passe aussitôt à la barre", async () => {
    api.lire.mockResolvedValue(null);
    api.ecrire.mockImplementation(async (c: string) => {
      api.lire.mockResolvedValue({ prenom: null, nom: null, display_name: null, cote_du_plus: c });
      return c;
    });
    const { barre, reglage } = deuxInstances();
    await waitFor(() => expect(api.lire).toHaveBeenCalled());
    act(() => reglage.result.current.choisir("gauche"));
    await waitFor(() => expect(barre.result.current.cote).toBe("gauche"));
    expect(window.localStorage.getItem("malica.cote-du-plus")).toBe("gauche");
  });

  it("un échec d'écriture remet le côté d'avant", async () => {
    api.lire.mockResolvedValue({
      prenom: "Amel",
      nom: null,
      display_name: "Amel",
      cote_du_plus: "droite",
    });
    api.ecrire.mockRejectedValue(new Error("réseau"));
    const { barre, reglage } = deuxInstances();
    await waitFor(() => expect(barre.result.current.cote).toBe("droite"));
    act(() => reglage.result.current.choisir("gauche"));
    await waitFor(() => expect(api.ecrire).toHaveBeenCalled());
    await waitFor(() => expect(barre.result.current.cote).toBe("droite"));
  });
});
