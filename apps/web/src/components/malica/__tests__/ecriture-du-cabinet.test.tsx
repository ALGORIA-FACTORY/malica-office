// @vitest-environment jsdom
/**
 * La pièce côté comptable : rien ne bloque (« Malica sans blocage »).
 *
 * Relevé sur staging le 29 octobre 2026 : « Inscrire l'écriture proposée »
 * éteint quand le Socle ne proposait rien, et « Demander au client de
 * confirmer ». Le comptable saisit désormais l'écriture ; ce qu'il valide
 * tel que proposé est validé, ce qu'il change est forcé.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompteDuPlan, PropositionDePiece } from "@malica/socle/ports/repositories";

const api = vi.hoisted(() => ({ valider: vi.fn(), forcer: vi.fn(), journal: vi.fn() }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, unknown>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/cabinet/journal">{children}</a>,
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    office: { valider: api.valider, forcer: api.forcer },
    referential: {
      journaux: async () => [
        { code: "ACH", libelle: "Journal des achats" },
        { code: "OD", libelle: "Opérations diverses" },
      ],
      typesDeDocument: async () => [],
    },
    journal: { consigner: api.journal },
  }),
}));

import { EcritureDuCabinet } from "../ecriture-du-cabinet";

const PLAN = [
  { code: "601", libelle: "Achats", origine: "officiel", collectif: false },
  { code: "622", libelle: "Honoraires", origine: "officiel", collectif: false },
  { code: "401", libelle: "Fournisseurs", origine: "officiel", collectif: true },
] as unknown as CompteDuPlan[];

const PROPOSITION = {
  ok: true,
  verdict: "à comptabiliser",
  verdictCode: null,
  packVersionId: "pack",
  proposition: {
    journal: "ACH",
    libelle: "Achat COMPTOIR DU LAC",
    pivot: { entry_date: "2026-10-27" },
    lignes: [
      { account_code: "601", libelle: "Achats", debit: "1655.135", credit: "0", tax_code: null },
      {
        account_code: "401",
        libelle: "Fournisseurs",
        debit: "0",
        credit: "1655.135",
        tax_code: null,
      },
    ],
  },
} as unknown as PropositionDePiece;

const RIEN = {
  ok: false,
  raison: "Montants lus incohérents.",
} as PropositionDePiece;

function monter(proposition: PropositionDePiece) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EcritureDuCabinet
        pieceId="p1"
        clientId="c1"
        statut="vue"
        suivi={null}
        vivante={null}
        proposition={proposition}
        typeAEtablir={false}
        dateLue="2026-10-27"
        libellePropose="Achat COMPTOIR DU LAC"
        plan={PLAN}
        decimales={3}
        motifs={[]}
        onRetournee={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** Un compte se tape dans une liste proposée (`datalist`) : un combobox. */
const saisir = (libelle: string, valeur: string, rang = 0) =>
  fireEvent.change(
    screen.getAllByRole(libelle === "pme.journal.account" ? "combobox" : "textbox", {
      name: libelle,
    })[rang]!,
    { target: { value: valeur } },
  );

describe("la pièce côté comptable", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("rien de proposé : le comptable SAISIT l'écriture, elle part forcée", async () => {
    api.forcer.mockResolvedValue("e1");
    monter(RIEN);
    expect(screen.getByText("cab.ecriture.rien")).toBeTruthy();
    const saisirLEcriture = screen.getByRole("button", { name: "cab.ecriture.saisir" });
    expect(saisirLEcriture).toHaveProperty("disabled", true);

    await screen.findByRole("option", { name: "ACH — Journal des achats" });
    fireEvent.change(screen.getByRole("combobox", { name: /^cab\.ecriture\.journal/ }), {
      target: { value: "ACH" },
    });
    saisir("pme.journal.account", "601", 0);
    saisir("pme.journal.account", "401", 1);
    saisir("pme.journal.debit", "1 969,610", 0);
    saisir("pme.journal.credit", "1969.6", 1);
    // Un millième d'écart : refusé, et la phrase dit pourquoi.
    expect(screen.getByText("refus.ecriture.desequilibre")).toBeTruthy();
    expect(saisirLEcriture).toHaveProperty("disabled", true);

    saisir("pme.journal.credit", "1969,610", 1);
    expect(screen.getByText("cab.ecriture.equilibree")).toBeTruthy();
    fireEvent.click(saisirLEcriture);
    await waitFor(() => expect(api.forcer).toHaveBeenCalledTimes(1));
    expect(api.forcer.mock.calls[0]![0]).toMatchObject({
      pieceId: "p1",
      journal: "ACH",
      date: "2026-10-27",
      libelle: "Achat COMPTOIR DU LAC",
      lignes: [
        { account_code: "601", libelle: "Achats", debit: "1969.610", credit: "" },
        { account_code: "401", libelle: "Fournisseurs", debit: "", credit: "1969.610" },
      ],
    });
    expect(api.valider).not.toHaveBeenCalled();
  });

  it("proposée et inchangée : VALIDER, le serveur inscrit la proposition", async () => {
    api.valider.mockResolvedValue("e1");
    monter(PROPOSITION);
    fireEvent.click(screen.getByRole("button", { name: "cab.ecriture.valider" }));
    await waitFor(() => expect(api.valider).toHaveBeenCalledWith("p1"));
    expect(api.forcer).not.toHaveBeenCalled();
  });

  it("proposée puis modifiée : le même bouton la force", async () => {
    api.forcer.mockResolvedValue("e1");
    monter(PROPOSITION);
    saisir("pme.journal.account", "622", 0);
    fireEvent.click(screen.getByRole("button", { name: "cab.ecriture.valider" }));
    await waitFor(() => expect(api.forcer).toHaveBeenCalledTimes(1));
    expect(api.forcer.mock.calls[0]![0].lignes[0]).toMatchObject({
      account_code: "622",
      libelle: "Honoraires",
    });
    expect(api.valider).not.toHaveBeenCalled();
  });

  it("deux gestes côte à côte, aucun n'attend le client", () => {
    monter(PROPOSITION);
    const boutons = [
      screen.getByRole("button", { name: "cab.ecriture.valider" }),
      screen.getByRole("button", { name: "cab.ecriture.retourner" }),
    ];
    expect(boutons[0]!.parentElement).toBe(boutons[1]!.parentElement);
    expect(boutons[0]!.parentElement!.className).toContain("grid-cols-2");
    expect(document.body.textContent).not.toMatch(/confirm/i);
  });
});
