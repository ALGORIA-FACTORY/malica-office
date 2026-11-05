// @vitest-environment jsdom
/**
 * La carte « Accès total » de la tour (5 novembre 2026) : elle montre qui a
 * l'accès total, depuis quand, pourquoi et qui l'a donné, dit en alerte un
 * accès qui ne s'exerce plus, et transmet l'accord et le retrait tels quels.
 * Aucun des deux ne part sans motif ; l'accord, pas sans adresse.
 */
import type { AccesTotalEnVigueur } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));

const ACCORDE: AccesTotalEnVigueur = {
  user_id: "u1",
  email: "dirigeant@essai.local",
  nom: "Dirigeant",
  depuis: "2026-11-05T09:00:00.000Z",
  motif: "Décision du 5 novembre",
  par_email: "operateur@essai.local",
  operateur: true,
};

let liste: AccesTotalEnVigueur[] = [];
const accorder = vi.fn(async () => ({}));
const retirer = vi.fn(async () => ({}));

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    tour: {
      accesTotal: async () => liste,
      accorderAccesTotal: accorder,
      retirerAccesTotal: retirer,
    },
  }),
}));

import { LAccesTotal } from "../tour/acces-total";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function carte(l: AccesTotalEnVigueur[]) {
  liste = l;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LAccesTotal />
    </QueryClientProvider>,
  );
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-acces-total]");
    if (!el || !(el.querySelector("[data-aucun]") || el.querySelector("[data-acces]")))
      throw new Error("carte absente");
    return el;
  });
}

describe("la carte de l'accès total", () => {
  it("sans accès accordé, le dit", async () => {
    const c = await carte([]);
    expect(within(c).getByText("tour.acces.aucun")).toBeTruthy();
  });

  it("dit qui, depuis quand, par qui et pourquoi ; un accès sans opérateur est en alerte", async () => {
    const c = await carte([
      ACCORDE,
      { ...ACCORDE, user_id: "u2", email: "x@essai.local", operateur: false },
    ]);
    const [actif, eteint] = [...c.querySelectorAll<HTMLElement>("[data-acces]")];
    expect(actif!.textContent).toContain("dirigeant@essai.local");
    expect(actif!.textContent).toContain("operateur@essai.local");
    expect(actif!.textContent).toContain("Décision du 5 novembre");
    expect(within(actif!).queryByText("tour.acces.inactif")).toBeNull();
    expect(within(eteint!).getByText("tour.acces.inactif").className).toContain("text-signal-warn");
  });

  it("accorde avec une adresse et un motif, jamais sans", async () => {
    const c = await carte([]);
    const bouton = within(c).getByRole<HTMLButtonElement>("button", {
      name: "tour.acces.accorder",
    });
    expect(bouton.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("tour.acces.email"), {
      target: { value: " dirigeant@essai.local " },
    });
    expect(bouton.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("common.motif"), {
      target: { value: "Décision du 5 novembre" },
    });
    expect(bouton.disabled).toBe(false);
    fireEvent.click(bouton);
    await waitFor(() =>
      expect(accorder).toHaveBeenCalledWith("dirigeant@essai.local", "Décision du 5 novembre"),
    );
  });

  it("retire, motif à l'appui, la personne de sa ligne", async () => {
    const c = await carte([ACCORDE]);
    const ligne = c.querySelector<HTMLElement>("[data-acces]")!;
    const bouton = within(ligne).getByRole<HTMLButtonElement>("button", {
      name: "tour.acces.retirer",
    });
    expect(bouton.disabled).toBe(true);
    fireEvent.change(within(ligne).getByLabelText("common.motif"), {
      target: { value: "Fin de mission" },
    });
    fireEvent.click(bouton);
    await waitFor(() => expect(retirer).toHaveBeenCalledWith("u1", "Fin de mission"));
  });
});
