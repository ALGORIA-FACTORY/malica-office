// @vitest-environment jsdom
/**
 * « Imprimer » dans la bibliothèque, pour ses trois portées : une pièce, un
 * dossier, une sélection. Le serveur compose ; l'écran demande ce que la
 * personne a désigné, dit le volume avant de composer, et remet le PDF à
 * l'impression. Le bouton n'est jamais grisé sans raison dite.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocumentComptable } from "@malica/socle/ports/repositories";

/** Une clé et ses valeurs, lisibles dans le texte rendu. */
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, valeurs?: Record<string, unknown>) =>
      valeurs ? `${cle} ${JSON.stringify(valeurs)}` : cle,
    locale: "fr",
    dir: "ltr",
  }),
}));

const demandes: Array<Record<string, unknown>> = [];
let reponse: () => Response = () => new Response("%PDF-1.4", pdf);
const pdf = { headers: { "content-type": "application/pdf" } };
vi.mock("@/lib/transport", () => ({
  transport: () => ({
    appeler: async (chemin: string, init: RequestInit) => {
      demandes.push({ chemin, ...(JSON.parse(String(init.body)) as object) });
      return reponse();
    },
  }),
}));
const imprimes: string[] = [];
vi.mock("@/capabilities/imprimer-un-pdf", () => ({
  imprimerUnPdf: async (_pdf: Blob, nom: string) => {
    imprimes.push(nom);
    return { chemin: null };
  },
}));

/* La bibliothèque de la comptabilité, au niveau d'un type : la liste et ses cases. */
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => ({ client: "client", mois: "2026-01", type: "facture_achat" }),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));
vi.mock("@/components/malica/cabinet-context", () => ({
  useCabinet: () => ({ org: { id: "cabinet", name: "Comptabilité" } }),
}));
vi.mock("@/components/malica/telecharger-dossier-comptable", () => ({
  TelechargerDossierComptable: () => null,
}));
vi.mock("@/components/malica/apercu-de-piece", () => ({ ApercuDePiece: () => null }));
const unDocument = (id: string, reference: string): DocumentComptable => ({
  id,
  tenantId: "client",
  type: "facture_achat",
  status: "lue",
  reference,
  tiers: null,
  dateDocument: null,
  dateDeClassement: "2026-01-31",
  recuLe: "2026-01-31 10:00:00+00",
  empreinte: null,
  montant: null,
  devise: "TND",
  sourcePieceId: null,
});
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    supervision: {
      listClients: async () => [
        { tenantId: "client", name: "Client", engagementStatus: "actif", legalId: null },
      ],
      documents: async () => [unDocument("p1", "F-1"), unDocument("p2", "F-2")],
      moisDuDossier: async () => ({
        plafond: 2000,
        mois: [{ mois: "2026-01", type: "facture_achat", n: 2 }],
      }),
    },
    referential: {
      typesDeDocument: async () => [
        { code: "facture_achat", libelle: "Facture d'achat", transmissible: true },
      ],
    },
  }),
}));

import { ImprimerDepuisLaPme, ImprimerLesPieces } from "@/components/malica/imprimer-les-pieces";
import { Route } from "../routes/_authenticated/cabinet.bibliotheque";

const Bibliotheque = (Route as unknown as { options: { component: ComponentType } }).options
  .component;

const rendre = (noeud: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{noeud}</QueryClientProvider>);

beforeAll(() => {
  // jsdom n'ouvre pas les boîtes modales : l'ouverture suffit à l'épreuve.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  demandes.length = 0;
  imprimes.length = 0;
  reponse = () => new Response("%PDF-1.4", pdf);
});

describe("imprimer une pièce", () => {
  it("demande cette seule pièce, sans comptabilité, et ouvre l'impression", async () => {
    rendre(
      <ImprimerDepuisLaPme
        pieces={["piece-1"]}
        portee="piece"
        nom="Papeterie El Amen"
        libelle="Imprimer"
        classe="f-ligne"
        classeDuTexte="lb"
        enLigne
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Imprimer/ }));
    await screen.findByText("cab.biblio.imprimer.pret");
    expect(demandes).toEqual([
      {
        chemin: "/impressions",
        pieces: ["piece-1"],
        cabinetId: null,
        portee: "piece",
        langue: "fr",
        confirme: false,
      },
    ]);
    expect(imprimes).toEqual(["Papeterie El Amen.pdf"]);
  });

  it("n'est jamais grisé : sans pièce, il dit pourquoi rien ne s'imprime", async () => {
    rendre(
      <ImprimerDepuisLaPme
        pieces={[]}
        portee="dossier"
        nom="Achats"
        libelle="Imprimer le dossier"
        classe="more"
        classeDuTexte="sub"
      />,
    );
    const bouton = screen.getByRole("button", { name: "Imprimer le dossier" });
    expect((bouton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("cab.biblio.imprimer.vide")).toBeNull();
    fireEvent.click(bouton);
    expect(await screen.findByText("cab.biblio.imprimer.vide")).toBeTruthy();
    expect(demandes).toEqual([]);
  });
});

describe("imprimer un dossier", () => {
  it("sous le mandat, avertit du volume (pages, taille), puis imprime sur confirmation", async () => {
    reponse = () =>
      new Response(JSON.stringify({ etat: "a_confirmer", pages: 120, octets: 31457280 }), {
        headers: { "content-type": "application/json" },
      });
    rendre(
      <ImprimerLesPieces
        cabinetId="cabinet"
        pieces={["a", "b"]}
        portee="dossier"
        nom="Client Janvier 2026"
        titre="Client · Janvier 2026"
        libelle="Imprimer Janvier 2026"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Imprimer Janvier 2026/ }));
    const volume = await screen.findByText(/cab\.biblio\.imprimer\.volume/);
    expect(volume.textContent).toContain('"pages":120');
    expect(volume.textContent).toContain('"taille":"30"');
    expect(imprimes).toEqual([]);

    reponse = () => new Response("%PDF-1.4", pdf);
    fireEvent.click(screen.getByRole("button", { name: "cab.biblio.imprimer.quandMeme" }));
    await screen.findByText("cab.biblio.imprimer.pret");
    expect(demandes.map((d) => [d["cabinetId"], d["portee"], d["confirme"]])).toEqual([
      ["cabinet", "dossier", false],
      ["cabinet", "dossier", true],
    ]);
    expect(imprimes).toEqual(["Client Janvier 2026.pdf"]);
  });

  it("au-delà du plafond, dit les pages et la borne, sans rien imprimer", async () => {
    reponse = () =>
      new Response(JSON.stringify({ etat: "trop_volumineuse", pages: 900, pagesMax: 400 }), {
        headers: { "content-type": "application/json" },
      });
    rendre(
      <ImprimerLesPieces
        cabinetId="cabinet"
        pieces={["a"]}
        portee="dossier"
        nom="Client"
        titre="Client"
        libelle="Imprimer le dossier"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Imprimer le dossier/ }));
    const refus = await screen.findByText(/cab\.biblio\.imprimer\.trop/);
    expect(refus.textContent).toContain('"max":400');
    expect(imprimes).toEqual([]);
  });

  it("dit le refus du serveur dans la langue de la personne", async () => {
    reponse = () =>
      new Response(JSON.stringify({ erreur: "refus.introuvable.piece" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    rendre(
      <ImprimerLesPieces
        pieces={["a"]}
        portee="piece"
        nom="Pièce"
        titre="Pièce"
        libelle="Imprimer"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Imprimer/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(imprimes).toEqual([]);
  });
});

describe("imprimer une sélection", () => {
  it("dans la bibliothèque de la comptabilité, n'imprime que les pièces cochées", async () => {
    rendre(<Bibliotheque />);
    expect(await screen.findByText("F-2")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /cab\.biblio\.imprimer\.tout \{"n":2\}/ }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: 'cab.biblio.select {"reference":"F-1"}' }),
    );
    const bouton = await screen.findByRole("button", {
      name: /cab\.biblio\.imprimer\.selection \{"n":1\}/,
    });
    fireEvent.click(bouton);
    await waitFor(() => expect(demandes).toHaveLength(1));
    expect(demandes[0]).toMatchObject({
      pieces: ["p1"],
      cabinetId: "cabinet",
      portee: "selection",
    });
    // Chaque pièce a aussi son propre « Imprimer », à côté de « Télécharger ».
    expect(screen.getAllByRole("button", { name: "cab.biblio.imprimer.piece" })).toHaveLength(2);
  });
});
