import { describe, expect, it } from "vitest";
import type { Ecriture } from "@malica/socle/ports/repositories";

import {
  avancementDeLaPiece,
  ecritureDeLaPiece,
  etiquetteDeLecture,
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
    expect(noteDeSuppression("demandee", "personnel")).toBeNull();
    expect(noteDeSuppression("refusee", "personnel")).toBeNull();
    expect(noteDeSuppression("demandee", "entite")).toBeNull();
  });

  it("parle quand la pièce est chez le cabinet", () => {
    expect(noteDeSuppression("demandee", "partage")).toBe("demandee");
    expect(noteDeSuppression("refusee", "partage")).toBe("refusee");
    expect(noteDeSuppression("demandee", "entite")).toBeNull();
    expect(noteDeSuppression(null, "partage")).toBeNull();
    expect(noteDeSuppression("accordee", "partage")).toBeNull();
  });

  it("suit la même règle que le bouton « demander la suppression »", () => {
    expect(partageeAvecLeCabinet("partage")).toBe(true);
    expect(partageeAvecLeCabinet("entite")).toBe(false);
    expect(partageeAvecLeCabinet("personnel")).toBe(false);
  });
});

describe("l'étiquette d'une ligne lue (maquette « C »)", () => {
  it("une pièce comptée dit « confirmé », quelle que soit la confiance du jugement", () => {
    for (const aVerifier of [true, false])
      for (const confianceConnue of [true, false])
        expect(etiquetteDeLecture({ comptee: true, confianceConnue, aVerifier })).toBe("confirme");
  });

  it("avant, le jugement décide : « à vérifier » ou « source »", () => {
    expect(etiquetteDeLecture({ comptee: false, confianceConnue: true, aVerifier: true })).toBe(
      "aVerifier",
    );
    expect(etiquetteDeLecture({ comptee: false, confianceConnue: true, aVerifier: false })).toBe(
      "source",
    );
  });

  it("tant que le jugement n'est pas arrivé, rien de faux : ni coche, ni « à vérifier »", () => {
    expect(etiquetteDeLecture({ comptee: false, confianceConnue: false, aVerifier: true })).toBe(
      "inconnue",
    );
  });
});
