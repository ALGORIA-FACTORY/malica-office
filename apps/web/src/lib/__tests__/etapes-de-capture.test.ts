import { describe, expect, it } from "vitest";

import { etapesVisibles } from "@/lib/etapes-de-capture";

describe("les étapes comptées en tête de la capture", () => {
  it("la société : huit étapes quand tout se pose", () => {
    expect(etapesVisibles(false, false, false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("sans questions ni dates, deux de moins", () => {
    expect(etapesVisibles(false, true, true)).toEqual([1, 2, 3, 4, 7, 8]);
  });
  it("pour moi : « Pour qui ? » puis la fin", () => {
    expect(etapesVisibles(true, false, false)).toEqual([1, 8]);
  });
});
