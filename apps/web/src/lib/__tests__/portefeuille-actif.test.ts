/**
 * Le portefeuille actif du cabinet — quels dossiers comptent, et quelles échéances.
 *
 * Garantit que seuls les mandats actifs entrent dans le périmètre opérationnel, même si
 * une lecture privilégiée rend aussi les dossiers terminés, suspendus ou proposés, et que
 * les échéances sont rangées en retard, semaine, mois ou suite, sans mêler les retards
 * aux prochains jours.
 */
import { describe, expect, it } from "vitest";
import {
  compterLesMandatsActifs,
  dossiersAOuvrir,
  idsDesMandatsActifs,
  trancheDEcheance,
} from "../portefeuille-actif";

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

describe("le compte des mandats et les dossiers qu'on ouvre", () => {
  const clients = [
    { tenantId: "actif", engagementStatus: "actif", archive: false },
    { tenantId: "propose", engagementStatus: "propose", archive: false },
    { tenantId: "refuse", engagementStatus: "termine", archive: false },
    { tenantId: "archive", engagementStatus: "termine", archive: true },
  ];

  it("ne compte que les mandats actifs : ni la proposition, ni le refus, ni l'archive", () => {
    expect(compterLesMandatsActifs(clients)).toBe(1);
    expect(compterLesMandatsActifs([])).toBe(0);
  });

  it("n'ouvre que les mandats actifs et l'archive : un refus n'est pas une archive", () => {
    expect(dossiersAOuvrir(clients).map((c) => c.tenantId)).toEqual(["actif", "archive"]);
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
