// @vitest-environment jsdom
/**
 * La carte « Facturation automatique » de la tour (4 novembre 2026) : l'écran
 * montre ce que la base rend — l'état, depuis quand, par qui, le motif, et le
 * dernier passage —, colore par fonction, et transmet le geste tel quel. Il
 * ne part jamais sans motif, ni avec un rattrapage de moins d'un mois.
 */
import type { EtatFacturationAuto } from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));

const COUPEE: EtatFacturationAuto = {
  reglage: {
    actif: false,
    rattrapage_mois: 1,
    motif: "Livrée coupée",
    decide_le: "2026-11-04T00:00:00.000Z",
    decide_par_email: null,
    decide_par_nom: null,
  },
  dernier: null,
};
const OUVERTE: EtatFacturationAuto = {
  reglage: {
    actif: true,
    rattrapage_mois: 2,
    motif: "Staging : premier essai",
    decide_le: "2026-11-05T08:00:00.000Z",
    decide_par_email: "wissem@essai.local",
    decide_par_nom: "Wissem",
  },
  dernier: {
    jour: "2026-11-05",
    passee_le: "2026-11-05T08:10:00.000Z",
    emises: 4,
    deja_emises: 1,
    rien_a_facturer: 2,
    erreurs: 1,
    detail_erreurs: [
      { licence: "l1", periode: "2026-10-01", cle: "refus.referentiel.manquant", etat: "P0002" },
    ],
  },
};

let etat: EtatFacturationAuto = COUPEE;
const regler = vi.fn(async () => ({}));
const enAttente = () => new Promise(() => undefined);

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    tour: new Proxy(
      {
        reglageFacturationAuto: async () => etat,
        reglerFacturationAuto: regler,
      } as Record<string, unknown>,
      { get: (cible, nom: string) => cible[nom] ?? enAttente },
    ),
  }),
}));

import { LaFacturationAutomatique } from "../tour/facturation-automatique";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function carte(e: EtatFacturationAuto) {
  etat = e;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LaFacturationAutomatique />
    </QueryClientProvider>,
  );
  const c = await waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-facturation-auto]");
    if (!el?.querySelector("[data-etat]")) throw new Error("carte absente");
    return el;
  });
  return c;
}

describe("la carte de la facturation automatique", () => {
  it("dit l'état livré : coupée, décidée à la livraison, le motif, aucun passage", async () => {
    const c = await carte(COUPEE);
    const etatAffiche = c.querySelector("[data-etat]")!;
    expect(etatAffiche.textContent).toContain("tour.facturation.etat.coupee");
    expect(etatAffiche.className).not.toContain("text-signal-ok");
    expect(c.querySelector("[data-par]")!.textContent).toBe("tour.facturation.parLaLivraison");
    expect(c.querySelector("[data-motif]")!.textContent).toContain("Livrée coupée");
    expect(within(c).getByText("tour.facturation.dernier.aucun")).toBeTruthy();
    expect(within(c).getByRole("button", { name: "tour.facturation.ouvrir" })).toBeTruthy();
  });

  it("ouvre sans motif : jamais ; avec motif : transmet tel quel", async () => {
    const c = await carte(COUPEE);
    const ouvrir = within(c).getByRole<HTMLButtonElement>("button", {
      name: "tour.facturation.ouvrir",
    });
    expect(ouvrir.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("common.motif"), { target: { value: "   " } });
    expect(ouvrir.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("common.motif"), {
      target: { value: "Staging : premier essai" },
    });
    expect(ouvrir.disabled).toBe(false);
    fireEvent.click(ouvrir);
    await waitFor(() => expect(regler).toHaveBeenCalledTimes(1));
    expect(regler).toHaveBeenCalledWith(true, 1, "Staging : premier essai");
  });

  it("un rattrapage de moins d'un mois se dit, et bloque l'envoi", async () => {
    const c = await carte(COUPEE);
    fireEvent.change(within(c).getByLabelText("common.motif"), { target: { value: "essai" } });
    fireEvent.change(within(c).getByLabelText("tour.facturation.rattrapage"), {
      target: { value: "0" },
    });
    expect(within(c).getByText("tour.facturation.invalide")).toBeTruthy();
    expect(
      within(c).getByRole<HTMLButtonElement>("button", { name: "tour.facturation.ouvrir" })
        .disabled,
    ).toBe(true);
  });

  it("ouverte : depuis quand, par qui, le dernier passage ; les erreurs en vermillon ; couper se motive", async () => {
    const c = await carte(OUVERTE);
    const etatAffiche = c.querySelector("[data-etat]")!;
    expect(etatAffiche.textContent).toContain("tour.facturation.etat.ouverte");
    expect(etatAffiche.className).toContain("text-signal-ok");
    expect(c.querySelector("[data-par]")!.textContent).toContain("Wissem");
    expect(within(c).getByLabelText<HTMLInputElement>("tour.facturation.rattrapage").value).toBe(
      "2",
    );
    const erreurs = c.querySelector('[data-compteur="tour.facturation.compteur.erreurs"]')!;
    expect(erreurs.querySelector(".text-signal-stop")?.textContent).toBe("1");
    const emises = c.querySelector('[data-compteur="tour.facturation.compteur.emises"]')!;
    expect(emises.textContent).toContain("4");
    expect(c.querySelector("[data-erreur]")!.textContent).toContain("refus.referentiel.manquant");

    const couper = within(c).getByRole<HTMLButtonElement>("button", {
      name: "tour.facturation.couper",
    });
    expect(couper.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText("common.motif"), {
      target: { value: "Incident d'émetteur" },
    });
    fireEvent.click(couper);
    await waitFor(() => expect(regler).toHaveBeenCalledWith(false, 2, "Incident d'émetteur"));
  });
});
