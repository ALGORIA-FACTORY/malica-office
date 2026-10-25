import { describe, expect, it } from "vitest";
import type { PieceLue } from "@malica/socle/ports/repositories";

import {
  lectureEnSuspens,
  piecesALire,
  piecesEnEchec,
  presentation,
  raisonCourte,
} from "@/lib/lecture";
import { issueDeLecture } from "@malica/socle/issue-de-lecture";

const piece = (id: string, autre: Partial<PieceLue> = {}): PieceLue => ({
  id,
  status: "capturee",
  createdAt: "2026-10-24T10:00:00Z",
  vis: "personnel",
  gardeeLe: null,
  emetteur: null,
  dateDocument: null,
  kind: null,
  typeDeDocument: null,
  total: null,
  devise: null,
  lectureRefusee: null,
  lecture: null,
  ...autre,
});

const echec = (code: "lecture.illisible" | null, etat: "epuise" | "en_erreur" = "en_erreur") => ({
  lecture: { demandeLe: "2026-10-24T09:00:00Z", etat, code, reessaieLe: null },
});

describe("les pièces à lire", () => {
  it("retient les prises non lues, ni gardées, ni refusées, la plus récente d'abord", () => {
    const r = piecesALire([
      piece("ancienne", { createdAt: "2026-10-20T10:00:00Z" }),
      piece("lue", { status: "lue" }),
      piece("gardee", { gardeeLe: "2026-10-23" }),
      piece("refusee", { lectureRefusee: { motif: "plafond_atteint", le: "2026-10-23" } }),
      piece("recente", { createdAt: "2026-10-24T12:00:00Z" }),
    ]);
    expect(r.map((p) => p.id)).toEqual(["recente", "ancienne"]);
  });

  it("un reçu ou un justificatif n'est jamais « à lire » : la lecture le refuse", () => {
    const r = piecesALire([piece("facture"), piece("recu", { accompagne: true })]);
    expect(r.map((p) => p.id)).toEqual(["facture"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [piece("a", { createdAt: "2026-10-20T10:00:00Z" }), piece("b")];
    piecesALire(liste);
    expect(liste.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("une lecture qui tourne ou qui a échoué n'est plus « à lire »", () => {
    const r = piecesALire([
      piece("libre"),
      piece("en-cours", {
        lecture: {
          demandeLe: "2026-10-24T09:00:00Z",
          etat: "en_cours",
          code: null,
          reessaieLe: null,
        },
      }),
      piece("ratee", echec("lecture.illisible")),
    ]);
    expect(r.map((p) => p.id)).toEqual(["libre"]);
  });
});

describe("les lectures qui ont échoué se voient", () => {
  it("une photo illisible est à reprendre ; une erreur sans code est à relire", () => {
    expect(issueDeLecture(piece("a", echec("lecture.illisible"))).kind).toBe("a_reprendre");
    expect(issueDeLecture(piece("b", echec(null, "epuise"))).kind).toBe("echec");
  });

  it("une panne attend sa reprise sans demander de geste", () => {
    const p = piece("p", {
      lecture: {
        demandeLe: "2026-10-24T09:00:00Z",
        etat: "en_panne",
        code: null,
        reessaieLe: "2099-01-01T00:00:00Z",
      },
    });
    expect(issueDeLecture(p)).toEqual({ kind: "attente", reessaieLe: "2099-01-01T00:00:00Z" });
    expect(lectureEnSuspens(p)).toBe(true);
    expect(piecesEnEchec([p])).toEqual([]);
  });

  it("piecesEnEchec retient les échecs, pas les pièces gardées pour soi", () => {
    const r = piecesEnEchec([
      piece("ratee", echec("lecture.illisible")),
      piece("gardee", { ...echec(null), gardeeLe: "2026-10-23" }),
      piece("lue", { status: "lue", ...echec(null) }),
    ]);
    expect(r.map((p) => p.id)).toEqual(["ratee"]);
  });

  it("chaque issue non lue a sa raison courte", () => {
    expect(raisonCourte(issueDeLecture(piece("a", echec("lecture.illisible"))))).toBe(
      "pme.lecture.court.illisible",
    );
    expect(raisonCourte(issueDeLecture(piece("b", echec(null))))).toBe("pme.lecture.court.echec");
    expect(raisonCourte({ kind: "lue" })).toBeNull();
  });
});

describe("chaque issue a sa présentation", () => {
  it("un refus n'est jamais « en cours », une pièce jamais demandée se lit", () => {
    expect(presentation({ kind: "refusee", motif: "plafond_atteint" })).toMatchObject({
      ton: "ko",
      mot: "pme.refus.titre",
    });
    expect(presentation({ kind: "a_lire" }).geste).toBe("lire");
    expect(presentation({ kind: "echec", code: null }).geste).toBe("relire");
    expect(presentation({ kind: "attente", reessaieLe: null }).geste).toBeNull();
  });
});
