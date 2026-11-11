/**
 * La fiche d'une pièce côté PME — où elle en est, et ce qu'on peut en faire.
 *
 * Garantit les trois étapes montrées (envoyée, vue, prise en charge), dont une vue
 * antérieure à un renvoi ne compte plus ; la note de suppression, qui ne parle que si
 * la pièce est chez le cabinet ; l'étiquette d'une ligne lue, où le jugement décide et
 * la PME ne confirme rien ; et la date donnée à la main, qui n'écrit ni deux fois la
 * même ni une saisie incomplète.
 */
import { describe, expect, it } from "vitest";
import type { SuiviDEnvoi } from "@malica/socle/statut-d-envoi";

import {
  dateAEnregistrer,
  etiquetteDeLecture,
  noteDeSuppression,
  ouEnEstLaPiece,
  partageeAvecLeCabinet,
} from "@/lib/fiche-de-la-piece";

const suivi = (s: Partial<SuiviDEnvoi>): SuiviDEnvoi => ({
  envoyeeLe: "2026-10-27T10:42:00.000Z",
  vueLe: null,
  vuePar: null,
  corrigeeLe: null,
  priseLe: null,
  prise: null,
  prisePar: null,
  ...s,
});

/** Maquette « Fiche PME sans écriture » (28 octobre 2026) : trois étapes, aucune écriture. */
describe("où elle en est", () => {
  it("envoyée, vue, prise en charge — chacune son heure, ou à venir", () => {
    expect(ouEnEstLaPiece(suivi({}))).toEqual([
      { cle: "envoyee", le: "2026-10-27T10:42:00.000Z" },
      { cle: "vue", le: null },
      { cle: "prise_en_charge", le: null },
    ]);
    const prise = ouEnEstLaPiece(
      suivi({
        vueLe: "2026-10-28T09:15:00.000Z",
        prise: "forcee",
        priseLe: "2026-10-28T09:20:00.000Z",
      }),
    );
    expect(prise.map((e) => e.le !== null)).toEqual([true, true, true]);
  });

  it("une vue d'avant le renvoi ne compte plus", () => {
    const e = ouEnEstLaPiece(
      suivi({ envoyeeLe: "2026-10-29T08:00:00.000Z", vueLe: "2026-10-28T09:15:00.000Z" }),
    );
    expect(e[1]).toEqual({ cle: "vue", le: null });
  });

  it("jamais partie : tout est à venir", () => {
    expect(ouEnEstLaPiece(null).every((e) => e.le === null)).toBe(true);
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
  it("le jugement décide : « à vérifier » ou « source » — la PME ne confirme rien", () => {
    expect(etiquetteDeLecture({ confianceConnue: true, aVerifier: true })).toBe("aVerifier");
    expect(etiquetteDeLecture({ confianceConnue: true, aVerifier: false })).toBe("source");
  });

  it("tant que le jugement n'est pas arrivé, rien de faux : ni coche, ni « à vérifier »", () => {
    expect(etiquetteDeLecture({ confianceConnue: false, aVerifier: true })).toBe("inconnue");
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
