import { describe, expect, it } from "vitest";
import type { Ecriture } from "@malica/socle/ports/repositories";

import {
  avancementDeLaPiece,
  dateAEnregistrer,
  ecritureDeLaPiece,
  etiquetteDeLecture,
  noteDeSuppression,
  parcoursDeLaPiece,
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

describe("la date donnée à la main (audit du 25 octobre 2026)", () => {
  it("garder le jour proposé s'enregistre, même sans l'avoir changé", () => {
    expect(dateAEnregistrer("2026-10-20", null, null)).toBe("2026-10-20");
  });

  it("n'écrit pas deux fois la même date, ni ce qui est en train de s'écrire", () => {
    expect(dateAEnregistrer("2026-10-20", "2026-10-20", null)).toBeNull();
    expect(dateAEnregistrer("2026-10-20", null, "2026-10-20")).toBeNull();
    expect(dateAEnregistrer("2026-10-21", "2026-10-20", null)).toBe("2026-10-21");
  });

  it("une saisie incomplète n'écrit rien", () => {
    expect(dateAEnregistrer("", null, null)).toBeNull();
    expect(dateAEnregistrer("2026-10", null, null)).toBeNull();
  });
});

describe("la pastille et le parcours disent la même chose (audit du 25 octobre 2026)", () => {
  const vivante = ecriture("v", { vivante: true });
  const etatDe = (p: ReturnType<typeof parcoursDeLaPiece>, cle: string) =>
    p.etapes.find((e) => e.cle === cle)?.etat;

  it("une pièce comptée : « Comptabilisée », et « Comptée » est FAITE, pas en cours", () => {
    for (const p of [parcoursDeLaPiece("comptabilisee", null), parcoursDeLaPiece("lue", vivante)]) {
      expect(p.pastille.cle).toBe("pme.dossier.etat.comptabilisee");
      expect(p.derniere).toBe("comptee");
      expect(etatDe(p, "comptee")).toBe("faite");
      expect(etatDe(p, "vue")).toBe("courante");
      expect(p.prochaine).toBe("vue");
    }
  });

  it("une pièce supervisée : la pastille suit l'étape 5", () => {
    const p = parcoursDeLaPiece("supervisee", vivante);
    expect(p.pastille).toEqual({ cle: "pme.status.supervisee", ton: "ok" });
    expect(p.derniere).toBe("vue");
    expect(etatDe(p, "vue")).toBe("faite");
    expect(etatDe(p, "declaree")).toBe("attente");
  });

  it("une pièce lue attend sa confirmation : ambre des deux côtés", () => {
    const p = parcoursDeLaPiece("lue", null);
    expect(p.pastille.ton).toBe("am");
    expect(p.derniere).toBe("lue");
    expect(etatDe(p, "confirmee")).toBe("courante");
  });

  it("une seule étape au plus est en cours, et jamais avant une étape faite", () => {
    const statuts = [
      "capturee",
      "lue",
      "proposee",
      "comptabilisee",
      "supervisee",
      "retournee",
    ] as const;
    for (const status of statuts)
      for (const e of [null, vivante]) {
        const p = parcoursDeLaPiece(status, e);
        const etats = p.etapes.map((x) => x.etat);
        expect(etats.filter((x) => x === "courante").length).toBeLessThanOrEqual(1);
        expect(etats.join(",")).toMatch(/^(faite,)*(courante,)?(attente,?)*$/);
        expect(etatDe(p, p.derniere)).toBe("faite");
      }
  });
});
