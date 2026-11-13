// @vitest-environment jsdom
/**
 * Sous « Toutes », la plus basse des lectures ; dès qu'une société est choisie, plus rien : une
 * requête désactivée garde pourtant ses données en cache, et elles ne doivent pas se lire.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    dossiers: [
      { id: "a", name: "Atelier" },
      { id: "m", name: "Medina" },
    ],
  }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    facturation: {
      monForfait: async (id: string) => ({
        lectures_restantes: id === "m" ? 4 : 30,
        lectures_droit: 30,
      }),
    },
  }),
}));

import { useLaPlusBasseDesLectures } from "../use-lectures-des-societes";

describe("useLaPlusBasseDesLectures", () => {
  it("rend la plus basse sous « Toutes », puis null une fois une société choisie", async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result, rerender } = renderHook(({ actif }) => useLaPlusBasseDesLectures(actif), {
      wrapper,
      initialProps: { actif: true },
    });
    await waitFor(() => expect(result.current?.id).toBe("m"));
    rerender({ actif: false });
    expect(result.current).toBeNull();
  });
});
