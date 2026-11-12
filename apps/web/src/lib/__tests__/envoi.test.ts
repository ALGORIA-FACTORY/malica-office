/**
 * L'envoi au cabinet — la pièce suivante à transmettre, et le réessai d'une pièce.
 *
 * Garantit que, après un envoi, l'écran propose la pièce suivante dans l'ordre (en
 * reprenant au début), jamais celle qui vient de partir, jamais une pièce que le
 * propriétaire a retournée au siège, et rien quand il ne reste rien à envoyer. Il
 * garantit aussi que réessayer une pièce restée garde les autres restées, sans les
 * retenter, et remplace la raison du refus d'une pièce retentée.
 */
import { describe, expect, it } from "vitest";

import { resteAEnvoyer } from "@malica/socle/circuit";
import type { Droit, Visibility } from "@malica/socle/ports/repositories";
import type { CircuitInterne } from "@malica/socle/statut-d-envoi";

import { compteCommeTransmise, fusionnerLEnvoi, pieceSuivanteATransmettre } from "../envoi";

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

describe("ce qui compte comme transmis à la comptabilité", () => {
  it("compte la facture transmise, pas le document joint non lu qui la suit", () => {
    const facture = { vis: "partage" as const, status: "lue", jointe: false };
    const bonDeLivraison = { vis: "partage" as const, status: "capturee", jointe: true };
    expect([facture, bonDeLivraison].filter(compteCommeTransmise)).toEqual([facture]);
  });

  it("compte un avoir lu, même joint à sa facture, et jamais une pièce retournée", () => {
    expect(compteCommeTransmise({ vis: "partage", status: "lue", jointe: true })).toBe(true);
    expect(compteCommeTransmise({ vis: "partage", status: "retournee" })).toBe(false);
    expect(compteCommeTransmise({ vis: "entite", status: "lue" })).toBe(false);
  });
});
