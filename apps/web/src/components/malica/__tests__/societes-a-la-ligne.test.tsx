// @vitest-environment jsdom
/**
 * Une société par ligne : ce que TVA, Charges et la capture montrent sous « Toutes les sociétés »
 * (maquette approuvée le 13 novembre 2026). Un écran d'une seule société le dit, et se laisse
 * ouvrir d'un toucher.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }),
}));

const pme = {
  tenantId: "z",
  societeAffichee: null as string | null,
  dossiers: [
    { id: "a", name: "Atelier Zitouna", matricule: null, role: null },
    { id: "z", name: "SOTUMAG SARL", matricule: null, role: null },
  ],
  afficherSociete: vi.fn(),
  choisirDossier: vi.fn(),
};
vi.mock("../pme-context", () => ({ usePme: () => pme }));

import { SocietesALaLigne } from "../societes-a-la-ligne";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SocietesALaLigne", () => {
  it("dit pourquoi l'écran est par société, et nomme chaque société", () => {
    render(createElement(SocietesALaLigne, { note: "pme.toutes.parSociete", mode: "ouvrir" }));
    expect(screen.getByText("pme.toutes.parSociete")).toBeTruthy();
    expect(screen.getByText("Atelier Zitouna")).toBeTruthy();
    expect(screen.getByText("SOTUMAG SARL")).toBeTruthy();
  });

  it("« ouvrir » : un toucher sur une société la montre, et quitte « Toutes »", () => {
    render(createElement(SocietesALaLigne, { note: "pme.toutes.parSociete", mode: "ouvrir" }));
    fireEvent.click(screen.getByText("Atelier Zitouna"));
    expect(pme.afficherSociete).toHaveBeenCalledWith("a");
  });

  it("« choisir » : la société choisie reçoit la pièce, et la vue reste « Toutes »", () => {
    render(
      createElement(SocietesALaLigne, { note: "pme.toutes.pourQuelleSociete", mode: "choisir" }),
    );
    const prise = screen.getByRole("radio", { name: /SOTUMAG SARL/ });
    expect(prise.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Atelier Zitouna/ }));
    expect(pme.choisirDossier).toHaveBeenCalledWith("a");
    expect(pme.afficherSociete).not.toHaveBeenCalled();
  });
});
