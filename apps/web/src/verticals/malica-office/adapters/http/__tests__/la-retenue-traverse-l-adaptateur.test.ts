/**
 * La retenue à la source traverse l'adaptateur (pilote, 23 novembre 2026).
 *
 * L'API rendait `retenue: { montant, totalTtc }` pour la pièce MAP, mais `dossier()`
 * recopiait la réponse champ par champ et l'oubliait : la fiche n'affichait ni la ligne
 * « Retenue à la source », ni le TTC avant elle, et disait le net à payer « TTC ».
 * Les tests de l'écran passaient par un faux dépôt : ils ne le voyaient pas.
 */
import { describe, expect, it, vi } from "vitest";

const reponse = vi.hoisted(() => ({ retenue: undefined as unknown }));
vi.mock("../rpc", () => ({
  appeler: async () => ({
    piece: { id: "p", status: "lue", created_at: "2026-07-02T00:00:00Z" },
    extraction: null,
    ...(reponse.retenue === undefined ? {} : { retenue: reponse.retenue }),
  }),
}));

// Les octets de la pièce passent par leur route : ici, aucun.
vi.mock("@/lib/transport", () => ({
  transport: () => ({ appeler: async () => new Response(null, { status: 404 }) }),
}));

import { creerCaptureHttp } from "../capture";

describe("la retenue à la source, vue par l'adaptateur", () => {
  const capture = creerCaptureHttp();

  it("passe la retenue tranchée et le TTC avant elle", async () => {
    reponse.retenue = { montant: "14.280", totalTtc: "477.000" };
    expect((await capture.dossier("p")).retenue).toEqual({
      montant: "14.280",
      totalTtc: "477.000",
    });
  });

  it("sans retenue : null, jamais undefined", async () => {
    reponse.retenue = undefined;
    expect((await capture.dossier("p")).retenue).toBeNull();
  });
});
