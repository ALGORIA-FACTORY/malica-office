/**
 * Votre comptabilité — un dossier par cabinet, ses sociétés et ce qui attend.
 *
 * Garantit que l'écran de la PME regroupe ses sociétés par cabinet mandaté, compte les
 * pièces retournées qui attendent une réponse, ne montre rien pour une société sans
 * mandat, et que, depuis une société précise, il ne montre que son cabinet et ce qui
 * l'attend, elle.
 */
import { describe, expect, it } from "vitest";

import type { FicheDeSociete, PieceLue } from "@malica/socle/ports/repositories";

import { cabinetsDesSocietes } from "@/lib/votre-comptabilite";

const fiche = (
  tenantId: string,
  cabinetId: string | null,
  cabinet: string | null,
): FicheDeSociete => ({
  tenantId,
  offre: "basic",
  cabinet,
  cabinetId,
});
const piece = (status: string) => ({ status }) as unknown as PieceLue;

describe("votre comptabilité", () => {
  it("un dossier par cabinet, ses sociétés, ce qui attend ; rien sans mandat", () => {
    const cabinets = cabinetsDesSocietes(
      [
        fiche("a", "c1", "AUDICORP"),
        fiche("b", "c1", "AUDICORP"),
        fiche("c", null, null),
        fiche("d", "c2", "Ben Salah"),
      ],
      new Map([
        ["a", [piece("retournee"), piece("lue")]],
        ["b", [piece("retournee")]],
        ["d", [piece("lue")]],
      ]),
    );
    expect(cabinets).toEqual([
      { id: "c1", nom: "AUDICORP", societes: ["a", "b"], aRepondre: 2 },
      { id: "c2", nom: "Ben Salah", societes: ["d"], aRepondre: 0 },
    ]);
  });

  it("la société de l'en-tête ne montre que son cabinet, et ce qui l'attend, elle", () => {
    const fiches = [
      fiche("a", "c1", "AUDICORP"),
      fiche("b", "c1", "AUDICORP"),
      fiche("d", "c2", "Ben Salah"),
    ];
    const pieces = new Map([
      ["a", [piece("retournee")]],
      ["b", [piece("retournee")]],
    ]);
    expect(cabinetsDesSocietes(fiches, pieces, "a")).toEqual([
      { id: "c1", nom: "AUDICORP", societes: ["a"], aRepondre: 1 },
    ]);
    expect(cabinetsDesSocietes(fiches, pieces, "z")).toEqual([]);
    expect(cabinetsDesSocietes(fiches, pieces, null)).toHaveLength(2);
  });
});
