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
  soldesCrediteurs: vi.fn(),
  relevesAEncaisser: vi.fn(),
  encaisserVirement: vi.fn(),
  rembourserSolde: vi.fn(),
  renvoyerFacture: vi.fn(async () => ({
    numero: "MO-TN-I11-2026-000001",
    deja: false,
    poste: true,
  })),
}));

vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ tour, facturation: { factureDetail: vi.fn() } }),
}));

import {
  LesFacturesEmises,
  LesRelevesAEncaisser,
  LesSoldesCrediteurs,
  ReglerLesFactures,
} from "../factures";

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

describe("Tour › Soldes créditeurs", () => {
  it("dit l'argent reçu et pas encore imputé, licence par licence, et les liens payés deux fois", async () => {
    tour.soldesCrediteurs.mockResolvedValue([
      {
        licence_id: "l-1",
        cabinet_id: null,
        societe: "Atelier d'essai",
        titulaire: "Samia Ben Salah",
        solde: "6.950",
        devise: "TND",
        doubles: 1,
        depuis: "2026-11-25T10:00:00.000Z",
      },
    ]);
    monter(LesSoldesCrediteurs);
    expect(await screen.findByText("Atelier d'essai")).toBeTruthy();
    expect(screen.getByText(/tour\.soldes\.doubles/)).toBeTruthy();

    // Un solde que rien n'attend se rembourse : la référence et le motif, puis il s'inscrit.
    tour.rembourserSolde.mockResolvedValue({ montant: "6.950", devise: "TND" });
    fireEvent.click(screen.getByText("tour.soldes.rembourser"));
    const inscrire = screen.getByText<HTMLButtonElement>("tour.soldes.inscrire");
    expect(inscrire.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("tour.soldes.reference"), {
      target: { value: "RBT-1" },
    });
    fireEvent.change(screen.getByLabelText("common.motif"), { target: { value: "Double lien" } });
    fireEvent.click(inscrire);
    await waitFor(() =>
      expect(tour.rembourserSolde).toHaveBeenCalledWith("l-1", null, "RBT-1", "Double lien"),
    );
    expect(await screen.findByText(/^tour\.soldes\.fait /)).toBeTruthy();
  });

  it("aucun solde : il le dit", async () => {
    tour.soldesCrediteurs.mockResolvedValue([]);
    monter(LesSoldesCrediteurs);
    expect(await screen.findByText("tour.soldes.aucun")).toBeTruthy();
  });
});

describe("Tour › Relevés à encaisser", () => {
  const RELEVE = {
    releve_id: "r-1",
    cabinet_id: "c-1",
    cabinet: "Comptabilité d'essai",
    periode: "2026-10-01",
    etabli_le: "2026-11-01",
    montant_ttc: "70.810",
    devise: "TND",
    bloque_le: "2000-01-15",
    suspendu_le: "2099-12-01",
  };

  it("dit le relevé, son état, et inscrit le virement au montant saisi (D10)", async () => {
    tour.relevesAEncaisser.mockResolvedValue([RELEVE]);
    tour.encaisserVirement.mockResolvedValue({
      facture_id: "f-9",
      numero: "MO-TN-I11-2026-000009",
    });
    monter(LesRelevesAEncaisser);
    expect(await screen.findByText(/Comptabilité d'essai/)).toBeTruthy();
    expect(screen.getByText(/^tour\.releves\.etat\.bloque /)).toBeTruthy();

    fireEvent.click(screen.getByText("tour.releves.virement"));
    const encaisser = screen.getByText<HTMLButtonElement>("tour.releves.encaisser");
    expect(encaisser.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("tour.releves.montant"), {
      target: { value: "70.810" },
    });
    fireEvent.change(screen.getByLabelText("tour.releves.date"), {
      target: { value: "2026-11-20" },
    });
    fireEvent.change(screen.getByLabelText("tour.releves.reference"), {
      target: { value: " VIR-2026-11 " },
    });
    expect(encaisser.disabled).toBe(false);
    fireEvent.click(encaisser);
    await waitFor(() =>
      expect(tour.encaisserVirement).toHaveBeenCalledWith(
        "r-1",
        "70.810",
        "2026-11-20",
        "VIR-2026-11",
      ),
    );
    expect(await screen.findByText(/^tour\.releves\.fait .*000009/)).toBeTruthy();
  });

  it("aucun relevé en attente : il le dit", async () => {
    tour.relevesAEncaisser.mockResolvedValue([]);
    monter(LesRelevesAEncaisser);
    expect(await screen.findByText("tour.releves.aucun")).toBeTruthy();
  });
});
