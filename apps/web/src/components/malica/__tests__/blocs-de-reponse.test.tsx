// @vitest-environment jsdom
/**
 * Les blocs d'une réponse : l'écran dessine ce que le serveur a composé, sans
 * rien calculer ni reformater.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BlocDeReponse } from "@malica/socle/ports/assistant";

import { BlocsDeReponse } from "../blocs-de-reponse";

afterEach(cleanup);

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

const CALENDRIER: BlocDeReponse = {
  type: "tableau",
  titre: "Calendrier fiscal",
  periode: null,
  perimetre: null,
  source: "Calendrier du dossier",
  colonnes: [
    { id: "echeance", libelle: "Échéance", numerique: false },
    { id: "montant", libelle: "Montant", numerique: true },
  ],
  lignes: [
    { echeance: "Déclaration de TVA", montant: "1 090,504" },
    { echeance: "Acompte provisionnel", montant: "2 400,000" },
  ],
  total: { echeance: "Total", montant: "3 490,504" },
};

describe("les blocs d'une réponse", () => {
  it("le chiffre clé s'écrit tel que le serveur l'a composé, avec son détail, sa période et sa source", () => {
    render(<BlocsDeReponse blocs={[TVA]} />);
    const bloc = document.querySelector('[data-bloc="reponse_cle"]') as HTMLElement;
    expect(bloc).not.toBeNull();
    expect(within(bloc).getByText("Crédit de TVA")).toBeTruthy();
    // Trois fois la valeur telle quelle : le chiffre clé et la TVA déductible — jamais reformatée.
    expect(within(bloc).getAllByText("342,000").length).toBe(2);
    expect(within(bloc).getByText("0,000")).toBeTruthy();
    expect(within(bloc).getByText("Novembre 2026")).toBeTruthy();
    expect(
      within(bloc).getByText("Moteur de TVA · pièces prises en compte : 1 · SOTUMAG SARL"),
    ).toBeTruthy();
    // Le crédit porte le signal « bon », pas la couleur d'un bouton.
    expect(within(bloc).getAllByText("342,000")[0]!.parentElement!.className).toContain(
      "text-signal-ok",
    );
  });

  it("le tableau garde l'ordre du serveur, ses en-têtes de colonne et sa ligne de total", () => {
    render(<BlocsDeReponse blocs={[CALENDRIER]} />);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Échéance", "Montant"]);
    const lignes = within(table).getAllByRole("row");
    expect(lignes.map((r) => r.textContent)).toEqual([
      "ÉchéanceMontant",
      "Déclaration de TVA1 090,504",
      "Acompte provisionnel2 400,000",
      "Total3 490,504",
    ]);
    // Il défile dans son cadre : c'est le cadre qui déborde, jamais la bulle.
    expect(table.parentElement!.className).toContain("overflow-auto");
  });

  it("plusieurs blocs se suivent dans l'ordre, et aucun bloc ne rend rien", () => {
    const { container, rerender } = render(<BlocsDeReponse blocs={[TVA, CALENDRIER]} />);
    expect(
      [...container.querySelectorAll("[data-bloc]")].map((b) => b.getAttribute("data-bloc")),
    ).toEqual(["reponse_cle", "tableau"]);
    rerender(<BlocsDeReponse blocs={[]} />);
    expect(container.querySelector("[data-bloc]")).toBeNull();
  });
});
