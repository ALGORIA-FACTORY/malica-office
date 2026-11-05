/**
 * Les comptages du PV suivent la règle de la file (staging, 5 novembre 2026) :
 * le PV disait 2 pièces « en attente de supervision » quand la file en
 * montrait 84.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chiffresDeLaFile } from "./rediger.ts";

describe("les comptages du PV", () => {
  it("comptent ce qui attend le cabinet par la règle de la file", () => {
    const file = [
      { createdAt: "2026-11-02T10:00:00Z", statut: "recue" as const },
      { createdAt: "2026-11-03T10:00:00Z", statut: "vue" as const },
      { createdAt: "2026-10-30T10:00:00Z", statut: "corrigee" as const },
      { createdAt: "2026-11-04T10:00:00Z", statut: "validee" as const },
      { createdAt: "2026-11-04T11:00:00Z", statut: "retournee" as const },
    ];
    const parLibelle = Object.fromEntries(
      chiffresDeLaFile(file, "2026-11", 1).map((c) => [c.label, c.valeur]),
    );
    assert.deepEqual(parLibelle, { pieces: "4", aSuperviser: "3", retournees: "1" });
  });
});
