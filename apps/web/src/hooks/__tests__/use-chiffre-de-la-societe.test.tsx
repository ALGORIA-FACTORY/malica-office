// @vitest-environment jsdom
/**
 * Le total des charges de l'accueil au bureau : la lecture de l'écran Charges pour la société
 * ouverte (`chiffreCharges`, le moteur du Socle), sous la même clé que sa ligne de « Toutes les
 * sociétés » — un seul appel quand les deux sont montés —, et aucune lecture sur le téléphone.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({
    tenantId: "z",
    jurisdiction: "TN",
    currency: "TND",
    dossiers: [{ id: "z", name: "SOTUMAG SARL", jurisdiction: "TN", currency: "TND" }],
  }),
}));
const chiffres = vi.hoisted(() => ({ tva: vi.fn(), charges: vi.fn() }));
vi.mock("@/lib/chiffre-par-societe", () => ({
  chiffreTva: chiffres.tva,
  chiffreCharges: chiffres.charges,
}));

import { useChiffreDeLaSociete, useChiffresParSociete } from "../use-chiffres-par-societe";

function enveloppe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useChiffreDeLaSociete", () => {
  it("rend le total HT du mois que l'écran Charges lit pour la société ouverte", async () => {
    chiffres.charges.mockResolvedValue({ etat: "calcule", montant: "400.000", devise: "TND" });
    const { result } = renderHook(() => useChiffreDeLaSociete("charges", "2026-07"), {
      wrapper: enveloppe(),
    });
    expect(result.current).toEqual({ etat: "enCours" });
    await waitFor(() =>
      expect(result.current).toEqual({ etat: "calcule", montant: "400.000", devise: "TND" }),
    );
    expect(chiffres.charges).toHaveBeenCalledWith(
      { id: "z", jurisdiction: "TN", currency: "TND" },
      "2026-07",
      "fr",
    );
  });

  it("partage la lecture de la ligne « Toutes les sociétés » : un seul appel", async () => {
    chiffres.charges.mockResolvedValue({ etat: "calcule", montant: "400.000", devise: "TND" });
    const { result } = renderHook(
      () => ({
        une: useChiffreDeLaSociete("charges", "2026-07"),
        toutes: useChiffresParSociete("charges", "2026-07"),
      }),
      { wrapper: enveloppe() },
    );
    await waitFor(() => expect(result.current.une).toMatchObject({ etat: "calcule" }));
    expect(result.current.toutes.get("z")).toEqual(result.current.une);
    expect(chiffres.charges).toHaveBeenCalledTimes(1);
  });

  it("inactive (téléphone), ne lit rien ; en échec, dit « illisible », jamais zéro", async () => {
    const inactif = renderHook(() => useChiffreDeLaSociete("charges", "2026-07", false), {
      wrapper: enveloppe(),
    });
    expect(inactif.result.current).toEqual({ etat: "enCours" });
    expect(chiffres.charges).not.toHaveBeenCalled();

    chiffres.charges.mockRejectedValue(new Error("refus"));
    const { result } = renderHook(() => useChiffreDeLaSociete("charges", "2026-07"), {
      wrapper: enveloppe(),
    });
    await waitFor(() => expect(result.current).toEqual({ etat: "illisible" }));
  });
});
