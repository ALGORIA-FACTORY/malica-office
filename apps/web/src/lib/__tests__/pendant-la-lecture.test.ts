import { describe, expect, it } from "vitest";

import { etapeMontree } from "@/lib/pendant-la-lecture";

describe("l'étape montrée pendant la lecture", () => {
  const t0 = "2026-11-08T10:00:00.000Z";
  const plus = (ms: number) => Date.parse(t0) + ms;
  it("commence par le fournisseur", () => {
    expect(etapeMontree(t0, plus(0))).toBe(0);
    expect(etapeMontree(t0, plus(3_999))).toBe(0);
  });
  it("avance toutes les quatre secondes", () => {
    expect(etapeMontree(t0, plus(4_000))).toBe(1);
    expect(etapeMontree(t0, plus(12_500))).toBe(3);
  });
  it("tient la dernière étape jusqu'à la fin", () => {
    expect(etapeMontree(t0, plus(600_000))).toBe(4);
  });
  it("sans date lisible, ou une horloge en retard : la première", () => {
    expect(etapeMontree(null, plus(10_000))).toBe(0);
    expect(etapeMontree("pas une date", plus(10_000))).toBe(0);
    expect(etapeMontree(t0, plus(-5_000))).toBe(0);
  });
});
