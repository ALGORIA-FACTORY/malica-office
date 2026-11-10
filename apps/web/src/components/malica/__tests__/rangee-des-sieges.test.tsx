// @vitest-environment jsdom
/**
 * La rangée des sièges d'un dossier (10 novembre 2026) : un choix, pas une liste.
 *
 *   — la rangée montre cinq pastilles puis « +n », jamais une carte par siège ;
 *   — l'anneau dit si une pièce du siège attend la personne ;
 *   — la toucher ouvre la feuille ; choisir un siège le laisse seul devant ;
 *   — la croix revient à tous ;
 *   — quand l'en-tête montre toutes les sociétés, chaque siège dit la sienne.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars && "count" in vars ? `${cle}:${String(vars["count"])}` : cle,
    locale: "fr",
  }),
}));

import type { PieceLue } from "@malica/socle/ports/repositories";
import { RangeeDesSieges, type Siege } from "../rangee-des-sieges";

/**
 * Une pièce de la société : « à envoyer » (dans la société, pas encore partie)
 * attend la personne ; « prise en charge » par le cabinet, non.
 */
function piece(id: string, etat: "a_envoyer" | "prise_en_charge"): PieceLue {
  return {
    id,
    vis: etat === "a_envoyer" ? "entite" : "partage",
    status: "lue",
    gardeeLe: null,
    circuit: null,
    suivi: etat === "prise_en_charge" ? { prise: "prise_en_charge" } : null,
  } as unknown as PieceLue;
}

const sieges: Siege[] = [
  { id: "amel", nom: "Amel", pieces: [piece("p1", "a_envoyer"), piece("p2", "prise_en_charge")] },
  { id: "sami", nom: "Sami", pieces: [piece("p3", "prise_en_charge")] },
  { id: "mariem", nom: "Mariem", pieces: [piece("p4", "prise_en_charge")] },
  { id: "karim", nom: "Karim", pieces: [piece("p5", "a_envoyer")] },
  { id: "hedi", nom: "Hedi", pieces: [piece("p6", "prise_en_charge")] },
  { id: "nour", nom: "Nour", pieces: [piece("p7", "prise_en_charge")] },
  { id: "rim", nom: "Rim", pieces: [piece("p8", "prise_en_charge")] },
];

function monter(choisi: string | null, extra: Partial<Siege> = {}) {
  const choisir = vi.fn();
  const surface = document.createElement("div");
  surface.dataset["surface"] = "pme";
  document.body.appendChild(surface);
  render(
    createElement(RangeeDesSieges, {
      sieges: sieges.map((s) => ({ ...s, ...extra })),
      choisi,
      choisir,
    }),
    { container: surface.appendChild(document.createElement("div")) },
  );
  return { choisir, surface };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("la rangée des sièges", () => {
  it("montre cinq pastilles puis « +n », pas une carte par siège", () => {
    const { surface } = monter(null);
    const pastilles = surface.querySelectorAll(".rangee .past:not(.plus)");
    expect(pastilles).toHaveLength(5);
    expect(surface.querySelector(".past.plus")?.textContent).toBe("+2");
    expect(screen.queryByText("Sami")).toBeNull();
  });

  it("l'anneau dit si une pièce du siège attend la personne", () => {
    const { surface } = monter(null);
    // Ceux qui attendent d'abord : Amel puis Karim portent l'anneau Amber.
    const tons = [...surface.querySelectorAll(".rangee .past:not(.plus)")].map((p) =>
      p.getAttribute("data-ton"),
    );
    expect(tons.slice(0, 2)).toEqual(["am", "am"]);
    expect(tons.slice(2)).toEqual(["ok", "ok", "ok"]);
  });

  it("la toucher ouvre la feuille, et choisir un siège le remonte", () => {
    const { choisir } = monter(null);
    fireEvent.click(screen.getByRole("button", { name: "pme.sieges.choisirParmi:7" }));
    const feuille = screen.getByRole("dialog", { name: "pme.sieges.changer" });
    expect(feuille).toBeTruthy();
    // Tous les sièges sont dans la feuille, dans l'ordre : en attente d'abord.
    const noms = [...feuille.querySelectorAll("ul .so b")].map((b) => b.textContent);
    expect(noms.slice(0, 2)).toEqual(["Amel", "Karim"]);
    expect(noms).toHaveLength(7);
    fireEvent.click(screen.getByText("Sami"));
    expect(choisir).toHaveBeenCalledWith("sami");
  });

  it("un siège choisi reste seul devant ; la croix revient à tous", () => {
    const { choisir, surface } = monter("amel");
    expect(surface.querySelector(".rangee[data-choisi]")).toBeTruthy();
    expect(surface.querySelector(".past[data-grande]")?.textContent).toBe("A");
    expect(screen.getByText("Amel")).toBeTruthy();
    expect(screen.queryByText("Sami")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "pme.sieges.tous" }));
    expect(choisir).toHaveBeenCalledWith(null);
  });

  it("toutes les sociétés dans l'en-tête : chaque siège dit la sienne", () => {
    monter(null, { societe: "SOTUMAG" });
    fireEvent.click(screen.getByRole("button", { name: "pme.sieges.choisirParmi:7" }));
    const feuille = screen.getByRole("dialog", { name: "pme.sieges.changer" });
    const sous = [...feuille.querySelectorAll("ul .bd span")].map((s) => s.textContent);
    expect(sous.every((x) => x?.startsWith("SOTUMAG · "))).toBe(true);
  });
});
