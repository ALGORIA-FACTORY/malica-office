// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars ? `${cle} ${JSON.stringify(vars)}` : cle,
    locale: "fr",
  }),
}));

import type { CorrectionDeLecture } from "@malica/socle/ports/repositories";

import { LigneDeLecture } from "../ligne-de-lecture";

const article = {
  designation: "Ramettes papier A4",
  quantity: "200",
  unit_price_ht: "25.000",
  unit_price_ttc: null,
  total_ht: "5000.000",
  tax_code: "TVA19",
};

function monter(
  corrections: ReadonlyMap<string, CorrectionDeLecture> = new Map(),
  onCorriger: ((champ: string, libelle: string) => void) | null = vi.fn(),
) {
  render(
    <LigneDeLecture
      index={1}
      article={article}
      lisible={(v) => (v ? v.replace(".", ",") : null)}
      quantite={(v) => v}
      corrections={corrections}
      devise="TND"
      onCorriger={onCorriger ?? undefined}
    />,
  );
  return onCorriger;
}

describe("une ligne de la facture, avec son crayon sur chaque composante", () => {
  afterEach(cleanup);

  it("met un crayon sur le libellé, la quantité, le prix unitaire, le montant et le code TVA", () => {
    const corriger = monter();
    const crayons = screen.getAllByRole("button", { name: /^pme\.crayon\.modifier/ });
    expect(crayons).toHaveLength(5);
    // Chaque crayon désigne SA composante, par le chemin de citation de la ligne.
    crayons.forEach((c) => fireEvent.click(c));
    expect((corriger as ReturnType<typeof vi.fn>).mock.calls.map((a) => a[0])).toEqual([
      "articles[1].designation",
      "articles[1].total_ht",
      "articles[1].quantity",
      "articles[1].unit_price_ht",
      "articles[1].tax_code",
    ]);
  });

  it("n'offre aucun crayon quand la pièce n'est plus à la personne", () => {
    monter(new Map(), null);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/200/)).toBeTruthy();
  });

  it("dit qui a saisi, et ce que la lecture avait lu — une saisie ne passe pas pour une lecture", () => {
    monter(
      new Map([
        [
          "articles[1].unit_price_ht",
          {
            champ: "articles[1].unit_price_ht",
            valeur: "26.000",
            lue: "25.000",
            par: "Amel Ben Salah",
            le: "2026-11-10T10:00:00Z",
          },
        ],
      ]),
    );
    expect(screen.getByText(/pme\.crayon\.etat\.saisi/).textContent).toContain("Amel Ben Salah");
    expect(screen.getByText(/pme\.crayon\.etat\.valeurLue/).textContent).toContain("25,000 TND");
  });
});
