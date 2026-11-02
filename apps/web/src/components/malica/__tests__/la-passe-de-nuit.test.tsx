// @vitest-environment jsdom
/**
 * La carte « Relecture de nuit » de la tour (passe de nuit, 2 novembre 2026) :
 * l'écran montre ce que la base rend — le réglage, l'état du relecteur, les
 * passages et le bilan par dossier —, avec la couleur de la fonction et non
 * de la décoration, et transmet le geste tel quel. Il ne décide rien.
 */
import type {
  CompteDeService,
  PassageDeNuit,
  ReglageRelectureNuit,
  RelecturesDeNuitDuJour,
} from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));

const REGLAGE: ReglageRelectureNuit = {
  actif: false,
  fenetre_debut: "01:00:00",
  fenetre_fin: "06:00:00",
  plafond_usd_24h_plateforme: 20,
  plafond_usd_24h_dossier: 1,
  relectures_max_24h_dossier: 200,
  part_max_plafond_mensuel: 0.5,
  alerte_retard_nuits: 3,
  motif: "Valeurs de départ",
  decide_le: "2026-11-02T00:00:00.000Z",
};
const COMPTE: CompteDeService = {
  code: "relecteur_de_nuit",
  libelle: "Relecteur de nuit (service ALGORIA)",
  actif: true,
  motif: "Passe de nuit",
  decide_le: "2026-11-02T00:00:00.000Z",
};
const PASSAGES: PassageDeNuit[] = [
  {
    id: "p1",
    ouvert_le: "2026-11-03T01:10:00.000Z",
    raison: "plafond",
    ferme_le: "2026-11-03T01:40:00.000Z",
    compteurs: { retenues: 3, ecartees: 1, abstentions: 2, pannes: 0 },
  },
  {
    id: "p2",
    ouvert_le: "2026-11-02T01:10:00.000Z",
    raison: "interrompu",
    ferme_le: null,
    compteurs: {},
  },
];
const LIGNES: RelecturesDeNuitDuJour[] = [
  {
    jour: "2026-11-03",
    tenant_id: "t1",
    dossier: "SOTUMAG",
    retenues: 3,
    ecartees: 1,
    abstentions: { "relecture.abstention.correction_humaine": 2 },
    pannes: 1,
    epuisees: 0,
    en_attente: 4,
    plus_ancienne_nuits: 5,
    en_retard: true,
    cout_usd: "0.4200",
    sans_cout: 0,
  },
];

const regler = vi.fn(async () => ({}));
const reglerCompte = vi.fn(async () => ({}));
/** Ce que la tour demande et que cette épreuve ne regarde pas : jamais rendu. */
const enAttente = () => new Promise(() => undefined);

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    referential: new Proxy({}, { get: () => enAttente }),
    tour: new Proxy(
      {
        suisJePlateforme: async () => true,
        reglageRelectureNuit: async () => ({ reglage: REGLAGE, compte: COMPTE }),
        relecturesDeNuit: async () => ({ lignes: LIGNES, passages: PASSAGES }),
        reglerRelectureNuit: regler,
        reglerCompteDeService: reglerCompte,
      } as Record<string, unknown>,
      { get: (cible, nom: string) => cible[nom] ?? enAttente },
    ),
  }),
}));

import { LaPasseDeNuit, LeCompteDeService } from "../tour/passe-de-nuit";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function carte() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LaPasseDeNuit />
      <LeCompteDeService />
    </QueryClientProvider>,
  );
  const c = await waitFor(() => {
    const el = document.querySelector<HTMLElement>("[data-passe-de-nuit]");
    if (!el) throw new Error("carte absente");
    return el;
  });
  await within(c).findByText(/tour\.nuit\.etat\.coupee/);
  return c;
}

describe("la carte de la passe de nuit", () => {
  it("dit l'état livré : coupée, relecteur actif, valeurs de la base", async () => {
    const c = await carte();
    expect(within(c).getByText("tour.nuit.etat.coupee")).toBeTruthy();
    expect(within(c).getByText(/tour\.nuit\.compte\.actif/).textContent).toContain(
      "Relecteur de nuit (service ALGORIA)",
    );
    expect(within(c).getByLabelText<HTMLInputElement>("tour.nuit.debut").value).toBe("01:00");
    expect(within(c).getByLabelText<HTMLInputElement>("tour.nuit.fin").value).toBe("06:00");
    expect(within(c).getByLabelText<HTMLInputElement>("tour.nuit.part").value).toBe("0.5");
  });

  it("colore par fonction : plafond en ambre, interrompu en vermillon, retard en ambre, panne en vermillon", async () => {
    const c = await carte();
    const plafond = c.querySelector('[data-passage="plafond"] .text-signal-warn');
    const interrompu = c.querySelector('[data-passage="interrompu"] .text-signal-stop');
    expect(plafond?.textContent).toBe("tour.nuit.raison.plafond");
    expect(interrompu?.textContent).toBe("tour.nuit.raison.interrompu");
    const ligne = c.querySelector<HTMLElement>("[data-ligne]")!;
    expect(ligne.querySelector(".text-signal-ok")?.textContent).toBe("3");
    expect(ligne.querySelector(".text-signal-warn")?.textContent).toContain("tour.nuit.nuits");
    expect(ligne.querySelector(".text-signal-stop")?.textContent).toContain("1");
  });

  it("transmet le réglage tel quel, et ne part pas sans motif", async () => {
    const c = await carte();
    const enregistrer = within(c).getByRole("button", { name: "tour.enregistrer" });
    expect((enregistrer as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(c).getByRole("checkbox"));
    fireEvent.change(within(c).getByLabelText("tour.nuit.plafondDossier"), {
      target: { value: "0.5" },
    });
    fireEvent.change(within(c).getByLabelText("common.motif"), {
      target: { value: "Staging : une nuit d'essai" },
    });
    fireEvent.click(enregistrer);
    await waitFor(() => expect(regler).toHaveBeenCalledTimes(1));
    expect(regler).toHaveBeenCalledWith(
      {
        actif: true,
        fenetreDebut: "01:00",
        fenetreFin: "06:00",
        plafondUsd24hPlateforme: "20",
        plafondUsd24hDossier: "0.5",
        relecturesMax24hDossier: 200,
        partMaxPlafondMensuel: "0.5",
        alerteRetardNuits: 3,
      },
      "Staging : une nuit d'essai",
    );
  });

  it("une valeur hors bornes se dit, et bloque l'envoi", async () => {
    const c = await carte();
    fireEvent.change(within(c).getByLabelText("tour.nuit.part"), { target: { value: "1.5" } });
    fireEvent.change(within(c).getByLabelText("common.motif"), { target: { value: "essai" } });
    expect(within(c).getByText("tour.nuit.invalide")).toBeTruthy();
    expect(
      (within(c).getByRole("button", { name: "tour.enregistrer" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("révoque le relecteur par son code, motivé, depuis sa carte", async () => {
    await carte();
    const c = document.querySelector<HTMLElement>("[data-compte-de-service]")!;
    expect(within(c).getByText(/tour\.nuit\.compte\.actif/)).toBeTruthy();
    fireEvent.change(within(c).getByLabelText("common.motif"), {
      target: { value: "Incident de coût" },
    });
    fireEvent.click(within(c).getByRole("button", { name: "tour.nuit.revoquer" }));
    await waitFor(() =>
      expect(reglerCompte).toHaveBeenCalledWith("relecteur_de_nuit", false, "Incident de coût"),
    );
    expect(screen.getAllByText("tour.fait").length).toBeGreaterThan(0);
  });
});
