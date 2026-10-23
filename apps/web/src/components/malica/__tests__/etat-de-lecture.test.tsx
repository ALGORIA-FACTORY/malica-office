// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (cle: string) => cle, locale: "fr" }) }));

import { EtatDeLecture } from "../lecture-refusee";

describe("l'état de lecture d'une pièce, dans une liste", () => {
  afterEach(cleanup);

  it("tait le motif que la section dit déjà une fois", () => {
    render(<EtatDeLecture refus={null} vis="personnel" motifDitAilleurs="piece_personnelle" />);
    expect(screen.getByText("pme.refus.titre")).toBeTruthy();
    expect(screen.queryByText("pme.refus.piece_personnelle")).toBeNull();
  });

  it("garde la phrase d'un AUTRE motif, même sur une pièce rendue privée", () => {
    render(
      <EtatDeLecture
        refus={{ motif: "plafond_atteint" }}
        vis="personnel"
        motifDitAilleurs="piece_personnelle"
      />,
    );
    expect(screen.getByText("pme.refus.plafond_atteint")).toBeTruthy();
  });
});
