// @vitest-environment jsdom
/**
 * Changer de comptabilité en un seul geste (recette du 11 novembre 2026,
 * 3.2) : quand une autre comptabilité est mandatée, le bouton dit « Accepter
 * et quitter [ancienne] » et exige le motif qu'elle lira.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MandatPropose } from "@malica/socle/ports/repositories";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, valeurs?: Record<string, string>) =>
      valeurs ? `${cle} ${Object.values(valeurs).join(" ")}` : cle,
    locale: "fr",
    dir: "ltr",
  }),
}));
vi.mock("../office-ui", () => ({ MalicaAvatar: () => null }));
let proposes: MandatPropose[] = [];
const repondre = vi.fn(async () => ({ id: "n", status: "actif" }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    identity: {
      mandatsProposesDesSocietes: async () => ({ pme: proposes }),
      repondreAuMandat: repondre,
    },
  }),
}));

import { MandatsProposesDesSocietes } from "../MandatsProposes";

const ouvrir = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MandatsProposesDesSocietes societes={[{ id: "pme", name: "Société" }]} nommer={false} />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  repondre.mockClear();
});

describe("accepter un mandat", () => {
  it("sans comptabilité en cours : « Accepter le mandat », sans motif", async () => {
    proposes = [
      {
        id: "n",
        cabinetTenantId: "c",
        cabinet: "Compta Nouvelle",
        proposeLe: "2026-11-12",
        remplace: null,
      },
    ];
    ouvrir();
    fireEvent.click(await screen.findByRole("button", { name: "pme.mandat.accepter" }));
    await waitFor(() => expect(repondre).toHaveBeenCalledWith("n", true, null));
  });

  it("avec une comptabilité en cours : « Accepter et quitter », le motif exigé", async () => {
    proposes = [
      {
        id: "n",
        cabinetTenantId: "c",
        cabinet: "Compta Nouvelle",
        proposeLe: "2026-11-12",
        remplace: "Compta Ancienne",
      },
    ];
    ouvrir();
    const bouton = await screen.findByRole("button", {
      name: "pme.mandat.accepterEtQuitter Compta Ancienne",
    });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Plus proche" } });
    fireEvent.click(bouton);
    await waitFor(() => expect(repondre).toHaveBeenCalledWith("n", true, "Plus proche"));
  });
});
