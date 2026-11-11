/**
 * Les épreuves de l'issue d'une lecture — une seule règle pour tous les écrans.
 *
 * Garantissent que chaque écran (PME, cabinet) dit la même chose d'une pièce : lue,
 * à lire, en cours, en attente de reprise, à reprendre (photo illisible), à relire, ou
 * refusée avec son motif. Un refus l'emporte, sauf s'il est plus ancien qu'une nouvelle
 * lecture ; une attente dont l'heure de reprise est passée devient un échec qu'on peut
 * relire ; et un message technique (réseau, erreur interne) n'est jamais montré :
 * seuls les codes de lecture connus passent (R2).
 */
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
        issueDeLecture({
          ...capturee,
          lecture: { demandeLe: "2026-10-24T09:00:00Z", etat, code: null, reessaieLe: null },
        }).kind,
      ).toBe("en_cours");
    }
  });

  it("une panne attend sa reprise, sans geste demandé", () => {
    const i = issueDeLecture({
      ...capturee,
      lecture: {
        demandeLe: "2026-10-24T09:00:00Z",
        etat: "en_panne",
        code: null,
        reessaieLe: "2099-01-01T00:00:00Z",
      },
    });
    expect(i).toEqual({ kind: "attente", reessaieLe: "2099-01-01T00:00:00Z" });
    expect(demandeUnGeste(i)).toBe(false);
  });

  it("une photo illisible est à reprendre ; une erreur sans code est à relire", () => {
    const photo = issueDeLecture({
      ...capturee,
      lecture: {
        demandeLe: "2026-10-24T09:00:00Z",
        etat: "en_erreur",
        code: "lecture.illisible",
        reessaieLe: null,
      },
    });
    const autre = issueDeLecture({
      ...capturee,
      lecture: {
        demandeLe: "2026-10-24T09:00:00Z",
        etat: "epuise",
        code: "lecture.trop_longue",
        reessaieLe: null,
      },
    });
    expect(photo).toEqual({ kind: "a_reprendre", code: "lecture.illisible" });
    expect(autre).toEqual({ kind: "echec", code: "lecture.trop_longue" });
    expect(demandeUnGeste(photo) && demandeUnGeste(autre)).toBe(true);
  });

  it("une attente dont l'heure de reprise est passée devient un échec qu'on peut relire", () => {
    const l = {
      demandeLe: "2026-10-24T09:00:00Z",
      etat: "en_panne" as const,
      code: null,
      reessaieLe: "2026-10-24T10:00:00Z",
    };
    expect(
      issueDeLecture({ ...capturee, lecture: l }, Date.parse("2026-10-24T09:30:00Z")).kind,
    ).toBe("attente");
    expect(
      issueDeLecture({ ...capturee, lecture: l }, Date.parse("2026-10-24T10:30:00Z")).kind,
    ).toBe("echec");
    expect(
      issueDeLecture({ ...capturee, lecture: { ...l, etat: "abandonne", reessaieLe: null } }).kind,
    ).toBe("echec");
  });

  it("un refus plus ancien qu'une nouvelle lecture ne la cache pas", () => {
    const refus = { motif: "plafond_atteint", le: "2026-10-24T08:00:00Z" };
    const relue = {
      demandeLe: "2026-10-24T09:00:00Z",
      etat: "en_cours" as const,
      code: null,
      reessaieLe: null,
    };
    expect(issueDeLecture({ ...capturee, lectureRefusee: refus, lecture: relue }).kind).toBe(
      "en_cours",
    );
    expect(
      issueDeLecture({
        ...capturee,
        lectureRefusee: { ...refus, le: "2026-10-24T09:30:00Z" },
        lecture: relue,
      }).kind,
    ).toBe("refusee");
  });
});
