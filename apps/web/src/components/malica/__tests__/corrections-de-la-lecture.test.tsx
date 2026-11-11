// @vitest-environment jsdom
/**
 * Le cabinet voit ce que la personne a corrigé avec le crayon (#355).
 *
 * Une saisie ne passe jamais pour une lecture : le cabinet lit la valeur
 * saisie, la valeur que la lecture avait trouvée (ou « rien »), l'auteur et le
 * moment. La précision s'ajoute, la lecture reste (R7).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: Record<string, unknown>) =>
      vars ? `${cle} ${JSON.stringify(vars)}` : cle,
    locale: "fr",
  }),
}));

import { CorrectionsDeLaLecture } from "../corrections-de-la-lecture";

describe("le cabinet voit ce que la personne a corrigé", () => {
  afterEach(cleanup);

  it("ne dit rien d'une pièce sans correction", () => {
    const { container } = render(<CorrectionsDeLaLecture corrections={[]} />);
    expect(container.textContent).toBe("");
  });

  it("montre la valeur saisie, la valeur lue, l'auteur et le moment", () => {
    render(
      <CorrectionsDeLaLecture
        corrections={[
          {
            champ: "totals.vat",
            valeur: "2850.000",
            lue: "2350.000",
            par: "Amel Ben Salah",
            le: "2026-11-10T10:30:00Z",
          },
        ]}
      />,
    );
    const texte = (document.body.textContent ?? "").replace(/[\s\u00a0\u202f]/g, " ");
    expect(texte).toContain("2 850,000");
    expect(texte).toContain("2 350,000");
    expect(texte).toContain("Amel Ben Salah");
    expect(texte).toContain("pme.crayon.cabinet.note");
  });

  it("dit « rien » quand la lecture n'avait rien lu", () => {
    render(
      <CorrectionsDeLaLecture
        corrections={[
          {
            champ: "totals.vat",
            valeur: "1.000",
            lue: null,
            par: null,
            le: "2026-11-10T10:30:00Z",
          },
        ]}
      />,
    );
    expect(document.body.textContent).toContain("pme.crayon.cabinet.luRien");
    expect(document.body.textContent).toContain("pme.crayon.etat.saisiSans");
  });
});
