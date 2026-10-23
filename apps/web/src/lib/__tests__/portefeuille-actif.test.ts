import { describe, expect, it } from "vitest";
import { idsDesMandatsActifs, trancheDEcheance } from "../portefeuille-actif";

describe("le périmètre opérationnel du cabinet", () => {
  it("écarte les dossiers terminés, suspendus et proposés même si une lecture privilégiée les rend", () => {
    const actifs = idsDesMandatsActifs([
      { tenantId: "client-actif", engagementStatus: "actif" },
      { tenantId: "ancien", engagementStatus: "termine" },
      { tenantId: "suspendu", engagementStatus: "suspendu" },
      { tenantId: "a-accepter", engagementStatus: "propose" },
    ]);
    expect([...actifs]).toEqual(["client-actif"]);
    expect([...idsDesMandatsActifs([])]).toEqual([]);
  });
});

describe("les horizons d'échéances", () => {
  it("ne range pas les retards avec les prochains jours", () => {
    expect(trancheDEcheance("2026-10-21", "2026-10-22")).toBe("retard");
    expect(trancheDEcheance("2026-10-22", "2026-10-22")).toBe("semaine");
    expect(trancheDEcheance("2026-10-29", "2026-10-22")).toBe("semaine");
    expect(trancheDEcheance("2026-10-30", "2026-10-22")).toBe("mois");
    expect(trancheDEcheance("2026-11-21", "2026-10-22")).toBe("mois");
    expect(trancheDEcheance("2026-11-22", "2026-10-22")).toBe("suite");
  });
});
