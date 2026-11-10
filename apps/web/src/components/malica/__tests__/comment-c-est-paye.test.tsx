// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaiementDUnePiece } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({
  paiements: vi.fn(),
  inscrire: vi.fn(),
  motifs: vi.fn(),
  annuler: vi.fn(),
  corriger: vi.fn(),
}));
vi.mock("@/components/malica/pme-context", () => ({
  usePme: () => ({ tenantId: "dossier", entityId: "societe", packId: "pack" }),
}));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr", dir: "ltr" }),
}));
vi.mock("@/capabilities/files", () => ({ files: {} }));
vi.mock("@/lib/hors-ligne", () => ({ vidage: vi.fn() }));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    referential: {
      moyensDePaiement: async () => [
        { code: "especes", libelle: "Espèces", exigeJustificatif: false, exigeReference: false },
        { code: "cheque", libelle: "Chèque", exigeJustificatif: false, exigeReference: true },
        { code: "non_paye", libelle: "Non payé", exigeJustificatif: false, exigeReference: false },
      ],
      typesDeDocument: async () => [],
    },
    capture: {
      paiementsDUnePiece: api.paiements,
      enregistrerPaiement: api.inscrire,
      piecesIssuesDe: async () => [],
      motifsDAnnulation: api.motifs,
      annulerPaiement: api.annuler,
      corrigerPaiement: api.corriger,
    },
  }),
}));

import { CommentCEstPaye } from "../comment-c-est-paye";

/** L'écran de la pièce tient la feuille ; ce banc fait de même. */
function Banc({ ttcMineur }: { ttcMineur: number | null }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <CommentCEstPaye
      pieceId="piece"
      visDeLaPiece="personnel"
      dateDeLaPiece="2026-10-21"
      ttcMineur={ttcMineur}
      devise="TND"
      sens="depense"
      tiers="Fournisseur"
      reference="F1"
      decimales={3}
      ajoutOuvert={ouvert}
      onAjout={setOuvert}
    />
  );
}

function monter(ttcMineur: number | null = 119000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Banc ttcMineur={ttcMineur} />
    </QueryClientProvider>,
  );
  return client;
}

/**
 * Ouvre la feuille « Ajouter un règlement » et rend ses deux commandes.
 *
 * Depuis le 24 octobre 2026, toucher un moyen le CHOISIT ; c'est
 * « Enregistrer » qui inscrit. Les gardes éprouvées ici sont les mêmes
 * qu'avant : elles portent désormais sur ce bouton.
 */
async function ouvrirLaFeuille() {
  const ajouter = await screen.findByRole("button", { name: "pme.paiement.ajouterUn" });
  await waitFor(() => expect((ajouter as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ajouter);
  const especes = await screen.findByRole("button", { name: "Espèces" });
  return {
    especes,
    enregistrer: () =>
      screen.getByRole("button", {
        name: /^(pme\.paiement\.enregistrer|common\.loading)/,
      }) as HTMLButtonElement,
  };
}

describe("la déclaration d'un règlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.paiements.mockResolvedValue([]);
    api.inscrire.mockResolvedValue({});
    api.motifs.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("exige un choix du montant puis remet ce choix à zéro après inscription", async () => {
    monter();
    const { especes, enregistrer } = await ouvrirLaFeuille();
    const tout = screen.getByRole("button", { name: "pme.paiement.tout" });
    expect(tout.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(especes);
    // Le moyen est choisi, le montant ne l'est pas : rien ne part.
    expect(enregistrer().disabled).toBe(true);
    fireEvent.click(tout);
    await waitFor(() => expect(enregistrer().disabled).toBe(false));
    fireEvent.click(enregistrer());
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(expect.objectContaining({ montantMineur: 119000 })),
    );
    // La feuille se ferme ; rouverte, rien n'est pré-choisi.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const seconde = await ouvrirLaFeuille();
    expect(
      screen.getByRole("button", { name: "pme.paiement.tout" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(seconde.enregistrer().disabled).toBe(true);
  });

  it("n'inscrit rien tant que l'historique n'a pas répondu", async () => {
    api.paiements.mockReturnValue(new Promise(() => {}));
    monter();
    const ajouter = await screen.findByRole("button", { name: "pme.paiement.ajouterUn" });
    expect((ajouter as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ajouter);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      ((await screen.findByRole("button", { name: "Non payé" })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.inscrire).not.toHaveBeenCalled();
  });

  it("rend une panne visible et permet de relire l'historique", async () => {
    api.paiements.mockRejectedValueOnce(new Error("Historique indisponible"));
    monter();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "pme.paiement.ajouterUn" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "doc.retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.paiements).toHaveBeenCalledTimes(2);
  });

  it("ne remplace pas un règlement de montant inconnu par zéro", async () => {
    api.paiements.mockResolvedValue([
      {
        id: "ancien",
        moyenCode: "especes",
        montantMineur: null,
        eteint: false,
        justificatifPieceId: null,
        annulePaiementId: null,
        reference: null,
      } as PaiementDUnePiece,
    ]);
    monter();
    await screen.findByText("pme.paiement.incomplet");
    const { especes, enregistrer } = await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.tout" }));
    fireEvent.click(especes);
    expect(enregistrer().disabled).toBe(true);
  });

  it("conserve le constat non payé sans exiger un montant fictif", async () => {
    monter(null);
    const nonPaye = await screen.findByRole("button", { name: "Non payé" });
    await waitFor(() => expect((nonPaye as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nonPaye);
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(
        expect.objectContaining({ moyenCode: "non_paye", montantMineur: null, payeLe: null }),
      ),
    );
  });

  it("refuse un montant partiel qui s'arrondit à zéro", async () => {
    monter();
    const { especes, enregistrer } = await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.partie" }));
    fireEvent.change(screen.getByLabelText("pme.paiement.combien"), {
      target: { value: "0,0001" },
    });
    fireEvent.click(especes);
    expect(enregistrer().disabled).toBe(true);
    // Revue de la PR 144 : le bouton se grisait sans un mot. La raison se dit.
    expect(screen.getByRole("alert").textContent).toBe("saisie.refus.tropPrecis");
  });

  it("ne reproche rien à un montant qui s'inscrit", async () => {
    monter();
    await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.partie" }));
    fireEvent.change(screen.getByLabelText("pme.paiement.combien"), {
      target: { value: "12,500" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("inscrit seulement le reste après un acompte connu", async () => {
    api.paiements.mockResolvedValue([
      {
        id: "acompte",
        moyenCode: "especes",
        montantMineur: 50000,
        eteint: false,
        justificatifPieceId: null,
        annulePaiementId: null,
        reference: null,
      } as PaiementDUnePiece,
    ]);
    monter();
    const { especes, enregistrer } = await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.tout" }));
    fireEvent.click(especes);
    await waitFor(() => expect(enregistrer().disabled).toBe(false));
    fireEvent.click(enregistrer());
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(expect.objectContaining({ montantMineur: 69000 })),
    );
  });

  it("respecte un montant partiel saisi avec une virgule", async () => {
    monter();
    const { especes, enregistrer } = await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.partie" }));
    fireEvent.change(screen.getByLabelText("pme.paiement.combien"), {
      target: { value: "12,500" },
    });
    fireEvent.click(especes);
    await waitFor(() => expect(enregistrer().disabled).toBe(false));
    fireEvent.click(enregistrer());
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(expect.objectContaining({ montantMineur: 12500 })),
    );
  });

  /*
   * 10 novembre 2026, relevé sur le staging : une pièce au total négatif
   * (Base HT -1 560,000). « J'ai tout payé » restait choisi, « Enregistrer »
   * gris sans un mot, et « Une partie seulement » annonçait « Au plus
   * 0,000 TND » en laissant partir 1 000,000 TND.
   */
  it.each([0, -1856400])(
    "dit qu'il n'y a rien à régler sur un total de %i, et ne laisse rien choisir",
    async (ttc) => {
      monter(ttc);
      const { especes, enregistrer } = await ouvrirLaFeuille();
      fireEvent.click(especes);
      expect(screen.getByRole("status").textContent).toBe("pme.paiement.rienARegler");
      for (const cle of ["pme.paiement.tout", "pme.paiement.partie"])
        expect((screen.getByRole("button", { name: cle }) as HTMLButtonElement).disabled).toBe(
          true,
        );
      expect(screen.queryByText("pme.paiement.borne")).toBeNull();
      expect(enregistrer().disabled).toBe(true);
      expect(api.inscrire).not.toHaveBeenCalled();
    },
  );

  it("ne laisse pas partir un montant au-dessus de ce qui reste à payer", async () => {
    monter();
    const { especes, enregistrer } = await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.partie" }));
    fireEvent.click(especes);
    const saisie = screen.getByLabelText("pme.paiement.combien");
    fireEvent.change(saisie, { target: { value: "120" } });
    expect(screen.getByRole("alert").textContent).toBe("pme.paiement.borne");
    expect(enregistrer().disabled).toBe(true);
    // Au plafond exact, le montant part.
    fireEvent.change(saisie, { target: { value: "119" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(enregistrer().disabled).toBe(false));
  });

  it("exige la référence quand le moyen en porte une, et seulement alors", async () => {
    monter();
    const { especes, enregistrer } = await ouvrirLaFeuille();
    fireEvent.click(screen.getByRole("button", { name: "pme.paiement.tout" }));
    fireEvent.click(especes);
    expect(screen.queryByLabelText("pme.paiement.reference")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chèque" }));
    await waitFor(() => expect(enregistrer().disabled).toBe(true));
    fireEvent.change(screen.getByLabelText("pme.paiement.reference"), {
      target: { value: "0012345" },
    });
    await waitFor(() => expect(enregistrer().disabled).toBe(false));
    fireEvent.click(enregistrer());
    await waitFor(() =>
      expect(api.inscrire).toHaveBeenCalledWith(
        expect.objectContaining({ moyenCode: "cheque", reference: "0012345" }),
      ),
    );
  });
});

describe("corriger un règlement", () => {
  const regle = {
    id: "regle",
    moyenCode: "especes",
    montantMineur: 119000,
    payeLe: "2026-10-22",
    eteint: false,
    justificatifPieceId: null,
    annulePaiementId: null,
    reference: null,
  } as PaiementDUnePiece;
  const motif = (code: string, remplace: boolean) => ({
    id: `m-${code}`,
    code,
    libelle: code,
    exigeUneNote: false,
    pour: "reglement" as const,
    proposable: true,
    remplace,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    api.paiements.mockResolvedValue([regle]);
    api.motifs.mockResolvedValue([
      motif("montant_errone", true),
      motif("inscrit_en_double", false),
    ]);
    api.annuler.mockResolvedValue({});
    api.corriger.mockResolvedValue({});
  });
  afterEach(cleanup);

  it("un motif qui retire annule sans réinscrire", async () => {
    monter();
    fireEvent.click(await screen.findByText("pme.paiement.corrigerCe"));
    fireEvent.click(await screen.findByRole("button", { name: "inscrit_en_double" }));
    const retirer = await screen.findByRole("button", { name: "pme.paiement.correction.retirer" });
    fireEvent.click(retirer);
    await waitFor(() => expect(api.annuler).toHaveBeenCalledWith("regle", "m-inscrit_en_double"));
    expect(api.corriger).not.toHaveBeenCalled();
  });

  it("un ancien règlement sans montant se corrige avec le bon montant", async () => {
    api.paiements.mockResolvedValue([{ ...regle, montantMineur: null }]);
    monter();
    fireEvent.click(await screen.findByText("pme.paiement.corrigerCe"));
    fireEvent.change(screen.getByLabelText("pme.paiement.combien"), {
      target: { value: "119" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "montant_errone" }));
    const enregistrer = await screen.findByRole("button", {
      name: "pme.paiement.correction.enregistrer",
    });
    await waitFor(() => expect((enregistrer as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(enregistrer);
    await waitFor(() =>
      expect(api.corriger).toHaveBeenCalledWith(
        expect.objectContaining({ paiementId: "regle", montantMineur: 119000 }),
      ),
    );
  });

  it("une correction abandonnée ne préremplit pas l'ajout suivant", async () => {
    api.paiements.mockResolvedValue([{ ...regle, montantMineur: 50000 }]);
    monter();
    fireEvent.click(await screen.findByText("pme.paiement.corrigerCe"));
    fireEvent.click(await screen.findByRole("button", { name: "common.fermer" }));
    const ajouter = await screen.findByRole("button", { name: "pme.paiement.ajouterUn" });
    fireEvent.click(ajouter);
    await screen.findByRole("button", { name: "Espèces" });
    expect(
      (
        screen.getByRole("button", {
          name: /^(pme\.paiement\.enregistrer|common\.loading)/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
