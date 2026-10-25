import { describe, expect, it } from "vitest";
import type { Ecriture } from "@malica/socle/ports/repositories";

import {
  avancementDeLaPiece,
  ecritureDeLaPiece,
  noteDeSuppression,
  partageeAvecLeCabinet,
  RANG_COMPTEE,
} from "@/lib/fiche-de-la-piece";

const ecriture = (id: string, autre: Partial<Ecriture> = {}): Ecriture =>
  ({
    id,
    pieceId: "piece",
    journal: "AC",
    dateEcriture: "2026-10-20",
    devise: "TND",
    libelle: "",
    status: "booked",
    vivante: false,
    lines: [],
    ...autre,
  }) as Ecriture;

describe("l'écriture de la pièce", () => {
  it("ignore les règlements et leurs annulations, même inscrits (pièce COMPTOIR)", () => {
    const reglements = [
      ecriture("p1", { journal: "BQ" }),
      ecriture("a1", { journal: "BQ" }),
      ecriture("p2", { journal: "CA" }),
      ecriture("a2", { journal: "CA" }),
    ];
    expect(ecritureDeLaPiece(reglements)).toBeNull();
    expect(avancementDeLaPiece("lue", ecritureDeLaPiece(reglements))).toEqual({
      atteint: 2,
      comptee: false,
    });
  });

  it("retient la vivante, pas la contre-passée", () => {
    const vivante = ecriture("v", { vivante: true });
    expect(ecritureDeLaPiece([ecriture("old"), vivante])).toBe(vivante);
    expect(ecritureDeLaPiece(undefined)).toBeNull();
  });
});

describe("l'avancement : le parcours et « comptée » ne se contredisent jamais", () => {
  const statuts = [
    "capturee",
    "lue",
    "proposee",
    "comptabilisee",
    "supervisee",
    "retournee",
  ] as const;

  it.each(statuts)("statut %s, avec ou sans écriture vivante", (status) => {
    for (const e of [null, ecriture("v", { vivante: true })]) {
      const { atteint, comptee } = avancementDeLaPiece(status, e);
      expect(comptee).toBe(atteint >= RANG_COMPTEE);
      if (e) expect(comptee).toBe(true);
    }
  });

  it("le statut suffit quand l'écriture tarde d'une requête", () => {
    expect(avancementDeLaPiece("comptabilisee", null)).toEqual({ atteint: 4, comptee: true });
    expect(avancementDeLaPiece("supervisee", null)).toEqual({ atteint: 5, comptee: true });
  });

  it("une écriture vivante pousse le parcours à « Comptée »", () => {
    expect(avancementDeLaPiece("proposee", ecriture("v", { vivante: true })).atteint).toBe(
      RANG_COMPTEE,
    );
  });
});

describe("la note de suppression", () => {
  it("se tait sur une pièce rappelée au privé, même si une demande reste en attente", () => {
    expect(noteDeSuppression("demandee", "personnel", false)).toBeNull();
    expect(noteDeSuppression("refusee", "personnel", false)).toBeNull();
    expect(noteDeSuppression("demandee", "entite", false)).toBeNull();
  });

  it("parle quand la pièce est chez le cabinet", () => {
    expect(noteDeSuppression("demandee", "partage", false)).toBe("demandee");
    expect(noteDeSuppression("refusee", "partage", false)).toBe("refusee");
    expect(noteDeSuppression("demandee", "entite", true)).toBe("demandee");
    expect(noteDeSuppression(null, "partage", false)).toBeNull();
    expect(noteDeSuppression("accordee", "partage", false)).toBeNull();
  });

  it("suit la même règle que le bouton « demander la suppression »", () => {
    expect(partageeAvecLeCabinet("partage", false)).toBe(true);
    expect(partageeAvecLeCabinet("entite", true)).toBe(true);
    expect(partageeAvecLeCabinet("entite", false)).toBe(false);
    expect(partageeAvecLeCabinet("personnel", true)).toBe(false);
  });
});
