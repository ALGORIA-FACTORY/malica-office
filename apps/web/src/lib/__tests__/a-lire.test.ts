import { describe, expect, it } from "vitest";
import type { PieceLue } from "@malica/socle/ports/repositories";

import { piecesALire } from "@/lib/a-lire";

const piece = (id: string, autre: Partial<PieceLue> = {}): PieceLue => ({
  id,
  status: "capturee",
  createdAt: "2026-10-24T10:00:00Z",
  vis: "personnel",
  gardeeLe: null,
  emetteur: null,
  dateDocument: null,
  kind: null,
  typeDeDocument: null,
  total: null,
  devise: null,
  lectureRefusee: null,
  ...autre,
});

describe("les pièces à lire", () => {
  it("retient les prises non lues, ni gardées, ni refusées, la plus récente d'abord", () => {
    const r = piecesALire([
      piece("ancienne", { createdAt: "2026-10-20T10:00:00Z" }),
      piece("lue", { status: "lue" }),
      piece("gardee", { gardeeLe: "2026-10-23" }),
      piece("refusee", { lectureRefusee: { motif: "plafond_atteint", le: "2026-10-23" } }),
      piece("recente", { createdAt: "2026-10-24T12:00:00Z" }),
    ]);
    expect(r.map((p) => p.id)).toEqual(["recente", "ancienne"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [piece("a", { createdAt: "2026-10-20T10:00:00Z" }), piece("b")];
    piecesALire(liste);
    expect(liste.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
