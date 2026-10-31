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

const api = vi.hoisted(() => ({
  valider: vi.fn(),
  forcer: vi.fn(),
  trancherLeSens: vi.fn(),
  saisirLeCoursDeLaPiece: vi.fn(),
  journal: vi.fn(),
}));
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
    office: {
      valider: api.valider,
      forcer: api.forcer,
      trancherLeSens: api.trancherLeSens,
      saisirLeCoursDeLaPiece: api.saisirLeCoursDeLaPiece,
    },
    referential: {
      journaux: async () => [
        { code: "ACH", libelle: "Journal des achats" },
        { code: "OD", libelle: "Opérations diverses" },
      ],
      // Les deux types qui portent une écriture, et un qui n'en porte pas.
      typesDeDocument: async () => [
        { code: "facture_achat", libelle: "Facture d'achat", porteEcriture: true },
        { code: "facture_vente", libelle: "Facture de vente", porteEcriture: true },
        { code: "ticket_caisse", libelle: "Ticket de caisse", porteEcriture: false },
      ],
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
  empreinte: "empreinte-affichee",
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

/** Rien de proposé, parce que le sens lu se contredit. */
const SENS_A_TRANCHER = {
  ok: false,
  raison: "Le sens est à confirmer.",
  controlesEnDefaut: ["sens_de_la_piece"],
} as PropositionDePiece;

/** Une facture en euros sans cours : rien de proposé, le cours à saisir (31 octobre 2026). */
const COURS_A_SAISIR = {
  ok: false,
  raison: "Aucune écriture ne se propose : taux EUR/TND du 2026-09-10 à saisir.",
  raisonCode: "taux_de_change",
  coursASaisir: { devise: "EUR", versDevise: "TND", jour: "2026-09-10", source: "BCT" },
} as PropositionDePiece;

/** La même, convertie au cours : chaque ligne garde son montant d'origine. */
const CONVERTIE = {
  ...PROPOSITION,
  proposition: {
    journal: "ACH",
    libelle: "Achat en euros",
    pivot: { entry_date: "2026-09-10" },
    conversion: {
      devise_origine: "EUR",
      devise: "TND",
      taux_unitaire: "3.3456",
      cours: { id: "c1", date: "2026-09-10", source: "BCT", taux: "3.3456", unite: 1 },
      regle_d_ecart: "base_la_plus_grande",
      ecart: "0.000",
      ligne_ajustee: null,
    },
    lignes: [
      {
        account_code: "601",
        libelle: "Achats",
        debit: "3345.600",
        credit: "0",
        tax_code: null,
        devise_origine: "EUR",
        montant_origine: "1000.00",
        taux_de_change: "3.3456",
        cours_id: "c1",
      },
      {
        account_code: "401",
        libelle: "Fournisseurs",
        debit: "0",
        credit: "3345.600",
        tax_code: null,
        devise_origine: "EUR",
        montant_origine: "1000.00",
        taux_de_change: "3.3456",
        cours_id: "c1",
      },
    ],
  },
} as unknown as PropositionDePiece;

const TAUX = [
  { code: "TVA07", label: "TVA 7 %" },
  { code: "TVA19", label: "TVA 19 %" },
];

function monter(
  proposition: PropositionDePiece,
  sens: { lu: string | null } | null = null,
  illisible = false,
) {
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
        sens={sens}
        dateLue="2026-10-27"
        libellePropose="Achat COMPTOIR DU LAC"
        plan={PLAN}
        decimales={3}
        motifs={[]}
        codesDeTaxe={TAUX}
        illisible={illisible}
        onRetournee={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/**
 * Un compte se tape dans une liste proposée (`datalist`) : un combobox. Les
 * autres champs d'une ligne se nomment par leur rôle ET leur ligne.
 */
const saisir = (libelle: string, valeur: string, rang = 0) =>
  fireEvent.change(
    screen.getByRole(
      libelle === "pme.journal.account" || libelle === "cab.ecriture.ligne.taxe"
        ? "combobox"
        : "textbox",
      { name: nomDuChamp(libelle, rang) },
    ),
    { target: { value: valeur } },
  );
const nomDuChamp = (champ: string, rang: number) =>
  `cab.ecriture.ligne.champ ${JSON.stringify({ champ, n: rang + 1 })}`;

describe("une pièce en devise, côté comptable", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("sans cours : « Taux … à saisir », et le cours se saisit en un geste", async () => {
    api.saisirLeCoursDeLaPiece.mockResolvedValue(CONVERTIE);
    monter(COURS_A_SAISIR);
    expect(screen.getByText(/^cab\.cours\.a_saisir/).textContent).toContain(
      `cab.cours.a_saisir ${JSON.stringify({ devise: "EUR", vers: "TND", jour: "10/09/2026" })}`,
    );
    // Le message générique ne s'affiche pas : le geste est nommé.
    expect(screen.queryByText("cab.ecriture.rien")).toBeNull();
    const enregistrer = screen.getByRole("button", { name: "cab.cours.enregistrer" });
    expect(enregistrer).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: /^cab\.cours\.taux/ }), {
      target: { value: "3,3456" },
    });
    fireEvent.click(enregistrer);
    // Sans motif : une saisie simple, qui cède devant le cours officiel importé.
    await waitFor(() =>
      expect(api.saisirLeCoursDeLaPiece).toHaveBeenCalledWith("p1", "3.3456", 1, null),
    );
  });

  it("convertie : le cours appliqué se lit, et chaque ligne dit son montant d'origine", () => {
    monter(CONVERTIE);
    expect(screen.getByText(/^cab\.cours\.applique/).textContent).toContain('"source":"BCT"');
    expect(screen.getAllByText(/EUR ×/)).toHaveLength(2);
    // Corriger le taux ouvre le même formulaire.
    fireEvent.click(screen.getByRole("button", { name: "cab.cours.corriger" }));
    expect(screen.getByRole("button", { name: "cab.cours.enregistrer" })).toBeTruthy();
  });

  it("corriger un cours exige un motif, et dit pour qui la dérogation vaut (revue de #148)", async () => {
    api.saisirLeCoursDeLaPiece.mockResolvedValue(CONVERTIE);
    monter(CONVERTIE);
    fireEvent.click(screen.getByRole("button", { name: "cab.cours.corriger" }));
    const enregistrer = screen.getByRole("button", { name: "cab.cours.enregistrer" });
    fireEvent.change(screen.getByRole("textbox", { name: /^cab\.cours\.taux/ }), {
      target: { value: "3,40" },
    });
    // Un taux seul ne corrige rien : la correction dit pourquoi.
    expect(enregistrer).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "cab.cours.motif.exige" }), {
      target: { value: "Cours de la banque du client" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "cab.cours.portee" }), {
      target: { value: "cabinet" },
    });
    fireEvent.click(enregistrer);
    await waitFor(() =>
      expect(api.saisirLeCoursDeLaPiece).toHaveBeenCalledWith("p1", "3.40", 1, {
        motif: "Cours de la banque du client",
        portee: "cabinet",
      }),
    );
  });

  it("une ligne changée n'est plus celle de la pièce en devise : son origine ne s'affiche plus", () => {
    monter(CONVERTIE);
    saisir("pme.journal.account", "622", 0);
    expect(screen.queryAllByText(/EUR ×/)).toHaveLength(0);
  });
});

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

  it("proposée et inchangée : VALIDER envoie l'empreinte de ce qui est affiché", async () => {
    api.valider.mockResolvedValue("e1");
    monter(PROPOSITION);
    fireEvent.click(screen.getByRole("button", { name: "cab.ecriture.valider" }));
    await waitFor(() => expect(api.valider).toHaveBeenCalledWith("p1", "empreinte-affichee"));
    expect(api.forcer).not.toHaveBeenCalled();
  });

  it("proposée puis modifiée : le bouton dit « Forcer l'écriture », et force", async () => {
    api.forcer.mockResolvedValue("e1");
    monter(PROPOSITION);
    saisir("pme.journal.account", "622", 0);
    expect(screen.queryByRole("button", { name: "cab.ecriture.valider" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "cab.ecriture.forcer" }));
    await waitFor(() => expect(api.forcer).toHaveBeenCalledTimes(1));
    expect(api.forcer.mock.calls[0]![0].lignes[0]).toMatchObject({
      account_code: "622",
      libelle: "Honoraires",
    });
    expect(api.valider).not.toHaveBeenCalled();
  });

  /*
   * Staging, 30 octobre 2026 : un lecteur d'écran lisait « Débit » sur chaque
   * ligne, sans dire laquelle. Chaque champ se nomme par son rôle et sa ligne.
   */
  it("libellé, débit, crédit : un nom accessible par champ et par ligne", () => {
    monter(PROPOSITION);
    for (const champ of ["cab.ecriture.ligne.libelle", "pme.journal.debit", "pme.journal.credit"])
      for (const rang of [0, 1])
        expect(screen.getByRole("textbox", { name: nomDuChamp(champ, rang) })).toBeTruthy();
    // Le compte, le taux et « Retirer la ligne » aussi (revue de #140).
    for (const rang of [0, 1]) {
      expect(screen.getByRole("combobox", { name: nomDuChamp("pme.journal.account", rang) }));
      expect(screen.getByRole("combobox", { name: nomDuChamp("cab.ecriture.ligne.taxe", rang) }));
      expect(screen.getByRole("button", { name: nomDuChamp("cab.ecriture.ligne.retirer", rang) }));
    }
  });

  /*
   * Revue de #140 : une facture à deux taux forcée sans codes sortait de la
   * TVA du mois sans un mot. Le taux d'une ligne se choisit au référentiel,
   * pré-rempli par la proposition ; le changer, c'est forcer.
   */
  it("le taux d'une ligne : pré-rempli par la proposition, choisi au référentiel, il part", async () => {
    api.forcer.mockResolvedValue("e1");
    const proposition = {
      ...PROPOSITION,
      proposition: {
        ...(PROPOSITION as unknown as { proposition: Record<string, unknown> }).proposition,
        lignes: [
          { account_code: "601", libelle: "Achats", debit: "1000", credit: "0", tax_code: "TVA19" },
          {
            account_code: "401",
            libelle: "Fournisseurs",
            debit: "0",
            credit: "1000",
            tax_code: null,
          },
        ],
      },
    } as unknown as PropositionDePiece;
    monter(proposition);
    const taux = screen.getByRole("combobox", { name: nomDuChamp("cab.ecriture.ligne.taxe", 0) });
    expect((taux as HTMLSelectElement).value).toBe("TVA19");
    expect(screen.getAllByRole("option", { name: "TVA 7 %" })).toHaveLength(2);
    saisir("cab.ecriture.ligne.taxe", "TVA07", 0);
    fireEvent.click(screen.getByRole("button", { name: "cab.ecriture.forcer" }));
    await waitFor(() => expect(api.forcer).toHaveBeenCalledTimes(1));
    expect(api.forcer.mock.calls[0]![0].lignes[0]).toMatchObject({ tax_code: "TVA07" });
  });

  it("une écriture prise en charge qui ne se lit pas comme une facture se signale au cabinet", () => {
    monter(PROPOSITION, null, true);
    expect(screen.getByRole("status").textContent).toContain("cab.ecriture.illisible");
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

  it("le sens se tranche au cabinet : deux gestes égaux, le sens lu à gauche, plein", async () => {
    api.trancherLeSens.mockResolvedValue({ type: "facture_achat" });
    monter(SENS_A_TRANCHER, { lu: "facture_vente" });
    const vente = await screen.findByRole("button", { name: "Facture de vente" });
    const achat = screen.getByRole("button", { name: "Facture d'achat" });
    expect(screen.queryByRole("button", { name: "Ticket de caisse" })).toBeNull();
    // Même rangée, même largeur ; le principal (plein) à gauche.
    expect(vente.parentElement).toBe(achat.parentElement);
    expect(vente.parentElement!.className).toContain("grid-cols-2");
    expect(vente.compareDocumentPosition(achat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vente.className).toContain("bg-foreground");
    expect(achat.className).not.toContain("bg-foreground");
    for (const b of [vente, achat]) expect(b.className).toContain("min-h-[48px]");

    fireEvent.click(achat);
    await waitFor(() => expect(api.trancherLeSens).toHaveBeenCalledWith("p1", "facture_achat"));
  });

  it("le sens ne bloque jamais le forçage : la saisie reste à côté", async () => {
    monter(SENS_A_TRANCHER, { lu: null });
    await screen.findByRole("button", { name: "Facture d'achat" });
    expect(screen.getByRole("button", { name: "cab.ecriture.saisir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "cab.ecriture.retourner" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/confirm/i);
  });

  it("aucune largeur minimale : les lignes ne défilent pas sur un téléphone", () => {
    monter(PROPOSITION);
    expect(document.body.innerHTML).not.toMatch(/min-w-\[/);
    expect(document.querySelector("table")).toBeNull();
  });
});
