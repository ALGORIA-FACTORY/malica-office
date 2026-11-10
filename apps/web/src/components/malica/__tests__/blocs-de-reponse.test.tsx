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

const api = vi.hoisted(() => ({
  exporterUnBloc: vi.fn(),
  enregistrerUnFichier: vi.fn(),
  rendreBlocEnPdf: vi.fn(),
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({ malica: { exporterUnBloc: api.exporterUnBloc } }),
}));
vi.mock("@/capabilities/enregistrer-un-fichier", () => ({
  enregistrerUnFichier: api.enregistrerUnFichier,
}));
vi.mock("@/capabilities/bloc-pdf", () => ({ rendreBlocEnPdf: api.rendreBlocEnPdf }));

import { I18nProvider } from "@/i18n";
import { chargerLesEspaces } from "@/i18n/dictionnaires";

import { BlocsDeReponse } from "../blocs-de-reponse";

beforeEach(async () => {
  api.exporterUnBloc.mockReset().mockResolvedValue(new Blob(["x"]));
  api.enregistrerUnFichier.mockReset().mockResolvedValue({ chemin: null });
  api.rendreBlocEnPdf.mockReset().mockResolvedValue(new Blob(["p"]));
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

const FEUILLE = {
  entete: ["Fournisseur", "Montant TTC (TND)", "Pièces"],
  lignes: [[{ texte: "Sismara" }, { montant: "8000.000" }, { montant: "2" }]],
  totaux: [[{ texte: "Total" }, { montant: "13899.500" }, { montant: "4" }]],
};

const RESULTAT: BlocDeReponse = {
  type: "cascade",
  titre: "Du chiffre d'affaires au résultat",
  periode: "Octobre 2026 – Novembre 2026",
  perimetre: "SOTUMAG SARL",
  source: "Écritures comptabilisées, totaux par classe",
  unite: "TND",
  etapes: [
    { libelle: "Produits", valeur: "186 300,000", ton: "neutre", debut: 0, fin: 1 },
    { libelle: "Charges", valeur: "154 460,000", ton: "negatif", debut: 0.171, fin: 1 },
    { libelle: "Résultat", valeur: "31 840,000", ton: "positif", debut: 0, fin: 0.171 },
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
    const periodes = [...bloc.querySelectorAll<HTMLElement>("button[aria-pressed]")];
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
    fireEvent.click(bloc.querySelectorAll<HTMLElement>("button[aria-pressed]")[1]!);
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

describe("la courbe", () => {
  const LONGUE: BlocDeReponse = {
    ...(MOIS as Extract<BlocDeReponse, { type: "graphique" }>),
    forme: "courbe",
    series: [
      {
        nom: "Ventes",
        ton: "positif",
        points: [
          { etiquette: "juin 26", valeur: "10,000", part: 0.5 },
          { etiquette: "juil. 26", valeur: "20,000", part: 1 },
          { etiquette: "août 26", valeur: null, part: 0 },
          { etiquette: "sept. 26", valeur: "5,000", part: 0.25 },
        ],
      },
    ],
  };

  it("trace un trait par suite de périodes, et le COUPE sur une période sans valeur", () => {
    rendre([LONGUE]);
    const bloc = document.querySelector('[data-bloc="graphique"]') as HTMLElement;
    const traits = [...bloc.querySelectorAll("svg path")].map((p) => p.getAttribute("d"));
    // juin → juillet (un tronçon), puis septembre seul (un point marqué) : jamais de trait par-dessus août.
    expect(traits).toEqual(["M12.50 50.00 L37.50 4.00 ", "M87.50 73.00 l0.01 0"]);
    // Aucune barre n'est dessinée en courbe, mais chaque période reste touchable.
    expect(bloc.querySelectorAll("button[aria-pressed] span > span").length).toBe(0);
    fireEvent.click(within(bloc).getAllByRole("button", { pressed: false })[0]!);
    expect(within(bloc).getByText("Ventes · juin 26")).toBeTruthy();
  });
});

describe("la cascade", () => {
  it("pose chaque barre entre le début et la fin que le serveur donne, et écrit chaque valeur", () => {
    rendre([RESULTAT]);
    const bloc = document.querySelector('[data-bloc="cascade"]') as HTMLElement;
    const etapes = within(bloc).getAllByRole("listitem");
    expect(etapes.map((e) => e.textContent)).toEqual([
      "Produits186 300,000TND",
      "Charges154 460,000TND",
      "Résultat31 840,000TND",
    ]);
    const barre = (i: number) => etapes[i]!.querySelector<HTMLElement>("span > span")!.style;
    expect([barre(0).bottom, barre(0).height]).toEqual(["0%", "max(2px, 100%)"]);
    expect([barre(1).bottom, barre(1).height]).toEqual(["17.1%", "max(2px, 82.9%)"]);
    expect([barre(2).bottom, barre(2).height]).toEqual(["0%", "max(2px, 17.1%)"]);
    // Les charges portent le signal « arrêt », le résultat positif le signal « bon ».
    expect(etapes[1]!.querySelector("span > span")!.className).toContain("bg-signal-stop");
    expect(etapes[2]!.querySelector("span > span")!.className).toContain("bg-signal-ok");
  });
});

describe("sortir un bloc de l'écran", () => {
  it("en classeur : la feuille du bloc part telle quelle, et le fichier est remis sous le titre du bloc", async () => {
    rendre([{ ...ACHATS, feuille: FEUILLE }]);
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(await screen.findByText("Fichier enregistré.")).toBeTruthy();
    expect(api.exporterUnBloc).toHaveBeenCalledWith({
      titre: "Achats par fournisseur",
      droiteAGauche: false,
      feuille: FEUILLE,
    });
    expect(api.enregistrerUnFichier.mock.calls[0]![1]).toBe("Achats par fournisseur.xlsx");
  });

  it("en PDF : ce que l'écran montre, mis à plat, dans le sens de lecture de la langue", async () => {
    rendre([RESULTAT]);
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByText("Fichier enregistré.")).toBeTruthy();
    const [imprimable, direction] = api.rendreBlocEnPdf.mock.calls[0]!;
    expect(direction).toBe("ltr");
    expect(imprimable).toEqual({
      titre: "Du chiffre d'affaires au résultat",
      sousTitre: "Octobre 2026 – Novembre 2026 · SOTUMAG SARL",
      pied: "Écritures comptabilisées, totaux par classe",
      entete: [],
      lignes: [
        ["Produits", "186 300,000 TND"],
        ["Charges", "154 460,000 TND"],
      ],
      totaux: [["Résultat", "31 840,000 TND"]],
      numerique: [false, true],
    });
    expect(api.enregistrerUnFichier.mock.calls[0]![1]).toBe(
      "Du chiffre d'affaires au résultat.pdf",
    );
  });

  it("sans feuille, pas de bouton Excel ; un export qui échoue le dit", async () => {
    rendre([ACHATS]);
    expect(screen.queryByRole("button", { name: "Excel" })).toBeNull();
    api.rendreBlocEnPdf.mockRejectedValueOnce(new Error("canevas"));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByText("L'export n'a pas abouti. Réessayez.")).toBeTruthy();
    expect(api.enregistrerUnFichier).not.toHaveBeenCalled();
  });
});

describe("la carte de chaleur", () => {
  const SOCIETES: BlocDeReponse = {
    type: "carte",
    titre: "Ventes par société et par mois",
    periode: "Septembre 2026 – Novembre 2026",
    perimetre: "2 sociétés",
    source: "Totaux TTC des factures de vente lues",
    unite: "TND",
    colonnes: ["sept. 26", "oct. 26", "nov. 26"],
    lignes: [
      {
        libelle: "SOTUMAG",
        cellules: [
          { valeur: null, part: 0 },
          { valeur: "99 999,000", part: 1 },
          { valeur: null, part: 0 },
        ],
        total: "99 999,000",
      },
      {
        libelle: "Nordex SARL",
        cellules: [
          { valeur: null, part: 0 },
          { valeur: "5 000,000", part: 0.05 },
          { valeur: "2 500,500", part: 0.025 },
        ],
        total: "7 500,500",
      },
    ],
  };

  it("écrit chaque valeur dans sa case, teinte par la part du serveur, et laisse vide une case sans valeur", () => {
    rendre([SOCIETES]);
    const bloc = document.querySelector('[data-bloc="carte"]') as HTMLElement;
    const lignes = within(bloc).getAllByRole("row").slice(1);
    expect(lignes.map((l) => l.textContent)).toEqual([
      "SOTUMAG—99 999,000—99 999,000",
      "Nordex SARL—5 000,0002 500,5007 500,500",
    ]);
    const cases = (i: number) =>
      [...lignes[i]!.querySelectorAll<HTMLElement>("td")]
        .slice(0, 3)
        .map((c) => c.style.background);
    // La plus forte case est la plus pleine ; une case vide n'a pas de fond.
    expect(cases(0)).toEqual([
      "transparent",
      "color-mix(in srgb, var(--signal-ok) 50%, transparent)",
      "transparent",
    ]);
    expect(cases(1)[1]).toBe("color-mix(in srgb, var(--signal-ok) 10%, transparent)");
    expect(
      within(bloc).getByText("Totaux TTC des factures de vente lues · 2 sociétés"),
    ).toBeTruthy();
  });
});
