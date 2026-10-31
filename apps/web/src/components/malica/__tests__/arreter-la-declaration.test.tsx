// @vitest-environment jsdom
/**
 * Arrêter la déclaration de TVA (revue Codex de #145) : après un premier
 * enregistrement, la confirmation masquait les boutons POUR TOUJOURS — le
 * composant reste monté quand on change de choix ou de mois. Un nouveau choix,
 * un autre mois ou un autre dossier rendent les boutons.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeclarationTva } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ arreter: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ parametrage: { arreterDeclarationTva: api.arreter } }),
}));

import { ArreterLaDeclaration } from "../arreter-la-declaration";

const declaration: DeclarationTva = {
  natureParDefaut: "AUTRE",
  natures: [
    { code: "IMMO", label: "Immobilisations" },
    { code: "AUTRE", label: "Autres" },
  ],
  lignes: [
    {
      code: "L_IMMO",
      label: "Sur immo",
      sens: "deductible",
      nature: "IMMO",
      ordinal: 1,
      incertain: true,
    },
    {
      code: "L_AUTRE",
      label: "Sur le reste",
      sens: "deductible",
      nature: "AUTRE",
      ordinal: 2,
      incertain: true,
    },
  ],
  affectations: [
    { sens: "deductible", nature: "IMMO", ligne: "L_IMMO", origine: "pack", decideLe: null },
    { sens: "deductible", nature: "AUTRE", ligne: "L_AUTRE", origine: "pack", decideLe: null },
  ],
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const vue = (periode: string, dossierId = "d1") => (
  <QueryClientProvider client={client}>
    <ArreterLaDeclaration
      cabinetId="c1"
      dossierId={dossierId}
      packId="p1"
      periode={periode}
      declaration={declaration}
    />
  </QueryClientProvider>
);
const pourCeDossier = () => screen.findByRole("button", { name: "tva.affectation.pourLeDossier" });
const enregistrer = async () => {
  fireEvent.click(await pourCeDossier());
  await screen.findByText("tva.affectation.arretee");
};

describe("arrêter la déclaration de TVA", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.arreter.mockResolvedValue({ decisions: 2 });
  });
  afterEach(cleanup);

  it("enregistrer, changer un choix, enregistrer encore", async () => {
    render(vue("2026-10"));
    await enregistrer();
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "L_AUTRE" } });
    await enregistrer();
    expect(api.arreter).toHaveBeenCalledTimes(2);
    expect(api.arreter.mock.calls[1]![0].affectations[0]).toEqual({
      sens: "deductible",
      nature: "IMMO",
      ligne: "L_AUTRE",
    });
  });

  it("enregistrer, changer de mois, enregistrer encore — à partir de ce mois", async () => {
    const { rerender } = render(vue("2026-10"));
    await enregistrer();
    rerender(vue("2026-11"));
    await enregistrer();
    expect(api.arreter).toHaveBeenCalledTimes(2);
    expect(api.arreter.mock.calls[1]![0].depuis).toBe("2026-11-01");
  });

  it("enregistrer, changer de dossier : les boutons reviennent", async () => {
    const { rerender } = render(vue("2026-10"));
    await enregistrer();
    rerender(vue("2026-10", "d2"));
    expect(await pourCeDossier()).toBeTruthy();
  });
});
