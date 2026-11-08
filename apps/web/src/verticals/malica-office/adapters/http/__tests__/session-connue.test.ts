// @vitest-environment jsdom
/**
 * La session, connue une fois — 8 novembre 2026.
 *
 * Chaque changement d'écran payait un `GET /auth/session` avant ses données.
 * Le compte connu est rendu aussitôt ; il ne se relit qu'au-delà de cinq
 * minutes, en arrière-plan, et une session perdue le dit par un événement.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const reseau = vi.hoisted(() => ({ appels: 0, statut: 200 }));
vi.mock("@/lib/transport", () => ({
  transport: () => ({
    porteUnJeton: () => true,
    jetonLong: async () => null,
    oublierLaSession: async () => {},
    retenirLaSession: async () => {},
    appeler: async (chemin: string) => {
      if (chemin === "/auth/session") reseau.appels += 1;
      return new Response(
        reseau.statut === 200
          ? JSON.stringify({ utilisateur: { id: "u1", email: "a@b.tn" } })
          : null,
        { status: reseau.statut },
      );
    },
  }),
}));

import { ecouterLaDeconnexion, signalerLaDeconnexion } from "@/lib/transport/etat";
import { SESSION_PERDUE, creerAuthHttp } from "../auth";

describe("la session, connue une fois", () => {
  afterEach(() => vi.useRealTimers());

  it("plusieurs écrans en même temps n'attendent qu'une réponse, puis plus aucune", async () => {
    const auth = creerAuthHttp();
    await auth.deconnexion();
    reseau.appels = 0;
    reseau.statut = 200;
    const [a, b, c] = await Promise.all([auth.session(), auth.session(), auth.session()]);
    expect([a?.id, b?.id, c?.id]).toEqual(["u1", "u1", "u1"]);
    expect(reseau.appels).toBe(1);
    await auth.session();
    await auth.session();
    expect(reseau.appels).toBe(1);
  });

  it("au-delà de cinq minutes, elle se relit sans retenir l'écran ; perdue, elle le dit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const auth = creerAuthHttp();
    await auth.deconnexion();
    reseau.appels = 0;
    reseau.statut = 200;
    await auth.session();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    reseau.statut = 401;
    const perdue = vi.fn();
    window.addEventListener(SESSION_PERDUE, perdue);
    // L'écran reçoit aussitôt le compte connu…
    expect((await auth.session())?.id).toBe("u1");
    // …et la relecture, en arrière-plan, constate la fin de la session.
    await vi.waitFor(() => expect(perdue).toHaveBeenCalledTimes(1));
    expect(await auth.session()).toBeNull();
    window.removeEventListener(SESSION_PERDUE, perdue);
  });

  it("se déconnecter oublie le compte", async () => {
    const auth = creerAuthHttp();
    reseau.statut = 200;
    await auth.session();
    await auth.deconnexion();
    reseau.appels = 0;
    reseau.statut = 401;
    expect(await auth.session()).toBeNull();
    expect(reseau.appels).toBe(1);
  });

  it("une fin de session signalée par le transport oublie aussi le compte", async () => {
    const auth = creerAuthHttp();
    await auth.deconnexion();
    reseau.statut = 200;
    await auth.session();
    // La racine écoute aussi (elle se monte après l'adaptateur) : les deux
    // entendent le signal, aucune n'efface l'autre.
    const racine = vi.fn();
    const retirer = ecouterLaDeconnexion(racine);
    // Jeton long refusé, relance encore en 401 : le transport le signale.
    signalerLaDeconnexion();
    expect(racine).toHaveBeenCalledTimes(1);
    retirer();
    reseau.appels = 0;
    reseau.statut = 401;
    expect(await auth.session()).toBeNull();
    expect(reseau.appels).toBe(1);
  });
});
