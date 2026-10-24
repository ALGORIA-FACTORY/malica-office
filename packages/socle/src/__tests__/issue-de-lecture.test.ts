import { describe, expect, it } from "vitest";

import { codeDeLecture, demandeUnGeste, issueDeLecture } from "../issue-de-lecture.ts";

const capturee = { status: "capturee", lectureRefusee: null };

describe("le code d'un échec de lecture", () => {
  it("reconnaît les codes de la chaîne, même entourés d'un libellé", () => {
    expect(codeDeLecture("lecture.illisible")).toBe("lecture.illisible");
    expect(codeDeLecture("relevé page 1 : lecture.trop_dense")).toBe("lecture.trop_dense");
  });

  it("ne laisse jamais passer un message technique", () => {
    expect(codeDeLecture("second lecteur injoignable : ECONNREFUSED")).toBeNull();
    expect(codeDeLecture("lecture.inconnue")).toBeNull();
    expect(codeDeLecture(null)).toBeNull();
  });
});

describe("l'issue d'une lecture, une règle pour tous les écrans", () => {
  it("lue dès que la pièce a quitté « capturée »", () => {
    expect(issueDeLecture({ status: "lue" }).kind).toBe("lue");
  });

  it("un refus l'emporte, avec son motif", () => {
    expect(
      issueDeLecture({
        ...capturee,
        lectureRefusee: { motif: "plafond_atteint", le: "2026-10-24" },
      }),
    ).toEqual({ kind: "refusee", motif: "plafond_atteint" });
  });

  it("jamais demandée : à lire", () => {
    expect(issueDeLecture({ ...capturee, lecture: null }).kind).toBe("a_lire");
  });

  it("en cours, ou terminée sans que la liste l'ait encore dit : en cours", () => {
    for (const etat of ["a_faire", "en_cours", "termine"] as const) {
      expect(
        issueDeLecture({ ...capturee, lecture: { etat, code: null, reessaieLe: null } }).kind,
      ).toBe("en_cours");
    }
  });

  it("une panne attend sa reprise, sans geste demandé", () => {
    const i = issueDeLecture({
      ...capturee,
      lecture: { etat: "en_panne", code: null, reessaieLe: "2026-10-24T12:00:00Z" },
    });
    expect(i).toEqual({ kind: "attente", reessaieLe: "2026-10-24T12:00:00Z" });
    expect(demandeUnGeste(i)).toBe(false);
  });

  it("une photo illisible est à reprendre ; une erreur sans code est à relire", () => {
    const photo = issueDeLecture({
      ...capturee,
      lecture: { etat: "en_erreur", code: "lecture.illisible", reessaieLe: null },
    });
    const autre = issueDeLecture({
      ...capturee,
      lecture: { etat: "epuise", code: "lecture.trop_longue", reessaieLe: null },
    });
    expect(photo).toEqual({ kind: "a_reprendre", code: "lecture.illisible" });
    expect(autre).toEqual({ kind: "echec", code: "lecture.trop_longue" });
    expect(demandeUnGeste(photo) && demandeUnGeste(autre)).toBe(true);
  });
});
