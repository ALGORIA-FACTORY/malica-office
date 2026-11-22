/** Les échéances de l'accueil, une ligne par jour (22 novembre 2026). */
import { describe, expect, it } from "vitest";

import { echeancesParJour, regrouperParJour } from "../echeances-par-jour";

const e = (id: string, dueDate: string, label: string, status = "a_faire", tenantId = "a") => ({
  id,
  dueDate,
  label,
  status,
  tenantId,
});

describe("les échéances groupées par jour", () => {
  it("quatre déclarations du 20 novembre font une ligne, comptée, sans leur détail", () => {
    const jours = echeancesParJour(
      [
        e("1", "2026-11-20", "TVA"),
        e("2", "2026-11-20", "Timbre"),
        e("3", "2026-11-20", "TCL"),
        e("4", "2026-11-20", "Retenues"),
        e("5", "2026-11-30", "FOPROLOS"),
      ],
      "2026-11-22",
      5,
    );
    expect(jours.map((j) => [j.dueDate, j.n, j.seule, j.jours])).toEqual([
      ["2026-11-20", 4, null, -2],
      ["2026-11-30", 1, "FOPROLOS", 8],
    ]);
  });

  it("une échéance faite ne compte plus ; deux sociétés gardent chacune leur jour", () => {
    const jours = echeancesParJour(
      [
        e("1", "2026-11-20", "TVA", "fait"),
        e("2", "2026-11-20", "TVA", "a_faire", "b"),
        e("3", "2026-11-20", "TCL", "a_faire", "a"),
      ],
      "2026-11-22",
      5,
    );
    expect(jours.map((j) => [j.tenantId, j.n])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("le nombre de jours montrés est borné", () => {
    const jours = echeancesParJour(
      [e("1", "2026-11-20", "A"), e("2", "2026-11-21", "B"), e("3", "2026-11-22", "C")],
      "2026-11-22",
      2,
    );
    expect(jours.map((j) => j.dueDate)).toEqual(["2026-11-20", "2026-11-21"]);
  });
});

describe("l'écran des échéances groupe aussi par jour", () => {
  it("une ligne par jour, et les déposées à part, sans la liste", () => {
    const jours = regrouperParJour(
      [
        e("1", "2026-11-20", "TVA", "en_retard"),
        e("2", "2026-11-20", "Timbre", "en_retard"),
        e("3", "2026-11-20", "TCL", "fait"),
        e("4", "2026-11-30", "FOPROLOS"),
      ],
      "2026-11-22",
    );
    expect(jours.map((j) => [j.dueDate, j.faites, j.n, j.seule])).toEqual([
      ["2026-11-20", false, 2, null],
      ["2026-11-20", true, 1, "TCL"],
      ["2026-11-30", false, 1, "FOPROLOS"],
    ]);
    expect(jours[0]!.premiere.id).toBe("1");
  });
});
