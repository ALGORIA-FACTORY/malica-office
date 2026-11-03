/**
 * Le signaleur et la carte des traces, sans réseau ni API.
 *
 * Ce qu'il établit : « affiché » part une fois par rendu (les mêmes valeurs
 * rendues deux fois ne repartent pas), sous la trace née à la capture ; un
 * lot qui n'a pas pu partir hors ligne repart ensuite, sans perte ni doublon ;
 * un appel qui nomme une pièce connue porte sa trace, et seule la file y
 * ajoute une clé.
 */
import type { EtapeDeLAppareil } from "@malica/socle/ports/repositories";
import { beforeEach, describe, expect, it } from "vitest";

import { ErreurReseau } from "@/lib/transport/erreurs";

import { creerSignaleur } from "../signaleur";
import {
  entetesDuSuivi,
  oublierLesTraces,
  retenirLaTrace,
  suiviDesArguments,
  traceDe,
} from "../traces";

const CAPTURE = "6f1d0a3e-8b2c-4d5e-9f10-1a2b3c4d5e6f";
const PIECE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function signaleurDEssai(panne: () => boolean = () => false) {
  const lots: EtapeDeLAppareil[][] = [];
  const s = creerSignaleur({
    envoyer: async (lot) => {
      if (panne()) throw new ErreurReseau("hors_ligne");
      lots.push([...lot]);
    },
    plateforme: () => "android",
    nouvelleTrace: () => "99999999-9999-4999-8999-999999999999",
    delaiMs: 60_000,
  });
  return { s, lots, envoyees: () => lots.flat() };
}

beforeEach(() => {
  oublierLesTraces();
});

describe("affiché, une fois par rendu", () => {
  it("part sous la trace de la capture, avec la plateforme et les valeurs rendues", async () => {
    retenirLaTrace(["cle-de-file", PIECE], CAPTURE);
    const { s, envoyees } = signaleurDEssai();
    const rendu = { ttc: "510.000", base_ht: "427.731", tva: "81.269" };
    s.signalerLAffichage({ piece: PIECE, ecran: "pme", source: "lecture", valeurs: rendu });
    // Le même rendu, encore : un nouvel objet, les mêmes valeurs.
    s.signalerLAffichage({ piece: PIECE, ecran: "pme", source: "lecture", valeurs: { ...rendu } });
    await s.vider();

    expect(envoyees()).toHaveLength(1);
    expect(envoyees()[0]).toMatchObject({
      trace: CAPTURE,
      etape: "affiche",
      piece: PIECE,
      cle: "affiche:pme:510.000|427.731|81.269",
      detail: { plateforme: "android", ecran: "pme", source: "lecture", ttc: "510.000" },
    });
  });

  it("de nouvelles valeurs à l'écran font un nouveau rendu", async () => {
    const { s, envoyees } = signaleurDEssai();
    s.signalerLAffichage({
      piece: PIECE,
      ecran: "pme",
      source: "lecture",
      valeurs: { ttc: "810.000" },
    });
    s.signalerLAffichage({
      piece: PIECE,
      ecran: "pme",
      source: "cabinet",
      valeurs: { ttc: "510.000" },
    });
    await s.vider();
    expect(envoyees().map((e) => e.detail?.["ttc"])).toEqual(["810.000", "510.000"]);
    // Sans capture connue, une trace de consultation, retenue pour la pièce.
    expect(new Set(envoyees().map((e) => e.trace)).size).toBe(1);
    expect(traceDe(PIECE)).toBe(envoyees()[0]!.trace);
  });
});

describe("hors ligne, le lot attend", () => {
  it("repart au retour du réseau, sans perte et sans doublon", async () => {
    let horsLigne = true;
    const { s, envoyees } = signaleurDEssai(() => horsLigne);
    const etape = (cle: string): EtapeDeLAppareil => ({
      trace: CAPTURE,
      etape: "capture",
      issue: "ok",
      cle,
      debut: "2026-11-03T08:00:00.000Z",
    });
    s.signaler(etape("capture"));
    await s.vider();
    expect(envoyees()).toEqual([]);

    horsLigne = false;
    // La file redit la capture à la synchronisation : elle ne repart pas deux fois.
    s.signaler(etape("capture"));
    await s.vider();
    expect(envoyees().map((e) => e.cle)).toEqual(["capture"]);
  });

  it("un envoi lent ne fait rien perdre en silence : ce qui déborde est compté et dit", async () => {
    // Le premier envoi reste en vol pendant que trois cents étapes arrivent.
    let liberer: () => void = () => undefined;
    let premier = true;
    const recues: EtapeDeLAppareil[] = [];
    const s = creerSignaleur({
      envoyer: async (lot) => {
        if (premier) {
          premier = false;
          await new Promise<void>((r) => {
            liberer = r;
          });
        }
        recues.push(...lot);
      },
      plateforme: () => "android",
      nouvelleTrace: () => "99999999-9999-4999-8999-999999999999",
      delaiMs: 60_000,
    });
    for (let i = 0; i < 300; i += 1) {
      s.signaler({
        trace: CAPTURE,
        etape: "capture",
        issue: "ok",
        cle: `c${i}`,
        debut: "2026-11-03T08:00:00.000Z",
      });
    }
    liberer();
    await s.vider();

    const etapes = recues.filter((e) => e.etape === "capture");
    const pertes = recues.filter((e) => e.etape === "perte");
    // Aucune étape envoyée deux fois, et chaque étape absente est comptée.
    expect(new Set(etapes.map((e) => e.cle)).size).toBe(etapes.length);
    const comptees = pertes.reduce((n, p) => n + Number(p.detail?.["nombre"] ?? 0), 0);
    expect(etapes.length + comptees).toBe(300);
    // Le lot en vol est arrivé entier : les cinquante premières n'ont pas cédé.
    expect(etapes.slice(0, 50).map((e) => e.cle)).toEqual(
      Array.from({ length: 50 }, (_, i) => `c${i}`),
    );
  });
});

describe("les en-têtes d'un appel suivi", () => {
  it("un appel qui nomme une pièce connue porte sa trace, sans clé", () => {
    retenirLaTrace([PIECE], CAPTURE);
    expect(suiviDesArguments([PIECE, "entite"])).toEqual({ trace: CAPTURE });
    expect(suiviDesArguments([{ pieceId: PIECE, motifId: "x" }])).toEqual({ trace: CAPTURE });
    expect(suiviDesArguments(["inconnue"])).toBeNull();
    expect(entetesDuSuivi({ trace: CAPTURE, cle: "k1.octets" })).toEqual({
      "x-malica-trace": CAPTURE,
      "x-malica-cle": "k1.octets",
    });
    expect(entetesDuSuivi({ trace: "pas-une-trace" })).toEqual({});
  });
});
