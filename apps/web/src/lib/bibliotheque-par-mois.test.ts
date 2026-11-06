import { describe, expect, it } from "vitest";

import {
  AUTRES,
  compter,
  etatDu,
  moisPrecedent,
  rangerParMois,
  totalDu,
  typeRange,
} from "./bibliotheque-par-mois";

const piece = (date: string, extra: Record<string, unknown> = {}) => ({
  dateDeClassement: date,
  montant: "10.000" as string | null,
  devise: "TND",
  statut: "validee" as const,
  ...extra,
});

describe("la bibliothèque rangée par mois", () => {
  it("passe d'un mois au précédent, même en janvier", () => {
    expect(moisPrecedent("2026-06")).toBe("2026-05");
    expect(moisPrecedent("2026-01")).toBe("2025-12");
  });

  it("range du plus récent au plus ancien et regroupe les mois sans pièce", () => {
    const r = rangerParMois([
      piece("2026-01-15"),
      piece("2026-06-03"),
      piece("2026-02-10"),
      piece("2026-06-20"),
    ]);
    expect(
      r.map((x) =>
        x.genre === "mois" ? `${x.mois}:${x.pieces.length}` : `${x.du}>${x.au}:${x.n}`,
      ),
    ).toEqual(["2026-06:2", "2026-05>2026-03:3", "2026-02:1", "2026-01:1"]);
  });

  it("ne signale aucun trou avant la première pièce ni après la dernière", () => {
    expect(rangerParMois([piece("2026-03-01")])).toHaveLength(1);
    expect(rangerParMois([])).toEqual([]);
  });

  it("traverse le changement d'année", () => {
    const r = rangerParMois([piece("2026-02-01"), piece("2025-11-01")]);
    expect(r[1]).toEqual({ genre: "trou", du: "2026-01", au: "2025-12", n: 2 });
  });

  it("additionne exactement, et refuse un total faux", () => {
    expect(
      totalDu([
        piece("2026-01-01", { montant: "278.687" }),
        piece("2026-01-02", { montant: "0.313" }),
      ]),
    ).toEqual({ genre: "montant", montant: "279.000", devise: "TND" });
    expect(totalDu([piece("2026-01-01", { montant: null }), piece("2026-01-02")])).toEqual({
      genre: "a_saisir",
      manquants: 1,
    });
    expect(
      totalDu([piece("2026-01-01"), piece("2026-01-02", { devise: "EUR", montant: "1.00" })]).genre,
    ).toBe("devises");
  });

  it("dit l'état d'un groupe depuis le statut du Socle", () => {
    expect(etatDu([piece("2026-01-01"), piece("2026-01-02", { statut: "vue" })])).toBe("a_valider");
    expect(etatDu([piece("2026-01-01", { statut: "retournee" })])).toBe("chez_le_client");
    expect(etatDu([piece("2026-01-01"), piece("2026-01-02", { statut: "forcee" })])).toBe("pret");
    expect(etatDu([piece("2026-01-01", { statut: undefined })])).toBe("neutre");
  });

  it("compte ce qui attend, les mois vides et les mois prêts", () => {
    const r = rangerParMois([
      piece("2026-06-03", { statut: "vue", montant: null }),
      piece("2026-02-10"),
      piece("2026-01-15"),
    ]);
    expect(compter(r)).toEqual({ aValider: 1, moisSansPiece: 3, moisPrets: 2 });
  });

  it("range un type inconnu du référentiel avec les autres", () => {
    const connus = new Set(["facture_achat"]);
    expect(typeRange("facture_achat", connus)).toBe("facture_achat");
    expect(typeRange("inconnu", connus)).toBe(AUTRES);
    expect(typeRange(null, connus)).toBe(AUTRES);
  });
});
