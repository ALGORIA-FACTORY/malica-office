/**
 * Le jeton d'accès se révoque (audit de sécurité du 6 novembre 2026, S4).
 *
 * Reproduit : `POST /auth/deconnexion`, puis `GET /moi` avec le MÊME jeton en
 * porteur → 200. Le jeton d'accès de douze heures n'avait ni identifiant ni
 * date comparée à rien : la déconnexion effaçait le cookie, la
 * réinitialisation révoquait les jetons longs, et le jeton déjà émis restait
 * valable jusqu'à son expiration — téléphone perdu, session volée.
 *
 * Ce qu'il établit, par le réseau, contre la vraie application :
 *   — se déconnecter ferme le jeton présenté, et lui seul : l'autre appareil
 *     reste connecté, comme avant ;
 *   — se déconnecter « partout » ferme tous les jetons d'accès du compte et
 *     ses jetons longs ; une connexion ultérieure ouvre à nouveau ;
 *   — réinitialiser le mot de passe ferme les jetons d'avant, pas celui qu'elle
 *     rend ;
 *   — un jeton fermé reçoit 401 partout, `/auth/session` comprise.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env --env-file-if-exists=.env.test \
 *     --import ./src/garde-base-de-test.ts --test src/un-jeton-d-acces-se-revoque.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

describe("le jeton d'accès se révoque", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `jeton-revoque-${Date.now()}`;
  const MOT_DE_PASSE = "MotDePasseTresLong2026!";
  const COQUE = { "X-Malica-Client": "coque-android/0.1.0" };
  let base = "";
  let arret: (() => Promise<void>) | null = null;

  before(async () => {
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  });

  after(async () => {
    await arret?.();
    const { fermerLePool } = await import("./db.ts");
    await fermerLePool();
  });

  const poster = (chemin: string, corps: unknown, entetes: Record<string, string> = {}) =>
    fetch(`${base}${chemin}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...entetes },
      body: JSON.stringify(corps),
    });

  const porteur = (jeton: string) => ({ Authorization: `Bearer ${jeton}` });

  const moi = (jeton: string) => fetch(`${base}/moi`, { headers: porteur(jeton) });

  async function inscrire(nom: string): Promise<string> {
    const email = `${nom}-${marque}@essai.local`;
    const r = await poster("/auth/inscription", { email, motDePasse: MOT_DE_PASSE });
    assert.equal(r.status, 201);
    return email;
  }

  async function connecter(
    email: string,
    entetes: Record<string, string> = {},
  ): Promise<{ jeton: string; jetonRafraichissement?: string; cookie: string }> {
    const r = await poster("/auth/connexion", { email, motDePasse: MOT_DE_PASSE }, entetes);
    assert.equal(r.status, 200);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
    return { ...((await r.json()) as { jeton: string; jetonRafraichissement?: string }), cookie };
  }

  it("la déconnexion par le cookie ferme le jeton, même présenté en porteur", async () => {
    const email = await inscrire("bilel");
    const { jeton, cookie } = await connecter(email);
    assert.equal((await moi(jeton)).status, 200);

    const sortie = await poster("/auth/deconnexion", {}, { Cookie: cookie });
    assert.equal(sortie.status, 204);

    assert.equal((await moi(jeton)).status, 401);
    const session = await fetch(`${base}/auth/session`, { headers: porteur(jeton) });
    assert.equal(session.status, 401);
  });

  it("se déconnecter sur un appareil ne déconnecte pas l'autre", async () => {
    const email = await inscrire("deux-appareils");
    const telephone = await connecter(email);
    const ordinateur = await connecter(email);

    assert.equal((await poster("/auth/deconnexion", {}, porteur(telephone.jeton))).status, 204);

    assert.equal((await moi(telephone.jeton)).status, 401);
    assert.equal((await moi(ordinateur.jeton)).status, 200);
  });

  it("se déconnecter partout ferme tous les jetons du compte, longs compris", async () => {
    const email = await inscrire("partout");
    const telephone = await connecter(email, COQUE);
    const ordinateur = await connecter(email);
    assert.ok(telephone.jetonRafraichissement);

    const sortie = await poster("/auth/deconnexion", { partout: true }, porteur(ordinateur.jeton));
    assert.equal(sortie.status, 204);

    assert.equal((await moi(ordinateur.jeton)).status, 401);
    assert.equal((await moi(telephone.jeton)).status, 401);
    const rafraichi = await poster(
      "/auth/rafraichir",
      { jetonRafraichissement: telephone.jetonRafraichissement },
      COQUE,
    );
    assert.equal(rafraichi.status, 401);

    // Ce n'est pas le compte qui est fermé : une connexion nouvelle ouvre.
    const apres = await connecter(email);
    assert.equal((await moi(apres.jeton)).status, 200);
  });

  it("« partout » sans session valide ne ferme rien", async () => {
    const email = await inscrire("partout-sans-session");
    const { jeton } = await connecter(email);
    const sortie = await poster("/auth/deconnexion", { partout: true });
    assert.equal(sortie.status, 204);
    assert.equal((await moi(jeton)).status, 200);
  });

  it("réinitialiser le mot de passe ferme les jetons d'avant, pas celui qu'elle rend", async () => {
    const email = await inscrire("reinitialise");
    const avant = await connecter(email);
    assert.equal((await moi(avant.jeton)).status, 200);

    const { demanderReinitialisation } = await import("./auth.ts");
    const demande = await demanderReinitialisation(email);
    assert.ok(demande);
    const r = await poster("/auth/reinitialiser", {
      secret: demande.secret,
      motDePasse: "UnAutreMotDePasseLong2026!",
    });
    assert.equal(r.status, 200);
    const { jeton: neuf } = (await r.json()) as { jeton: string };

    assert.equal((await moi(avant.jeton)).status, 401);
    assert.equal((await moi(neuf)).status, 200);
  });
});
