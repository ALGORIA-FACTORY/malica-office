// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, vars?: { champs?: string }) =>
      vars?.champs ? `${cle} [${vars.champs}]` : cle,
    locale: "fr",
  }),
}));

import { PiedDeLecture, type MontantDuPied } from "../pied-de-lecture";

const lu = (champ: string, libelle: string, valeur: string | null, aUneSource = true) =>
  ({ champ, libelle, valeur, aUneSource }) satisfies MontantDuPied;

function monter(
  surcharge: Partial<Parameters<typeof PiedDeLecture>[0]> = {},
  onVoirLaSource = vi.fn(),
) {
  render(
    <PiedDeLecture
      base={lu("totals.base_ht", "Base HT", "15 000,000")}
      tva={lu("totals.vat", "TVA", "2 850,000")}
      droits={[{ cle: "timbre-0", libelle: "Droit de timbre", valeur: "1,000" }]}
      total={lu("totals.ttc", "Total lu sur la pièce", "17 851,000")}
      devise="TND"
      parLeCabinet={false}
      totalNeFermePas={false}
      onVoirLaSource={onVoirLaSource}
      {...surcharge}
    />,
  );
  return onVoirLaSource;
}

describe("le pied de « Ce que j'ai lu, ligne par ligne »", () => {
  afterEach(cleanup);

  it("ne dit rien quand tout est lu et que le total ferme", () => {
    monter();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("17 851,000 TND")).toBeTruthy();
  });

  /*
   * 10 novembre 2026, facture manuscrite : TVA située mais non lue, total non
   * lu. L'écran disait « Les montants lus ne vérifient pas ce total ».
   */
  it("nomme les montants non lus au lieu de parler d'un total qu'il n'a pas", () => {
    const voir = monter({
      tva: lu("totals.vat", "TVA", null),
      total: lu("totals.ttc", "Total lu sur la pièce", null, false),
      totalNeFermePas: true,
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "pme.detail.montantsNonLus [TVA et Total lu sur la pièce]",
    );
    expect(screen.queryByText("pme.detail.totalNeFermePas")).toBeNull();
    // Située sans être lue : la TVA mène à sa zone sur la pièce.
    fireEvent.click(screen.getByRole("button", { name: "pme.detail.nonLuVoir" }));
    expect(voir).toHaveBeenCalledWith("totals.vat");
    // Sans source, rien à ouvrir, et aucune devise posée après « non lu ».
    expect(screen.getByText("pme.detail.nonLu").tagName).toBe("SPAN");
    expect(screen.queryByText(/TND/)).toBeNull();
  });

  it("garde le message d'avant quand le total est lu mais ne ferme pas", () => {
    monter({ totalNeFermePas: true });
    expect(screen.getByRole("alert").textContent).toBe("pme.detail.totalNeFermePas");
  });

  it("ne dit pas « non lu » d'un montant que le cabinet a tranché", () => {
    monter({ parLeCabinet: true, tva: lu("totals.vat", "TVA", null, false) });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("pme.detail.nonLu")).toBeNull();
  });
});
