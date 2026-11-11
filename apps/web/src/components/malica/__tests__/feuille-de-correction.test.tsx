// @vitest-environment jsdom
/**
 * La feuille du crayon : corriger un montant lu sur une facture (#355).
 *
 * La zone de la photo vient au-dessus de la saisie, la saisie se lit par les
 * outils décimaux du Socle à la précision de la devise, et le verdict « tombe
 * juste » ou « pas encore » vient du jugement du serveur, jamais de l'écran (R3).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars ? `${cle} ${JSON.stringify(vars)}` : cle,
    locale: "fr",
  }),
}));
vi.mock("@/hooks/use-superposition", () => ({ useSuperposition: () => undefined }));

import type { JugementDUneCorrection } from "@malica/socle/ports/repositories";

import { FeuilleDeCorrection } from "../feuille-de-correction";

const ferme: JugementDUneCorrection = {
  ferme: true,
  etat: "tranche",
  devise: "TND",
  montants: { baseHt: "15000.000", tva: "2850.000", droits: ["1.000"], ttc: "17851.000" },
  aVerifier: [],
};
const nonFerme: JugementDUneCorrection = {
  ferme: false,
  etat: "incoherent",
  devise: "TND",
  montants: null,
  aVerifier: ["totals.vat"],
};

function monter(surcharge: Partial<Parameters<typeof FeuilleDeCorrection>[0]> = {}) {
  const gestes = {
    onEnregistrer: vi.fn(),
    onFermer: vi.fn(),
    onEncore: vi.fn(),
    onValider: vi.fn(),
  };
  render(
    <FeuilleDeCorrection
      champ="TVA"
      lu="2 350,000"
      devise="TND"
      decimales={3}
      zone={<div data-testid="zone">la zone de la photo</div>}
      enCours={false}
      erreur={null}
      jugement={null}
      montantsRetenus={[]}
      champsAVerifier={[]}
      {...gestes}
      {...surcharge}
    />,
  );
  return gestes;
}

describe("la feuille du crayon", () => {
  afterEach(cleanup);

  it("montre la zone de la photo AU-DESSUS de la saisie, et ce qui avait été lu", () => {
    monter();
    const zone = screen.getByTestId("zone");
    const saisie = screen.getByRole("textbox");
    // La zone précède la saisie dans le document.
    expect(zone.compareDocumentPosition(saisie) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/pme\.crayon\.lu/).textContent).toContain("2 350,000");
    // Le rappel, une fois : on corrige ce que la machine a mal lu.
    expect(screen.getAllByText("pme.crayon.aide")).toHaveLength(1);
  });

  it("lit la saisie par les outils du Socle : « 2 850,000 » s'enregistre « 2850.000 »", () => {
    const g = monter();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2 850,000" } });
    fireEvent.click(screen.getByRole("button", { name: "pme.crayon.enregistrer" }));
    expect(g.onEnregistrer).toHaveBeenCalledWith("2850.000");
  });

  it("refuse en le disant une saisie illisible ou plus précise que la devise", () => {
    const g = monter();
    const champ = screen.getByRole("textbox");
    fireEvent.change(champ, { target: { value: "abc" } });
    expect(screen.getByRole("alert").textContent).toContain("saisie.refus.illisible");
    expect(
      (screen.getByRole("button", { name: "pme.crayon.enregistrer" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(champ, { target: { value: "2850,0001" } });
    expect(screen.getByRole("alert").textContent).toContain("saisie.refus.tropPrecis");
    expect(g.onEnregistrer).not.toHaveBeenCalled();
  });

  it("dit « la facture tombe juste » quand le jugement ferme, avec les montants retenus", () => {
    const g = monter({
      jugement: ferme,
      montantsRetenus: [
        { libelle: "Base HT", valeur: "15 000,000" },
        { libelle: "TVA", valeur: "2 850,000" },
        { libelle: "Total", valeur: "17 851,000" },
      ],
    });
    expect(screen.getByText("pme.crayon.ferme")).toBeTruthy();
    expect(screen.queryByText("pme.crayon.neFermePas")).toBeNull();
    expect(screen.getByText(/2 850,000/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "pme.crayon.valider" }));
    expect(g.onValider).toHaveBeenCalled();
  });

  it("dit « pas encore juste » quand le jugement ne ferme pas, nomme le champ, ne bloque pas", () => {
    const g = monter({ jugement: nonFerme, champsAVerifier: ["TVA"] });
    expect(screen.getByText("pme.crayon.neFermePas")).toBeTruthy();
    expect(screen.queryByText("pme.crayon.ferme")).toBeNull();
    expect(screen.getByText(/pme\.crayon\.aVerifier/).textContent).toContain("TVA");
    // Pas de bouton de validation : la facture ne ferme pas. Mais rien n'est bloqué.
    expect(screen.queryByRole("button", { name: "pme.crayon.valider" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "pme.crayon.encore" }));
    expect(g.onEncore).toHaveBeenCalled();
  });

  it("dit le refus de la base dans la langue de la personne", () => {
    monter({ erreur: "Ce montant a trop de décimales." });
    expect(screen.getByRole("alert").textContent).toBe("Ce montant a trop de décimales.");
  });
});

describe("la feuille du crayon pour une ligne", () => {
  afterEach(cleanup);

  it("le code de TVA se choisit dans la liste donnée, jamais saisi : pas de champ libre, pas de taux", () => {
    const g = monter({
      genre: "code",
      champ: "Code TVA — ligne 1",
      lu: "TVA19",
      choix: [
        { code: "TVA19", label: "TVA taux normal", taux: "0.190000" },
        { code: "TVA07", label: "TVA taux réduit", taux: "0.070000" },
      ],
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent?.replace(/[●○]/, ""))).toEqual([
      "TVA19 · TVA taux normal",
      "TVA07 · TVA taux réduit",
    ]);
    const enregistrer = screen.getByRole("button", {
      name: "pme.crayon.enregistrer",
    }) as HTMLButtonElement;
    expect(enregistrer.disabled).toBe(true);
    fireEvent.click(radios[1]!);
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(enregistrer);
    expect(g.onEnregistrer).toHaveBeenCalledWith("TVA07");
  });

  it("une quantité se lit par le Socle, avec six décimales au plus", () => {
    const g = monter({ genre: "quantite", champ: "Quantité — ligne 1", lu: "200" });
    const champ = screen.getByRole("textbox");
    fireEvent.change(champ, { target: { value: "2,5" } });
    fireEvent.click(screen.getByRole("button", { name: "pme.crayon.enregistrer" }));
    expect(g.onEnregistrer).toHaveBeenCalledWith("2.5");
    fireEvent.change(champ, { target: { value: "1,1234567" } });
    expect(screen.getByRole("alert").textContent).toContain("saisie.refus.tropPrecis");
  });

  it("un libellé s'écrit tel qu'imprimé, blancs resserrés, et jamais vide", () => {
    const g = monter({ genre: "texte", champ: "Libellé — ligne 1", lu: "Ramettes" });
    const champ = screen.getByRole("textbox");
    const enregistrer = screen.getByRole("button", {
      name: "pme.crayon.enregistrer",
    }) as HTMLButtonElement;
    fireEvent.change(champ, { target: { value: "   " } });
    expect(enregistrer.disabled).toBe(true);
    fireEvent.change(champ, { target: { value: "  Ramettes   A4 " } });
    fireEvent.click(enregistrer);
    expect(g.onEnregistrer).toHaveBeenCalledWith("Ramettes A4");
  });

  it("un montant de ligne suit les décimales de la devise", () => {
    monter({ genre: "montant", champ: "Prix unitaire HT — ligne 1", decimales: 2 });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "25,001" } });
    expect(screen.getByRole("alert").textContent).toContain("saisie.refus.tropPrecis");
  });
});
