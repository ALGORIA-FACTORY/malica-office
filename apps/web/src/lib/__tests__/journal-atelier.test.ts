// @vitest-environment jsdom
/**
 * Ce que l'écran ne montre plus va au journal EN BASE — avec ou sans dossier
 * ouvert (règle du dirigeant, 6 novembre 2026).
 *
 * Le journal des pannes exige un dossier ; accepter une invitation ou ouvrir
 * le dossier d'un client depuis le cabinet n'en ont pas, et leur panne
 * n'allait nulle part. Elle passe désormais par la porte hors dossier — avec
 * un détail expurgé, puisqu'aucun dossier ne la protège.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appels = vi.hoisted(() => ({
  dossier: [] as unknown[],
  horsDossier: [] as unknown[],
}));
vi.mock("@/verticals/malica-office/composition", () => ({
  office: () => ({
    journal: {
      consigner: (e: unknown) => {
        appels.dossier.push(e);
        return Promise.resolve("id");
      },
      consignerHorsDossier: (e: unknown) => {
        appels.horsDossier.push(e);
        return Promise.resolve({ inscrite: true });
      },
    },
  }),
}));

import { dossierDuJournal, noterAuJournal } from "../journal-atelier";
import { ErreurApi } from "../transport/erreurs";

/** Les envois partent par des imports dynamiques : on les laisse aboutir. */
const attendre = () =>
  vi.waitFor(() => {
    if (appels.dossier.length + appels.horsDossier.length === 0) throw new Error("rien encore");
  }, 5000);

describe("le journal en base", () => {
  beforeEach(() => {
    appels.dossier.length = 0;
    appels.horsDossier.length = 0;
  });
  afterEach(() => dossierDuJournal(null));

  it("dans un dossier : la ligne mène par la référence montrée à l'écran", async () => {
    dossierDuJournal("00000000-0000-4000-8000-000000000001");
    noterAuJournal("pièce : lecture", new Error("Cannot transfer object"), "7F3A21C9");
    await attendre();
    expect(appels.horsDossier).toEqual([]);
    expect(appels.dossier).toHaveLength(1);
    expect(appels.dossier[0]).toMatchObject({
      tenantId: "00000000-0000-4000-8000-000000000001",
      ou: "pièce : lecture",
      message: "[ref 7F3A21C9] Cannot transfer object",
    });
  });

  it("hors dossier : qui, où, le code et un détail expurgé, par la porte bornée", async () => {
    noterAuJournal(
      "invitation : accepter",
      new ErreurApi("refusé pour contact@client.tn, matricule 1876543W/A/M/000", 400),
      "0A1B2C3D",
    );
    await attendre();
    expect(appels.dossier).toEqual([]);
    expect(appels.horsDossier).toHaveLength(1);
    const e = appels.horsDossier[0] as { ou: string; code: string; detail: string };
    expect(e.ou).toBe("invitation : accepter");
    expect(e.code).toBe("[ref 0A1B2C3D] ErreurApi 400");
    expect(e.detail).toContain("[ref 0A1B2C3D]");
    expect(e.detail).not.toContain("contact@client.tn");
    expect(e.detail).not.toContain("1876543W");
  });
});
