import { describe, expect, it } from "vitest";

import { resteAEnvoyer } from "@malica/socle/circuit";
import type { Droit, Visibility } from "@malica/socle/ports/repositories";
import type { CircuitInterne } from "@malica/socle/statut-d-envoi";

import { fusionnerLEnvoi, pieceSuivanteATransmettre } from "../envoi";

const p = (
  id: string,
  vis: Visibility = "entite",
  status = "lue",
  gardeeLe: string | null = null,
) => ({
  id,
  vis,
  status,
  gardeeLe,
});

/** Le passage siège → propriétaire, vu du siège (lot 4). */
const duSiege = (dernier: CircuitInterne["dernier"]): CircuitInterne => ({
  recoit: false,
  dernier,
  envoyeeLe: dernier ? "2026-10-30T09:00:00.000Z" : null,
  vueLe: null,
  vuePar: null,
  retourneeLe: null,
  retourPar: null,
  corrigeeLe: null,
  auteur: "Sami",
  mienne: true,
});

/** Le seul prédicat, avec les droits d'un propriétaire qui a un cabinet. */
const PROPRIETAIRE: Droit[] = [
  "societe.tout_voir",
  "envoi.cabinet",
  "piece.garder",
  "circuit.recevoir",
];
const reste = (x: Parameters<typeof resteAEnvoyer>[0]) =>
  resteAEnvoyer(x, PROPRIETAIRE, true) !== null;

describe("la pièce suivante", () => {
  it("prend la suivante dans l'ordre, puis reprend au début", () => {
    const liste = [p("a"), p("b", "partage"), p("c"), p("d")];
    expect(pieceSuivanteATransmettre(liste, "c", reste)?.id).toBe("d");
    expect(pieceSuivanteATransmettre(liste, "d", reste)?.id).toBe("a");
  });

  it("ne rend jamais la pièce qu'on vient d'envoyer, et rien quand il n'y a plus rien", () => {
    expect(pieceSuivanteATransmettre([p("a")], "a", reste)).toBeNull();
    expect(
      pieceSuivanteATransmettre([p("a", "partage"), p("b", "personnel")], "a", reste),
    ).toBeNull();
  });

  it("jamais une pièce que le propriétaire a retournée au siège", () => {
    const rendue = {
      ...p("b"),
      circuit: { ...duSiege("retournee"), recoit: true, mienne: false },
    };
    expect(pieceSuivanteATransmettre([p("a"), rendue], "a", reste)).toBeNull();
  });
});

describe("réessayer une pièce restée", () => {
  it("garde les autres restées, jamais retentées", () => {
    const avant = {
      parties: ["a"],
      restees: [
        { id: "b", refus: null },
        { id: "c", refus: null },
      ],
    };
    const apres = fusionnerLEnvoi(avant, ["b"], { parties: ["b"], restees: [] });
    expect(apres).toEqual({ parties: ["a", "b"], restees: [{ id: "c", refus: null }] });
  });

  it("remplace la raison d'une pièce retentée et encore refusée", () => {
    const avant = { parties: [], restees: [{ id: "b", refus: null }] };
    const apres = fusionnerLEnvoi(avant, ["b"], {
      parties: [],
      restees: [{ id: "b", refus: "Licence impayée" }],
    });
    expect(apres.restees).toEqual([{ id: "b", refus: "Licence impayée" }]);
  });
});
