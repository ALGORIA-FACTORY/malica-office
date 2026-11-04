import { describe, expect, it } from "vitest";

import type { SuiviDEnvoi } from "@malica/socle/statut-d-envoi";

import { dansLeFiltre, feuDuStatut, joursDAttente, prisesEnChargeDepuis } from "../file-cabinet";

describe("joursDAttente", () => {
  const maintenant = Date.parse("2026-09-04T10:00:00Z");

  it("compte des jours entiers depuis le dépôt", () => {
    expect(joursDAttente("2026-09-04T08:00:00Z", maintenant)).toBe(0);
    expect(joursDAttente("2026-09-03T09:59:00Z", maintenant)).toBe(1);
    expect(joursDAttente("2026-08-25T10:00:00Z", maintenant)).toBe(10);
  });

  it("n'est jamais négative, ni absurde sur une date illisible", () => {
    expect(joursDAttente("2026-09-05T10:00:00Z", maintenant)).toBe(0);
    expect(joursDAttente("pas une date", maintenant)).toBe(0);
  });
});

describe("feuDuStatut", () => {
  it("ambre à vous, bleu chez le client, vert pris en charge", () => {
    expect(feuDuStatut("recue")).toBe("warn");
    expect(feuDuStatut("corrigee")).toBe("warn");
    expect(feuDuStatut("retournee")).toBe("info");
    expect(feuDuStatut("validee")).toBe("ok");
    expect(feuDuStatut("forcee")).toBe("ok");
  });
});

describe("prisesEnChargeDepuis", () => {
  const depuis = Date.parse("2026-09-03T10:00:00Z");
  const suivi = (s: Partial<SuiviDEnvoi>): SuiviDEnvoi => ({
    envoyeeLe: "2026-09-01T08:00:00Z",
    vueLe: null,
    vuePar: null,
    corrigeeLe: null,
    priseLe: null,
    prise: null,
    prisePar: null,
    ...s,
  });

  it("compte les validées et les forcées à la date de la prise en charge", () => {
    const pieces = [
      // Reçue il y a trois jours, validée ce matin : elle compte.
      { suivi: suivi({ prise: "validee", priseLe: "2026-09-04T08:00:00Z" }) },
      { suivi: suivi({ prise: "forcee", priseLe: "2026-09-03T11:00:00Z" }) },
      // Prise en charge avant la fenêtre : elle ne compte pas.
      { suivi: suivi({ prise: "validee", priseLe: "2026-09-02T08:00:00Z" }) },
    ];
    expect(prisesEnChargeDepuis(pieces, depuis)).toBe(2);
  });

  it("ne compte ni une pièce vue, ni une pièce sans suivi", () => {
    const pieces = [{ suivi: suivi({ vueLe: "2026-09-04T08:00:00Z" }) }, { suivi: null }];
    expect(prisesEnChargeDepuis(pieces, depuis)).toBe(0);
  });
});

describe("dansLeFiltre", () => {
  const piece = (statut: "recue" | "retournee" | "validee", doublonDe: string | null = null) => ({
    statut,
    doublonDe,
  });

  it("range une pièce par son statut, et « tout » les prend toutes", () => {
    expect(dansLeFiltre(piece("recue"), "a_traiter")).toBe(true);
    expect(dansLeFiltre(piece("recue"), "prise")).toBe(false);
    expect(dansLeFiltre(piece("retournee"), "retournee")).toBe(true);
    expect(dansLeFiltre(piece("validee"), "prise")).toBe(true);
    expect(dansLeFiltre(piece("validee"), "tout")).toBe(true);
  });

  it("« doublons » ne garde que les pièces qui en répètent une autre, quel que soit leur statut", () => {
    expect(dansLeFiltre(piece("recue", "p0"), "doublons")).toBe(true);
    expect(dansLeFiltre(piece("validee", "p0"), "doublons")).toBe(true);
    expect(dansLeFiltre(piece("recue"), "doublons")).toBe(false);
  });
});
