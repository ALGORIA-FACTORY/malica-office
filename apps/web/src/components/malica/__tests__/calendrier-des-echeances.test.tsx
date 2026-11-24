// @vitest-environment jsdom
/**
 * Le calendrier des échéances (ordinateur) — placer les jours, jamais les recalculer.
 *
 * Garantit que le mois ouvert est celui du jour, qu'un jour prend le ton le plus urgent de
 * ses échéances, que le jour courant est annoncé comme tel, et que les deux flèches changent
 * de mois.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }),
}));

import { CalendrierDesEcheances } from "../calendrier-des-echeances";

afterEach(cleanup);

const cellule = (n: string) =>
  screen.getAllByRole("cell").find((c) => c.firstChild?.textContent === n) as HTMLElement;

describe("CalendrierDesEcheances", () => {
  it("ouvre le mois du jour et garde le ton le plus urgent d'un jour", () => {
    render(
      <CalendrierDesEcheances
        aujourdHui="2026-11-24"
        jours={[
          { date: "2026-11-20", ton: "", libelle: "TVA" },
          { date: "2026-11-20", ton: "ve", libelle: "CNSS" },
          { date: "2026-11-30", ton: "am", libelle: "IRPP" },
          { date: "2026-12-21", ton: "", libelle: "Acompte" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Novembre 2026" })).toBeTruthy();
    expect(cellule("20").getAttribute("data-ton")).toBe("ve");
    expect(cellule("20").textContent).toContain("TVA, CNSS");
    expect(cellule("30").getAttribute("data-ton")).toBe("am");
    expect(cellule("24").getAttribute("aria-current")).toBe("date");
    expect(cellule("21").getAttribute("data-ton")).toBeNull();
  });

  it("passe au mois suivant puis revient", () => {
    render(
      <CalendrierDesEcheances
        aujourdHui="2026-11-24"
        jours={[{ date: "2026-12-21", ton: "", libelle: "Acompte" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "pme.echeances.moisSuivant" }));
    expect(screen.getByRole("heading", { name: "Décembre 2026" })).toBeTruthy();
    expect(cellule("21").getAttribute("data-ton")).toBe("echeance");
    fireEvent.click(screen.getByRole("button", { name: "pme.echeances.moisPrecedent" }));
    expect(screen.getByRole("heading", { name: "Novembre 2026" })).toBeTruthy();
  });
});
