/**
 * Sans comptabilité, la TVA compte les mêmes pièces que les charges (24 novembre 2026).
 * Pilote : la pièce MAP de juillet pesait 400 aux charges et 0 à la TVA.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const o = vi.hoisted(() => ({
  office: { extraitsTransmis: vi.fn(), bookedExtracts: vi.fn() },
}));
vi.mock("@/verticals/malica-office/composition", () => ({ office: () => o }));

import { extraitsDeLaTvaDuMois } from "../extraits-de-la-tva-du-mois";

describe("les pièces de la TVA du mois", () => {
  beforeEach(() => vi.clearAllMocks());

  it("avec une comptabilité : les pièces transmises, sans estimation", async () => {
    o.office.extraitsTransmis.mockResolvedValue([{ pieceId: "a", extract: {} }]);
    const r = await extraitsDeLaTvaDuMois("s", true, "2026-07-01", "2026-07-31");
    expect(r).toEqual({ lignes: [{ pieceId: "a", extract: {} }], estimation: false });
    expect(o.office.bookedExtracts).not.toHaveBeenCalled();
  });

  it("sans comptabilité : la pièce qui tient compte, marquée estimation", async () => {
    o.office.bookedExtracts.mockResolvedValue([]);
    o.office.extraitsTransmis.mockResolvedValue([{ pieceId: "map", extract: { lu: 1 } }]);
    const r = await extraitsDeLaTvaDuMois("s", false, "2026-07-01", "2026-07-31");
    expect(r).toEqual({ lignes: [{ pieceId: "map", extract: { lu: 1 } }], estimation: true });
  });

  it("une pièce écrite n'est comptée qu'une fois : l'écriture l'emporte", async () => {
    o.office.bookedExtracts.mockResolvedValue([{ pieceId: "AB", extract: { ecrit: 1 } }]);
    o.office.extraitsTransmis.mockResolvedValue([{ pieceId: "ab", extract: { lu: 1 } }]);
    const r = await extraitsDeLaTvaDuMois("s", false, "2026-07-01", "2026-07-31");
    expect(r).toEqual({ lignes: [{ pieceId: "AB", extract: { ecrit: 1 } }], estimation: false });
  });
});
