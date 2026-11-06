// @vitest-environment jsdom
/**
 * L'avis des lignes à vérifier (décision du 5 novembre 2026) : il parle quand le lecteur
 * prouvé a inscrit des cellules de lignes SIGNALÉES, et se tait sinon.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `vi.mock` est remonté en tête du module : la fausse fonction l'est avec lui.
const { lectureObservee } = vi.hoisted(() => ({ lectureObservee: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "fr" }),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ capture: { lectureObservee } }),
}));

import { LignesAVerifier } from "../lignes-a-verifier";

const champ = (rang: number | null, statut: string) => ({
  champ: rang === null ? "total_ht" : "designation",
  libelle: "x",
  rang,
  valeur: "1",
  statut,
  role: null,
  famille: null,
});

function monter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LignesAVerifier pieceId="p1" />
    </QueryClientProvider>,
  );
}

describe("LignesAVerifier", () => {
  it("dit « à vérifier » quand une cellule de ligne est signalée", async () => {
    lectureObservee.mockResolvedValue({
      issue: "prouvee",
      champs: [champ(null, "prouve"), champ(0, "signale")],
    });
    monter();
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("se tait quand les lignes sont prouvées", async () => {
    lectureObservee.mockResolvedValue({
      issue: "prouvee",
      champs: [champ(null, "prouve"), champ(0, "prouve")],
    });
    const { container } = monter();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[role=status]")).toBeNull();
  });
});
