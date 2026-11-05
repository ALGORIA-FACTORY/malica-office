// @vitest-environment jsdom
/**
 * La carte « Facturation automatique » de la tour (4 novembre 2026) : deux
 * périmètres indépendants, les cabinets et les PME. Pour chacun, l'écran
 * montre ce que la base rend — l'état, depuis quand, par qui, le motif, et le
 * dernier passage —, colore par fonction, et transmet le geste tel quel, avec
 * son périmètre. Il ne part jamais sans motif, ni avec un rattrapage de moins
 * d'un.
 */
import type {
  EtatDuPerimetreDeFacturation,
  EtatFacturationAuto,
} from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));

const COUPE: EtatDuPerimetreDeFacturation = {
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
const OUVERT: EtatDuPerimetreDeFacturation = {
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
      { cabinet: "c1", periode: "2026-10-01", cle: "refus.referentiel.manquant", etat: "P0002" },
    ],
  },
};

const LIVREE: EtatFacturationAuto = { cabinets: COUPE, pme: COUPE };
const CABINETS_OUVERTS: EtatFacturationAuto = { cabinets: OUVERT, pme: COUPE };

let etat: EtatFacturationAuto = LIVREE;
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

/** La carte rendue, et ses deux périmètres. */
async function carte(e: EtatFacturationAuto) {
  etat = e;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LaFacturationAutomatique />
    </QueryClientProvider>,
  );
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-facturation-auto]");
    const cabinets = el?.querySelector<HTMLElement>('[data-perimetre="cabinets"]');
    const pme = el?.querySelector<HTMLElement>('[data-perimetre="pme"]');
    if (!cabinets?.querySelector("[data-etat]") || !pme?.querySelector("[data-etat]"))
      throw new Error("carte absente");
    return { cabinets, pme };
  });
}

describe("la carte de la facturation automatique", () => {
  it("dit l'état livré des deux périmètres : coupés, décidés à la livraison, aucun passage", async () => {
    const c = await carte(LIVREE);
    for (const [p, titre] of [
      [c.cabinets, "tour.facturation.cabinets"],
      [c.pme, "tour.facturation.pme"],
    ] as const) {
      expect(within(p).getByText(titre)).toBeTruthy();
      const etatAffiche = p.querySelector("[data-etat]")!;
      expect(etatAffiche.textContent).toContain("tour.facturation.etat.coupee");
      expect(etatAffiche.className).not.toContain("text-signal-ok");
      expect(p.querySelector("[data-par]")!.textContent).toBe("tour.facturation.parLaLivraison");
      expect(p.querySelector("[data-motif]")!.textContent).toContain("Livrée coupée");
      expect(within(p).getByText("tour.facturation.dernier.aucun")).toBeTruthy();
      expect(within(p).getByRole("button", { name: "tour.facturation.ouvrir" })).toBeTruthy();
    }
    expect(within(c.pme).getByLabelText("tour.facturation.pme.rattrapage")).toBeTruthy();
    expect(within(c.cabinets).getByLabelText("tour.facturation.cabinets.rattrapage")).toBeTruthy();
  });

  it("ouvre sans motif : jamais ; avec motif : transmet tel quel, avec SON périmètre", async () => {
    const c = await carte(LIVREE);
    const ouvrir = within(c.pme).getByRole<HTMLButtonElement>("button", {
      name: "tour.facturation.ouvrir",
    });
    expect(ouvrir.disabled).toBe(true);
    fireEvent.change(within(c.pme).getByLabelText("common.motif"), { target: { value: "   " } });
    expect(ouvrir.disabled).toBe(true);
    fireEvent.change(within(c.pme).getByLabelText("common.motif"), {
      target: { value: "Staging : premier essai" },
    });
    expect(ouvrir.disabled).toBe(false);
    // Le motif d'un périmètre n'ouvre pas l'autre.
    expect(
      within(c.cabinets).getByRole<HTMLButtonElement>("button", {
        name: "tour.facturation.ouvrir",
      }).disabled,
    ).toBe(true);
    fireEvent.click(ouvrir);
    await waitFor(() => expect(regler).toHaveBeenCalledTimes(1));
    expect(regler).toHaveBeenCalledWith("pme", true, 1, "Staging : premier essai");
  });

  it("un rattrapage de moins d'un se dit, et bloque l'envoi", async () => {
    const c = await carte(LIVREE);
    fireEvent.change(within(c.cabinets).getByLabelText("common.motif"), {
      target: { value: "essai" },
    });
    fireEvent.change(within(c.cabinets).getByLabelText("tour.facturation.cabinets.rattrapage"), {
      target: { value: "0" },
    });
    expect(within(c.cabinets).getByText("tour.facturation.invalide")).toBeTruthy();
    expect(within(c.pme).queryByText("tour.facturation.invalide")).toBeNull();
    expect(
      within(c.cabinets).getByRole<HTMLButtonElement>("button", {
        name: "tour.facturation.ouvrir",
      }).disabled,
    ).toBe(true);
  });

  it("un périmètre ouvert : depuis quand, par qui, son dernier passage ; les erreurs en vermillon ; couper se motive", async () => {
    const c = await carte(CABINETS_OUVERTS);
    const etatAffiche = c.cabinets.querySelector("[data-etat]")!;
    expect(etatAffiche.textContent).toContain("tour.facturation.etat.ouverte");
    expect(etatAffiche.className).toContain("text-signal-ok");
    expect(c.pme.querySelector("[data-etat]")!.textContent).toContain(
      "tour.facturation.etat.coupee",
    );
    expect(c.cabinets.querySelector("[data-par]")!.textContent).toContain("Wissem");
    expect(
      within(c.cabinets).getByLabelText<HTMLInputElement>("tour.facturation.cabinets.rattrapage")
        .value,
    ).toBe("2");
    const erreurs = c.cabinets.querySelector(
      '[data-compteur="tour.facturation.compteur.erreurs"]',
    )!;
    expect(erreurs.querySelector(".text-signal-stop")?.textContent).toBe("1");
    const emises = c.cabinets.querySelector('[data-compteur="tour.facturation.compteur.emises"]')!;
    expect(emises.textContent).toContain("4");
    expect(c.cabinets.querySelector("[data-erreur]")!.textContent).toContain(
      "refus.referentiel.manquant",
    );
    expect(c.pme.querySelector("[data-compteurs]")).toBeNull();

    const couper = within(c.cabinets).getByRole<HTMLButtonElement>("button", {
      name: "tour.facturation.couper",
    });
    expect(couper.disabled).toBe(true);
    fireEvent.change(within(c.cabinets).getByLabelText("common.motif"), {
      target: { value: "Incident d'émetteur" },
    });
    fireEvent.click(couper);
    await waitFor(() =>
      expect(regler).toHaveBeenCalledWith("cabinets", false, 2, "Incident d'émetteur"),
    );
  });
});
