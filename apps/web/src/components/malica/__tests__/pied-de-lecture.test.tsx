// @vitest-environment jsdom
/**
 * Le pied de « Ce que j'ai lu, ligne par ligne » nomme les montants non lus.
 *
 * Le 10 novembre 2026, sur une facture manuscrite, l'écran accusait « un total
 * qui ne ferme pas » alors que la TVA et le total n'avaient pas été lus (#344).
 * Ces épreuves tiennent la différence : un montant non lu se nomme et mène à sa
 * zone ; seul un total lu qui ne ferme pas garde l'ancien message.
 */
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
      droits={[
        {
          cle: "timbre-0",
          champ: "other_charges[0].amount",
          libelle: "Droit de timbre",
          valeur: "1,000",
        },
      ]}
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

  /*
   * 10 novembre 2026 : un crayon à côté de CHAQUE composante du pied, et trois
   * états distincts par champ — lu, prouvé par le calcul, saisi (avec le nom).
   */
  it("met un crayon à côté de chaque composante, nommé par son champ", () => {
    const corriger = vi.fn();
    monter({ onCorriger: corriger });
    const crayons = screen.getAllByRole("button", { name: /^pme\.crayon\.modifier/ });
    expect(crayons).toHaveLength(4);
    fireEvent.click(crayons[1]!);
    expect(corriger).toHaveBeenCalledWith("totals.vat", "TVA");
    fireEvent.click(crayons[2]!);
    expect(corriger).toHaveBeenCalledWith("other_charges[0].amount", "Droit de timbre");
  });

  it("n'offre aucun crayon quand la pièce est engagée, ni sur un montant du cabinet", () => {
    monter();
    expect(screen.queryAllByRole("button", { name: /pme\.crayon\.modifier/ })).toHaveLength(0);
    cleanup();
    monter({ parLeCabinet: true, onCorriger: vi.fn() });
    expect(screen.queryAllByRole("button", { name: /pme\.crayon\.modifier/ })).toHaveLength(0);
  });

  it("dit pour chaque champ s'il est lu, prouvé par le calcul ou saisi — et par qui", () => {
    monter({
      base: { ...lu("totals.base_ht", "Base HT", "15 000,000"), etat: { genre: "prouve" } },
      tva: {
        ...lu("totals.vat", "TVA", "2 850,000"),
        etat: { genre: "saisi", par: "Amel Ben Salah", lue: "2 350,000" },
      },
      total: { ...lu("totals.ttc", "Total lu sur la pièce", "17 851,000"), etat: { genre: "lu" } },
    });
    expect(screen.getByText(/pme\.crayon\.etat\.prouve/)).toBeTruthy();
    expect(screen.getByText(/pme\.crayon\.etat\.saisi/)).toBeTruthy();
    // La valeur lue reste à côté de la valeur saisie.
    expect(screen.getByText(/pme\.crayon\.etat\.valeurLue/)).toBeTruthy();
    expect(screen.getByText(/pme\.crayon\.etat\.lu/)).toBeTruthy();
  });

  it("ne dit pas « non lu » d'un montant que le cabinet a tranché", () => {
    monter({ parLeCabinet: true, tva: lu("totals.vat", "TVA", null, false) });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("pme.detail.nonLu")).toBeNull();
  });
});
