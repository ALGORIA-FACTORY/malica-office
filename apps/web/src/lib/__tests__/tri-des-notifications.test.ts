import { describe, expect, it } from "vitest";

import { compteurs, sourceDe, trier, type NotificationTriee } from "../tri-des-notifications";

/*
 * Planche 2 (approuvée le 7 novembre 2026) : 108 cartes une par une
 * deviennent quelques lignes, triées par onglet, société, période, genre.
 */
const MAINTENANT = Date.parse("2026-11-08T12:00:00Z");
let n = 0;
function alerte(kind: string, joursAvant: number, tenantId = "A", lue = false): NotificationTriee {
  n += 1;
  return {
    id: `n${n}`,
    tenantId,
    kind,
    payload: {},
    readAt: lue ? "2026-11-08T10:00:00Z" : null,
    createdAt: new Date(MAINTENANT - joursAvant * 86_400_000 - n * 1000).toISOString(),
  };
}

const boite = [
  ...Array.from({ length: 9 }, () => alerte("piece.retournee", 1)),
  alerte("piece.demande", 2, "B"),
  alerte("conseil.decide", 3),
  ...Array.from({ length: 5 }, () => alerte("piece.supprimee", 1, "A", true)),
  alerte("piece.retournee", 20, "B"),
];

describe("le tri de l'écran des notifications", () => {
  it("chaque alerte a sa source", () => {
    expect(sourceDe("piece.retournee")).toBe("comptabilite");
    expect(sourceDe("conseil.decide")).toBe("malica");
    expect(sourceDe("piece.supprimee")).toBe("autre");
  });

  it("les neuf retours de la semaine sont UNE ligne ; l'ancien reste à part", () => {
    const sections = trier(
      boite,
      { onglet: "aTraiter", societe: null, nonLuesSeulement: false },
      MAINTENANT,
    );
    expect(sections.map((s) => s.periode)).toEqual(["semaine", "avant"]);
    const retours = sections[0]!.groupes.find((g) => g.kind === "piece.retournee")!;
    expect(retours.elements).toHaveLength(9);
    expect(retours.nonLues).toBe(9);
    expect(sections[1]!.groupes[0]!.elements).toHaveLength(1);
  });

  it("À traiter ne montre que ce qui attend un geste", () => {
    const kinds = trier(
      boite,
      { onglet: "aTraiter", societe: null, nonLuesSeulement: false },
      MAINTENANT,
    ).flatMap((s) => s.groupes.map((g) => g.kind));
    expect(kinds).not.toContain("conseil.decide");
    expect(kinds).not.toContain("piece.supprimee");
  });

  it("Malica, Comptabilité, Tout", () => {
    const de = (onglet: "malica" | "comptabilite" | "tout") =>
      trier(boite, { onglet, societe: null, nonLuesSeulement: false }, MAINTENANT).flatMap((s) =>
        s.groupes.map((g) => g.kind),
      );
    expect(de("malica")).toEqual(["conseil.decide"]);
    expect(new Set(de("comptabilite"))).toEqual(new Set(["piece.retournee", "piece.demande"]));
    expect(de("tout")).toContain("piece.supprimee");
  });

  it("une société, et les non lues seules", () => {
    const deB = trier(boite, { onglet: "tout", societe: "B", nonLuesSeulement: false }, MAINTENANT);
    expect(
      deB.flatMap((s) => s.groupes.flatMap((g) => g.elements)).every((e) => e.tenantId === "B"),
    ).toBe(true);
    const nonLues = trier(
      boite,
      { onglet: "tout", societe: null, nonLuesSeulement: true },
      MAINTENANT,
    );
    expect(nonLues.flatMap((s) => s.groupes.map((g) => g.kind))).not.toContain("piece.supprimee");
  });

  it("les compteurs des onglets comptent le non lu de la société choisie", () => {
    expect(compteurs(boite, null)).toEqual({ aTraiter: 11, comptabilite: 11, malica: 1, tout: 12 });
    expect(compteurs(boite, "B")).toEqual({ aTraiter: 2, comptabilite: 2, malica: 0, tout: 2 });
  });
});
