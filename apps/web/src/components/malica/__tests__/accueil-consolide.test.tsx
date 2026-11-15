// @vitest-environment jsdom
/**
 * L'accueil sous « Toutes les sociétés » (maquette approuvée le 13 novembre 2026, planches A et
 * D) : la lecture la plus basse y est nommée et touchable, une ligne par société ouvre la sienne.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, v?: Record<string, string>) => (v ? `${cle} ${JSON.stringify(v)}` : cle),
    locale: "fr",
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const pme = {
  societeAffichee: null as string | null,
  dossiers: [
    { id: "a", name: "Atelier Zitouna" },
    { id: "m", name: "Medina Textile" },
  ],
  afficherSociete: vi.fn(),
};
vi.mock("../pme-context", () => ({ usePme: () => pme }));
vi.mock("@/hooks/use-societes-en-bref", () => ({
  useSocietesEnBref: () => ({
    lignes: [
      { id: "a", name: "Atelier Zitouna", aTraiter: 0, aLire: 0, enRetard: 0 },
      { id: "m", name: "Medina Textile", aTraiter: 0, aLire: 1, enRetard: 0 },
    ],
    total: () => 0,
    charge: false,
    echeances: [],
  }),
}));
vi.mock("@/hooks/use-lectures-des-societes", () => ({
  useLaPlusBasseDesLectures: () => ({ id: "m", name: "Medina Textile", restantes: 4, droit: 30 }),
}));

import { AccueilConsolide } from "../accueil-consolide";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccueilConsolide", () => {
  it("nomme la lecture la plus basse, et un toucher ouvre cette société", () => {
    render(createElement(AccueilConsolide));
    fireEvent.click(screen.getByRole("button", { name: /pme\.toutes\.lecturePlusBasse/ }));
    expect(pme.afficherSociete).toHaveBeenCalledWith("m");
  });
});
