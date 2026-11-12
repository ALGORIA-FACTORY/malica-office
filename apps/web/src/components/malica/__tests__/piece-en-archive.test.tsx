// @vitest-environment jsdom
/**
 * La pièce d'un mandat terminé (recette du 11 novembre 2026, 1.6) : elle se
 * lit et se télécharge, avec ses écritures, et n'offre aucun autre geste.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Ecriture } from "@malica/socle/ports/repositories";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (cle: string, valeurs?: Record<string, string>) =>
      valeurs ? `${cle} ${Object.values(valeurs).join(" ")}` : cle,
    locale: "fr",
    dir: "ltr",
  }),
}));
vi.mock("@/components/malica/document-view", () => ({
  DocumentView: () => <div data-testid="document" />,
}));

import { PieceEnArchive } from "../piece-en-archive";

const ecriture: Ecriture = {
  id: "e1",
  pieceId: "p1",
  journal: "ACH",
  dateEcriture: "2026-10-02",
  devise: "TND",
  libelle: "Facture essai",
  status: "booked",
  vivante: true,
  packVersionId: "pack",
  bookedAt: "2026-10-02T10:00:00Z",
  lines: [
    {
      ordinal: 1,
      accountCode: "601",
      libelle: "Achat",
      debit: "100.000",
      credit: "0",
      taxCode: null,
    },
    {
      ordinal: 2,
      accountCode: "401",
      libelle: "Fournisseur",
      debit: "0",
      credit: "100.000",
      taxCode: null,
    },
  ],
};

afterEach(cleanup);

describe("la pièce en archive", () => {
  it("dit « mandat terminé · lecture seule », montre la pièce et son écriture", () => {
    render(
      <PieceEnArchive
        retour={<a href="/cabinet/bibliotheque">←</a>}
        mandatClosLe="2026-11-11"
        contenu={new ArrayBuffer(4)}
        ecritures={[ecriture]}
        telechargement={false}
        onTelecharger={() => undefined}
        enregistreSous={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "cab.archive.badge" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("cab.archive.notice 11/11/2026");
    expect(screen.getByTestId("document")).toBeTruthy();
    expect(screen.getByText("Facture essai")).toBeTruthy();
    expect(screen.getByText("601")).toBeTruthy();
    expect(screen.getByText("401")).toBeTruthy();
  });

  it("n'offre qu'un geste : télécharger — ni « Modifier », ni « Retourner »", () => {
    const telecharger = vi.fn();
    render(
      <PieceEnArchive
        retour={<a href="/cabinet/bibliotheque">←</a>}
        mandatClosLe="2026-11-11"
        contenu={new ArrayBuffer(4)}
        ecritures={[ecriture]}
        telechargement={false}
        onTelecharger={telecharger}
        enregistreSous={null}
      />,
    );
    const boutons = screen.getAllByRole("button");
    expect(boutons.map((b) => b.textContent)).toEqual(["cab.review.telecharger"]);
    fireEvent.click(boutons[0]!);
    expect(telecharger).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("input, select, textarea").length).toBe(0);
  });
});
