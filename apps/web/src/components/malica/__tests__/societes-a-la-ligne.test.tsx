// @vitest-environment jsdom
/**
 * Une société par ligne : ce que TVA, Charges et la capture montrent sous « Toutes les sociétés »
 * (maquette approuvée le 13 novembre 2026). Un écran d'une seule société le dit, et se laisse
 * ouvrir d'un toucher.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }),
}));

const pme = {
  tenantId: "z",
  societeAffichee: null as string | null,
  dossiers: [
    {
      id: "a",
      name: "Atelier Zitouna",
      matricule: null,
      role: null,
      jurisdiction: "SN",
      currency: "XOF",
    },
    {
      id: "z",
      name: "SOTUMAG SARL",
      matricule: null,
      role: null,
      jurisdiction: "TN",
      currency: "TND",
    },
  ],
  afficherSociete: vi.fn(),
  choisirDossier: vi.fn(),
};
const chiffres = vi.hoisted(() => ({ tva: vi.fn(), charges: vi.fn() }));
vi.mock("@/lib/chiffre-par-societe", () => ({
  chiffreTva: chiffres.tva,
  chiffreCharges: chiffres.charges,
}));
vi.mock("../pme-context", () => ({ usePme: () => pme }));

import { SocietesALaLigne } from "../societes-a-la-ligne";

/** Un écran de test : le cache est neuf à chaque rendu, une société ne lit pas celle d'une autre. */
function rendre(el: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, el));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SocietesALaLigne", () => {
  it("dit pourquoi l'écran est par société, et nomme chaque société", () => {
    rendre(createElement(SocietesALaLigne, { note: "pme.toutes.parSociete", mode: "ouvrir" }));
    expect(screen.getByText("pme.toutes.parSociete")).toBeTruthy();
    expect(screen.getByText("Atelier Zitouna")).toBeTruthy();
    expect(screen.getByText("SOTUMAG SARL")).toBeTruthy();
  });

  it("« ouvrir » : un toucher sur une société la montre, et quitte « Toutes »", () => {
    rendre(createElement(SocietesALaLigne, { note: "pme.toutes.parSociete", mode: "ouvrir" }));
    fireEvent.click(screen.getByText("Atelier Zitouna"));
    expect(pme.afficherSociete).toHaveBeenCalledWith("a");
  });

  it("« choisir » : la société choisie reçoit la pièce, et la vue reste « Toutes »", () => {
    rendre(
      createElement(SocietesALaLigne, { note: "pme.toutes.pourQuelleSociete", mode: "choisir" }),
    );
    const prise = screen.getByRole("radio", { name: /SOTUMAG SARL/ });
    expect(prise.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Atelier Zitouna/ }));
    expect(pme.choisirDossier).toHaveBeenCalledWith("a");
    expect(pme.afficherSociete).not.toHaveBeenCalled();
  });

  describe("avec un chiffre (TVA, Charges)", () => {
    const ecran = { nature: "tva" as const, periode: "2026-11" };

    it("montre, par société, le chiffre du moteur dans SA devise — et aucun total", async () => {
      chiffres.tva.mockImplementation(async (s: { id: string }) =>
        s.id === "z"
          ? { etat: "calcule", montant: "212.000", devise: "TND", sens: "du" }
          : { etat: "calcule", montant: "-35000", devise: "XOF", sens: "credit" },
      );
      rendre(
        createElement(SocietesALaLigne, {
          note: "pme.toutes.parSociete",
          mode: "ouvrir",
          chiffre: ecran,
        }),
      );
      await waitFor(() => expect(screen.getByText("TND")).toBeTruthy());
      expect(screen.getByText("XOF")).toBeTruthy();
      // Chaque société a lu SA juridiction, SA devise, SON mois.
      expect(chiffres.tva).toHaveBeenCalledWith(
        { id: "a", jurisdiction: "SN", currency: "XOF" },
        "2026-11",
        "fr",
      );
      expect(screen.getByText("pme.tva.aPayer")).toBeTruthy();
      expect(screen.getByText("pme.tva.credit")).toBeTruthy();
      // Le crédit s'écrit sans signe (la légende dit le sens), et rien n'est additionné.
      expect(screen.queryByText(/177/)).toBeNull();
      expect(document.querySelectorAll(".mt").length).toBe(2);
    });

    it("une société sans chiffre dit pourquoi : aucun montant, aucun zéro", async () => {
      chiffres.tva.mockImplementation(async (s: { id: string }) =>
        s.id === "z" ? { etat: "regimeAbsent" } : { etat: "sansJuridiction" },
      );
      rendre(
        createElement(SocietesALaLigne, {
          note: "pme.toutes.parSociete",
          mode: "ouvrir",
          chiffre: ecran,
        }),
      );
      await waitFor(() => expect(screen.getByText("pme.toutes.etat.regimeAbsent")).toBeTruthy());
      expect(screen.getByText("pme.toutes.etat.sansJuridiction")).toBeTruthy();
      expect(document.querySelectorAll(".mt").length).toBe(0);
    });

    it("une lecture refusée ou en panne se dit « indisponible », jamais zéro", async () => {
      chiffres.tva.mockRejectedValue(new Error("refus.acces"));
      rendre(
        createElement(SocietesALaLigne, {
          note: "pme.toutes.parSociete",
          mode: "ouvrir",
          chiffre: ecran,
        }),
      );
      await waitFor(() =>
        expect(screen.getAllByText("pme.toutes.chiffre.indisponible").length).toBe(2),
      );
      expect(document.querySelectorAll(".mt").length).toBe(0);
    });

    it("la ligne reste touchable : elle ouvre la société", async () => {
      chiffres.tva.mockResolvedValue({ etat: "nonAssujetti" });
      rendre(
        createElement(SocietesALaLigne, {
          note: "pme.toutes.parSociete",
          mode: "ouvrir",
          chiffre: ecran,
        }),
      );
      await waitFor(() =>
        expect(screen.getAllByText("pme.toutes.etat.nonAssujetti").length).toBe(2),
      );
      fireEvent.click(screen.getByText("SOTUMAG SARL"));
      expect(pme.afficherSociete).toHaveBeenCalledWith("z");
    });

    it("Charges : le total du mois, légendé « charges du mois »", async () => {
      chiffres.charges.mockResolvedValue({ etat: "calcule", montant: "1500.000", devise: "TND" });
      rendre(
        createElement(SocietesALaLigne, {
          note: "pme.toutes.parSociete",
          mode: "ouvrir",
          chiffre: { nature: "charges", periode: "2026-11" },
        }),
      );
      await waitFor(() => expect(screen.getAllByText("pme.toutes.chiffre.charges").length).toBe(2));
    });
  });
});
