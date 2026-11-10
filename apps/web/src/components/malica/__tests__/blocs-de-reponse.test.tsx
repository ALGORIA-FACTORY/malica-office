// @vitest-environment jsdom
/**
 * Les blocs d'une réponse : l'écran dessine ce que le serveur a composé, sans
 * rien calculer, comparer ni reformater.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlocDeReponse } from "@malica/socle/ports/assistant";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params: { pieceId: string };
  }) => <a href={to.replace("$pieceId", params.pieceId)}>{children}</a>,
}));

import { I18nProvider } from "@/i18n";
import { chargerLesEspaces } from "@/i18n/dictionnaires";

import { BlocsDeReponse } from "../blocs-de-reponse";

beforeEach(async () => {
  window.localStorage.setItem("malica.locale", "fr");
  await chargerLesEspaces("fr");
});
afterEach(cleanup);

const rendre = (blocs: BlocDeReponse[], espace: "pme" | "cabinet" = "pme") =>
  render(
    <I18nProvider>
      <BlocsDeReponse blocs={blocs} espace={espace} />
    </I18nProvider>,
  );

const TVA: BlocDeReponse = {
  type: "reponse_cle",
  titre: "TVA du mois",
  periode: "Novembre 2026",
  perimetre: "SOTUMAG SARL",
  source: "Moteur de TVA · pièces prises en compte : 1",
  cle: { libelle: "Crédit de TVA", valeur: "342,000", unite: "TND", ton: "positif" },
  details: [
    { libelle: "TVA collectée", valeur: "0,000", unite: "TND", ton: "neutre" },
    { libelle: "TVA déductible", valeur: "342,000", unite: "TND", ton: "neutre" },
  ],
};

const ACHATS: BlocDeReponse = {
  type: "tableau",
  titre: "Achats par fournisseur",
  periode: "Toutes les dates",
  perimetre: null,
  source: "Factures d'achat lues · pièces comptées : 4",
  colonnes: [
    { id: "fournisseur", libelle: "Fournisseur", numerique: false },
    { id: "montant", libelle: "Montant TTC (TND)", numerique: true },
    { id: "pieces", libelle: "Pièces", numerique: true },
  ],
  lignes: [
    { fournisseur: "Sismara", montant: "8 000,000", pieces: "2" },
    { fournisseur: "Electro Import", montant: "4 999,000", pieces: "1" },
    { fournisseur: "Kordane", montant: "900,500", pieces: "1" },
  ],
  total: { fournisseur: "Total", montant: "13 899,500", pieces: "4" },
  // « 900,500 » viendrait avant « 4 999,000 » en texte : seul le serveur sait l'ordre.
  ordres: { fournisseur: [1, 2, 0], montant: [2, 1, 0], pieces: [1, 2, 0] },
  pieces: [
    [
      { id: "p-1", titre: "28/10/2026 · 7 872,677 TND" },
      { id: "p-2", titre: "02/11/2026 · 127,323 TND" },
    ],
    [{ id: "p-3", titre: "09/10/2026 · 4 999,000 TND" }],
    null,
  ],
};

const MOIS: BlocDeReponse = {
  type: "graphique",
  forme: "barres",
  titre: "Achats et ventes par mois",
  periode: "Septembre 2026 – Novembre 2026",
  perimetre: "SOTUMAG SARL",
  source: "Totaux TTC des factures lues · pièces comptées : 5",
  unite: "TND",
  series: [
    {
      nom: "Ventes",
      ton: "positif",
      points: [
        { etiquette: "sept. 26", valeur: null, part: 0 },
        { etiquette: "oct. 26", valeur: "99 999,000", part: 1 },
        { etiquette: "nov. 26", valeur: null, part: 0 },
      ],
    },
    {
      nom: "Achats",
      ton: "neutre",
      points: [
        { etiquette: "sept. 26", valeur: null, part: 0 },
        { etiquette: "oct. 26", valeur: "17 082,177", part: 0.171 },
        { etiquette: "nov. 26", valeur: "127,323", part: 0.001 },
      ],
    },
  ],
};

const lignesDuCorps = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1, -1)
    .map((r) => r.textContent);

describe("le chiffre clé", () => {
  it("s'écrit tel que le serveur l'a composé, avec son détail, sa période et sa source", () => {
    rendre([TVA]);
    const bloc = document.querySelector('[data-bloc="reponse_cle"]') as HTMLElement;
    expect(within(bloc).getByText("Crédit de TVA")).toBeTruthy();
    expect(within(bloc).getAllByText("342,000").length).toBe(2);
    expect(within(bloc).getByText("Novembre 2026")).toBeTruthy();
    expect(
      within(bloc).getByText("Moteur de TVA · pièces prises en compte : 1 · SOTUMAG SARL"),
    ).toBeTruthy();
    expect(within(bloc).getAllByText("342,000")[0]!.parentElement!.className).toContain(
      "text-signal-ok",
    );
  });
});

describe("le tableau", () => {
  it("garde l'ordre du serveur, ses en-têtes et sa ligne de total, et défile dans son cadre", () => {
    rendre([ACHATS]);
    const table = screen.getByRole("table");
    expect(lignesDuCorps()).toEqual([
      "Sismara8 000,0002",
      "Electro Import4 999,0001",
      "Kordane900,5001",
    ]);
    expect(within(table).getAllByRole("row").at(-1)!.textContent).toBe("Total13 899,5004");
    expect(table.parentElement!.className).toContain("overflow-auto");
  });

  it("se trie par l'ordre que le serveur donne : un montant d'abord du plus grand au plus petit", () => {
    rendre([ACHATS]);
    const enTete = (nom: string) => screen.getByRole("columnheader", { name: new RegExp(nom) });
    fireEvent.click(screen.getByRole("button", { name: "Trier par Montant TTC (TND)" }));
    expect(enTete("Montant").getAttribute("aria-sort")).toBe("descending");
    expect(lignesDuCorps().map((l) => l!.slice(0, 7))).toEqual(["Sismara", "Electro", "Kordane"]);
    // Un second appui inverse — et « 900,500 » passe bien avant « 4 999,000 ».
    fireEvent.click(screen.getByRole("button", { name: "Trier par Montant TTC (TND)" }));
    expect(enTete("Montant").getAttribute("aria-sort")).toBe("ascending");
    expect(lignesDuCorps().map((l) => l!.slice(0, 7))).toEqual(["Kordane", "Electro", "Sismara"]);
    // Un nom se lit d'abord de A à Z.
    fireEvent.click(screen.getByRole("button", { name: "Trier par Fournisseur" }));
    expect(lignesDuCorps().map((l) => l!.slice(0, 7))).toEqual(["Electro", "Kordane", "Sismara"]);
    expect(enTete("Montant").getAttribute("aria-sort")).toBeNull();
  });

  it("toucher une ligne ouvre ses pièces, chacune vers son écran ; une ligne sans pièce ne s'ouvre pas", () => {
    rendre([ACHATS]);
    const bouton = screen.getByRole("button", { name: "Voir les pièces de Sismara" });
    expect(bouton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(bouton);
    expect(bouton.getAttribute("aria-expanded")).toBe("true");
    const liens = screen.getAllByRole("link");
    expect(liens.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["28/10/2026 · 7 872,677 TND", "/pme/piece/p-1"],
      ["02/11/2026 · 127,323 TND", "/pme/piece/p-2"],
    ]);
    expect(screen.queryByRole("button", { name: "Voir les pièces de Kordane" })).toBeNull();
    // Une seule ligne ouverte à la fois ; la refermer retire ses liens.
    fireEvent.click(screen.getByRole("button", { name: "Voir les pièces d’Electro Import" }));
    expect(screen.getAllByRole("link").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Voir les pièces d’Electro Import" }));
    expect(screen.queryAllByRole("link").length).toBe(0);
  });

  it("dans l'espace de la comptabilité, une pièce s'ouvre côté comptabilité", () => {
    rendre([ACHATS], "cabinet");
    fireEvent.click(screen.getByRole("button", { name: "Voir les pièces d’Electro Import" }));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/cabinet/piece/p-3");
  });
});

describe("les barres", () => {
  it("dessinent la hauteur que le serveur donne, et rien pour une période sans valeur", () => {
    rendre([MOIS]);
    const bloc = document.querySelector('[data-bloc="graphique"]') as HTMLElement;
    const periodes = within(bloc).getAllByRole("button");
    expect(periodes.map((p) => p.getAttribute("aria-label"))).toEqual([
      "sept. 26, Ventes —, Achats —",
      "oct. 26, Ventes 99 999,000, Achats 17 082,177",
      "nov. 26, Ventes —, Achats 127,323",
    ]);
    const hauteurs = (i: number) =>
      [...periodes[i]!.querySelectorAll<HTMLElement>("span > span")].map((b) => b.style.height);
    expect(hauteurs(0)).toEqual(["0px", "0px"]);
    expect(hauteurs(1)).toEqual(["max(2px, 100%)", "max(2px, 17.1%)"]);
    expect(hauteurs(2)).toEqual(["0px", "max(2px, 0.1%)"]);
  });

  it("écrit d'abord la dernière période qui porte une valeur, puis celle qu'on touche", () => {
    rendre([MOIS]);
    const bloc = document.querySelector('[data-bloc="graphique"]') as HTMLElement;
    expect(within(bloc).getByText("Achats · nov. 26")).toBeTruthy();
    expect(within(bloc).getByText("127,323")).toBeTruthy();
    fireEvent.click(within(bloc).getAllByRole("button")[1]!);
    expect(within(bloc).getByText("Ventes · oct. 26")).toBeTruthy();
    expect(within(bloc).getByText("99 999,000")).toBeTruthy();
    expect(within(bloc).getByText("17 082,177")).toBeTruthy();
  });
});

describe("plusieurs blocs", () => {
  it("se suivent dans l'ordre, et aucun bloc ne rend rien", () => {
    const { container } = rendre([TVA, ACHATS, MOIS]);
    expect(
      [...container.querySelectorAll("[data-bloc]")].map((b) => b.getAttribute("data-bloc")),
    ).toEqual(["reponse_cle", "tableau", "graphique"]);
    cleanup();
    expect(rendre([]).container.querySelector("[data-bloc]")).toBeNull();
  });
});
