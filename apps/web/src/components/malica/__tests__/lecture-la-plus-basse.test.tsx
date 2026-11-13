// @vitest-environment jsdom
/**
 * La lecture la plus basse sous « Toutes les sociétés » : nommée, et un toucher ouvre cette
 * société (décision du dirigeant, 13 novembre 2026). Aucun total : chaque société a sa licence.
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

const pme = {
  societeAffichee: null as string | null,
  dossiers: [
    { id: "a", name: "Atelier Zitouna" },
    { id: "m", name: "Medina Textile" },
  ],
  afficherSociete: vi.fn(),
};
vi.mock("../pme-context", () => ({ usePme: () => pme }));

let basse: { id: string; name: string; restantes: number; droit: number | null } | null = null;
vi.mock("@/hooks/use-lectures-des-societes", () => ({
  useLaPlusBasseDesLectures: (actif: boolean) => (actif ? basse : null),
}));

import { LectureLaPlusBasse } from "../lecture-la-plus-basse";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pme.societeAffichee = null;
  basse = null;
});

describe("LectureLaPlusBasse", () => {
  it("nomme la société la plus basse, et un toucher l'ouvre", () => {
    basse = { id: "m", name: "Medina Textile", restantes: 4, droit: 30 };
    render(createElement(LectureLaPlusBasse));
    const bouton = screen.getByRole("button", { name: /Medina Textile/ });
    expect(bouton.textContent).toContain("4");
    fireEvent.click(bouton);
    expect(pme.afficherSociete).toHaveBeenCalledWith("m");
  });

  it("ne montre rien quand aucune lecture n'est connue", () => {
    render(createElement(LectureLaPlusBasse));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ne montre rien sous une société : son compteur est le sien", () => {
    pme.societeAffichee = "a";
    basse = { id: "m", name: "Medina Textile", restantes: 4, droit: 30 };
    render(createElement(LectureLaPlusBasse));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
