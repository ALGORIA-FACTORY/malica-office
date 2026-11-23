// @vitest-environment jsdom
/**
 * Tour › Factures (23 novembre 2026) : le réglage se lit et s'enregistre daté et motivé, et le
 * courriel d'une facture de société se renvoie avec un motif. La base juge ; l'écran transmet
 * et dit son retour. Données d'essai manifestement fictives.
 */
import type {
  FactureDeLaTour,
  ReglageDesFactures,
  SaisieDesFactures,
} from "@malica/socle/ports/repositories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
    dir: "ltr",
  }),
}));

const EN_VIGUEUR: ReglageDesFactures = {
  serie: "MO-TN-I11",
  chiffres: 6,
  adresse: null,
  rne: null,
  site_web: null,
  conditions_paiement: null,
  banque_titulaire: null,
  banque_nom: null,
  banque_agence: null,
  banque_rib: null,
  banque_iban: null,
  banque_bic: null,
  banque_devise: null,
  valide_des: "2026-11-23",
  motif: "Décision du 23 novembre 2026",
  decide_le: "2026-11-23T00:00:00Z",
  livre: true,
};

const FACTURES: FactureDeLaTour[] = [
  {
    facture_id: "f-pme",
    numero: "MO-TN-I11-2026-000001",
    emise_le: "2026-11-23",
    payeur_type: "titulaire",
    destinataire: "Dirigeante d'essai",
    montant_ttc: "120.000",
    devise: "TND",
    etat: "a_echoir",
  },
  {
    facture_id: "f-cab",
    numero: "MO-TN-I11-2026-000002",
    emise_le: "2026-11-23",
    payeur_type: "cabinet",
    destinataire: "Cabinet d'essai",
    montant_ttc: "300.000",
    devise: "TND",
    etat: "a_echoir",
  },
];

const tour = vi.hoisted(() => ({
  reglageFactures: vi.fn(),
  reglerFactures: vi.fn(async () => ({})),
  facturesEmises: vi.fn(),
  renvoyerFacture: vi.fn(async () => ({
    numero: "MO-TN-I11-2026-000001",
    deja: false,
    poste: true,
  })),
}));

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ tour, facturation: { factureDetail: vi.fn() } }),
}));

import { LesFacturesEmises, ReglerLesFactures } from "../factures";

function monter(Ecran: ComponentType) {
  tour.reglageFactures.mockResolvedValue({ en_vigueur: EN_VIGUEUR, a_venir: [] });
  tour.facturesEmises.mockResolvedValue(FACTURES);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Ecran />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tour › Factures, le réglage", () => {
  it("dit la série en vigueur, défaut livré, et le premier numéro de l'année", async () => {
    monter(ReglerLesFactures);
    expect(await screen.findByText(/tour\.factures\.en_vigueur .*MO-TN-I11/)).toBeTruthy();
    expect(screen.getByText(/tour\.factures\.livre/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/^MO-TN-I11-\d{4}-000001$/)).toBeTruthy());
  });

  it("n'enregistre qu'avec un motif, et transmet toute la saisie", async () => {
    monter(ReglerLesFactures);
    await screen.findByText(/tour\.factures\.en_vigueur/);
    const enregistrer = screen.getByText("tour.enregistrer") as HTMLButtonElement;
    expect(enregistrer.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("tour.factures.banque.rib"), {
      target: { value: "00 000 0000000000000 00" },
    });
    fireEvent.change(screen.getByLabelText("common.motif"), {
      target: { value: "Coordonnées d'essai" },
    });
    fireEvent.click(enregistrer);
    await waitFor(() => expect(tour.reglerFactures).toHaveBeenCalledTimes(1));
    const [saisie, , motif] = tour.reglerFactures.mock.calls[0] as unknown as [
      SaisieDesFactures,
      string,
      string,
    ];
    expect(saisie.serie).toBe("MO-TN-I11");
    expect(saisie.banque_rib).toBe("00 000 0000000000000 00");
    expect(saisie.banque_iban).toBeNull();
    expect(motif).toBe("Coordonnées d'essai");
    expect(await screen.findByText("tour.fait")).toBeTruthy();
  });
});

describe("Tour › Factures émises", () => {
  it("chaque facture se télécharge ; seule celle d'une société se renvoie", async () => {
    monter(LesFacturesEmises);
    expect(await screen.findByText("MO-TN-I11-2026-000001")).toBeTruthy();
    expect(screen.getAllByText("tour.factures.telecharger")).toHaveLength(2);
    expect(screen.getAllByText("tour.factures.renvoyer")).toHaveLength(1);
  });

  it("le renvoi demande un motif, puis dit ce que la base a fait", async () => {
    monter(LesFacturesEmises);
    fireEvent.click(await screen.findByText("tour.factures.renvoyer"));
    const confirmer = screen.getAllByText("tour.factures.renvoyer").at(-1) as HTMLButtonElement;
    expect(confirmer.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("common.motif"), {
      target: { value: "Courriel manqué" },
    });
    fireEvent.click(confirmer);
    await waitFor(() =>
      expect(tour.renvoyerFacture).toHaveBeenCalledWith("f-pme", "Courriel manqué"),
    );
    expect(await screen.findByText(/tour\.factures\.renvoyee/)).toBeTruthy();
  });
});
