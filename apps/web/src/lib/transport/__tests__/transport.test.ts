/**
 * La politique du transport, éprouvée avec un réseau factice.
 *
 * Chaque règle du module a son cas : le jeton porteur qui n'apparaît qu'en
 * natif, le rafraîchissement en vol unique, le rejeu d'une seule fois, le 426
 * qui arrête tout, et le réseau absent qui n'est pas une panne.
 */
import { describe, expect, it } from "vitest";

import { ErreurApi, ErreurReseau, ErreurVersion } from "../erreurs";
import { coffreMemoire } from "../jetons";
import { creerTransport, type DependancesTransport } from "../transport";

interface Appel {
  url: string;
  init: RequestInit;
}

/** Un réseau qui répond selon un scénario, et se souvient de tout. */
function reseau(scenario: (appel: Appel, n: number) => Response | Error) {
  const appels: Appel[] = [];
  const fetchFactice = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const appel = { url: String(entree), init: init ?? {} };
    appels.push(appel);
    const reponse = scenario(appel, appels.length);
    if (reponse instanceof Error) throw reponse;
    return reponse;
  }) as typeof fetch;
  return { appels, fetch: fetchFactice };
}

const json = (statut: number, corps: unknown) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });

function entete(appel: Appel, nom: string): string | null {
  return new Headers(appel.init.headers).get(nom);
}

function transportDe(
  natif: boolean,
  fetchFactice: typeof fetch,
  extra: Partial<DependancesTransport> = {},
) {
  const evenements: string[] = [];
  const t = creerTransport({
    base: "https://api.test",
    natif,
    coffre: coffreMemoire(natif ? "jeton-long-initial" : null),
    versionClient: natif ? "coque-android/0.1.0" : "web/0.1.0",
    fetch: fetchFactice,
    enLigne: () => true,
    surDeconnexion: () => evenements.push("deconnexion"),
    surMiseAJourRequise: (v) => evenements.push(`maj:${v}`),
    ...extra,
  });
  return { t, evenements };
}

describe("ce que chaque requête porte", () => {
  it("se présente toujours, et n'emporte le cookie que dans un navigateur", async () => {
    const r = reseau(() => json(200, { ok: true }));
    const { t } = transportDe(false, r.fetch);
    await t.json("/rpc", { method: "POST" });
    expect(entete(r.appels[0]!, "X-Regalica-Client")).toBe("web/0.1.0");
    expect(entete(r.appels[0]!, "Authorization")).toBeNull();
    expect(r.appels[0]!.init.credentials).toBe("include");
  });

  it("en natif, porte le jeton d'accès et aucun cookie", async () => {
    const r = reseau(() => json(200, {}));
    const { t } = transportDe(true, r.fetch);
    await t.retenirLaSession("acces-1", "long-1");
    await t.json("/rpc", { method: "POST" });
    expect(entete(r.appels[0]!, "Authorization")).toBe("Bearer acces-1");
    expect(r.appels[0]!.init.credentials).toBe("omit");
    expect(await t.jetonLong()).toBe("long-1");
  });
});

describe("quand le réseau manque", () => {
  it("dit hors ligne ou injoignable selon ce que le navigateur sait", async () => {
    const r = reseau(() => new TypeError("Failed to fetch"));
    const horsLigne = transportDe(false, r.fetch, { enLigne: () => false });
    await expect(horsLigne.t.appeler("/rpc")).rejects.toMatchObject({
      name: "ErreurReseau",
      nature: "hors_ligne",
    });
    const injoignable = transportDe(false, r.fetch, { enLigne: () => true });
    await expect(injoignable.t.appeler("/rpc")).rejects.toBeInstanceOf(ErreurReseau);
  });
});

describe("quand la coque est dépassée", () => {
  it("un 426 signale la mise à jour et lève ErreurVersion, sans rejouer", async () => {
    const r = reseau(() => json(426, { erreur: "mise à jour requise", versionMinimale: "0.2.0" }));
    const { t, evenements } = transportDe(true, r.fetch);
    await expect(t.appeler("/rpc")).rejects.toBeInstanceOf(ErreurVersion);
    expect(evenements).toEqual(["maj:0.2.0"]);
    expect(r.appels).toHaveLength(1);
  });
});

describe("quand le jeton d'accès expire", () => {
  it("rafraîchit, puis rejoue la même requête une fois — et une seule", async () => {
    const r = reseau((appel, n) => {
      if (appel.url.endsWith("/auth/rafraichir")) {
        return json(200, {
          jeton: "acces-2",
          jetonRafraichissement: "long-2",
          utilisateur: { id: "u", email: "u@x" },
        });
      }
      return n === 1
        ? json(401, { erreur: "authentification requise" })
        : json(200, { resultat: 42 });
    });
    const { t, evenements } = transportDe(true, r.fetch);
    await t.retenirLaSession("acces-1", "long-1");
    const corps = await t.json<{ resultat: number }>("/rpc", { method: "POST", body: "{}" });
    expect(corps.resultat).toBe(42);
    expect(r.appels.map((a) => a.url.replace("https://api.test", ""))).toEqual([
      "/rpc",
      "/auth/rafraichir",
      "/rpc",
    ]);
    expect(entete(r.appels[2]!, "Authorization")).toBe("Bearer acces-2");
    expect(await t.jetonLong()).toBe("long-2");
    expect(evenements).toEqual([]);
  });

  it("dix requêtes en 401 ne rafraîchissent qu'une fois", async () => {
    let rafraichissements = 0;
    const r = reseau((appel) => {
      if (appel.url.endsWith("/auth/rafraichir")) {
        rafraichissements += 1;
        return json(200, {
          jeton: "acces-2",
          jetonRafraichissement: "long-2",
          utilisateur: { id: "u", email: "u@x" },
        });
      }
      return entete(appel, "Authorization") === "Bearer acces-2"
        ? json(200, { resultat: 1 })
        : json(401, {});
    });
    const { t } = transportDe(true, r.fetch);
    await t.retenirLaSession("acces-1", "long-1");
    await Promise.all(Array.from({ length: 10 }, () => t.json("/rpc", { method: "POST" })));
    expect(rafraichissements).toBe(1);
  });

  it("un rafraîchissement refusé est la fin de la session : coffre vidé, déconnexion signalée", async () => {
    const r = reseau((appel) =>
      appel.url.endsWith("/auth/rafraichir") ? json(401, {}) : json(401, {}),
    );
    const { t, evenements } = transportDe(true, r.fetch);
    await t.retenirLaSession("acces-1", "long-1");
    await expect(t.json("/rpc")).rejects.toBeInstanceOf(ErreurApi);
    expect(evenements).toEqual(["deconnexion"]);
    expect(await t.jetonLong()).toBeNull();
    expect(t.porteUnJeton()).toBe(false);
  });

  it("un second 401 après rejeu déconnecte aussi", async () => {
    const r = reseau((appel) =>
      appel.url.endsWith("/auth/rafraichir")
        ? json(200, {
            jeton: "a2",
            jetonRafraichissement: "l2",
            utilisateur: { id: "u", email: "e" },
          })
        : json(401, {}),
    );
    const { t, evenements } = transportDe(true, r.fetch);
    await t.retenirLaSession("a1", "l1");
    await expect(t.json("/rpc")).rejects.toBeInstanceOf(ErreurApi);
    expect(evenements).toEqual(["deconnexion"]);
  });

  it("ne rafraîchit jamais sur les routes d'authentification, ni dans un navigateur", async () => {
    const r = reseau(() => json(401, { erreur: "identifiants invalides" }));
    const natif = transportDe(true, r.fetch);
    await natif.t.retenirLaSession("a1", "l1");
    expect((await natif.t.appeler("/auth/connexion", { method: "POST" })).status).toBe(401);
    const web = transportDe(false, r.fetch);
    expect((await web.t.appeler("/rpc")).status).toBe(401);
    expect(r.appels.every((a) => !a.url.endsWith("/auth/rafraichir"))).toBe(true);
    expect(natif.evenements).toEqual([]);
  });
});

describe("reprendre une session au démarrage", () => {
  it("en natif : un jeton d'accès contre le jeton long, et l'identité rendue", async () => {
    const r = reseau(() =>
      json(200, {
        jeton: "a9",
        jetonRafraichissement: "l9",
        utilisateur: { id: "u9", email: "e9" },
      }),
    );
    const { t } = transportDe(true, r.fetch);
    expect(t.porteUnJeton()).toBe(false);
    const compte = await t.reprendreLaSession();
    expect(compte).toEqual({ id: "u9", email: "e9" });
    expect(t.porteUnJeton()).toBe(true);
    expect(await t.jetonLong()).toBe("l9");
  });

  it("dans un navigateur : rien à reprendre, le cookie fait foi", async () => {
    const r = reseau(() => json(200, {}));
    const { t } = transportDe(false, r.fetch);
    expect(await t.reprendreLaSession()).toBeNull();
    expect(r.appels).toHaveLength(0);
  });

  it("sans réseau : la session n'est pas finie, le coffre est gardé", async () => {
    const r = reseau(() => new TypeError("Failed to fetch"));
    const { t } = transportDe(true, r.fetch);
    expect(await t.reprendreLaSession()).toBeNull();
    expect(await t.jetonLong()).toBe("jeton-long-initial");
  });
});
