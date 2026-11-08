// @vitest-environment jsdom
/**
 * Le sélecteur de société de l'en-tête (planche 2, approuvée le 7 novembre 2026).
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

import { SelecteurDeSociete } from "../selecteur-de-societe";

const societes = [
  { id: "a", name: "ALGORIA FACTORY SUARL", matricule: "1234567/A" },
  { id: "z", name: "Atelier Zitouna", matricule: "7654321/B" },
  { id: "s", name: "Société Byrsa", matricule: null },
];

function monter(over: Partial<Parameters<typeof SelecteurDeSociete>[0]> = {}) {
  const onOuvrir = vi.fn();
  const onToutes = vi.fn();
  render(
    createElement(SelecteurDeSociete, {
      societes,
      ouverte: "z",
      surMesSocietes: false,
      onOuvrir,
      onToutes,
      ...over,
    }),
  );
  return { onOuvrir, onToutes };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("le sélecteur de société", () => {
  it("dit la société ouverte et sa place, de A à Z", () => {
    monter();
    const puce = screen.getByRole("button", { expanded: false });
    expect(puce.textContent).toContain("Atelier Zitouna");
    expect(puce.textContent).toContain("2/3");
  });

  it("en vue consolidée, dit « toutes » et leur nombre", () => {
    monter({ surMesSocietes: true });
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain(
      "pme.notifs.toutesSocietes",
    );
  });

  it("cherche sans accents ni casse, par nom ou matricule", () => {
    monter();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const champ = screen.getByRole("searchbox");
    fireEvent.change(champ, { target: { value: "societe" } });
    expect(screen.getByText("Société Byrsa")).toBeTruthy();
    fireEvent.change(champ, { target: { value: "7654321" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(champ, { target: { value: "inexistante" } });
    expect(screen.getByText("pme.societes.aucune")).toBeTruthy();
  });

  it("choisir ouvre la société, la range en récentes et ferme", () => {
    const { onOuvrir } = monter();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByText("ALGORIA FACTORY SUARL")[0]!);
    expect(onOuvrir).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("pme.societes.recentes")).toBeTruthy();
  });

  it("épingler range la société en tête ; « Toutes » ouvre « Mes sociétés »", () => {
    const { onToutes } = monter();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: "pme.societes.epingler" })[0]!);
    expect(screen.getByText("pme.societes.epinglees")).toBeTruthy();
    fireEvent.click(screen.getByText("pme.notifs.toutesSocietes"));
    expect(onToutes).toHaveBeenCalled();
  });

  it("l'en-tête nomme la société ouverte", () => {
    monter({ ouverte: "s" });
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain("Société Byrsa");
  });

  it("Échap ferme", () => {
    monter();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
