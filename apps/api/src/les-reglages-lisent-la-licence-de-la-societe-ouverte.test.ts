/**
 * Les réglages lisent la licence de la société OUVERTE, pas celle du compte.
 *
 * Recette du 3 novembre 2026 : SOTUMAG ouverte, la rubrique « Sociétés »
 * montrait ALGORIA FACTORY SUARL (la licence dont le compte est titulaire),
 * son cabinet, son bouton « Révoquer » — et SOTUMAG nulle part.
 *
 *   W : titulaire de la licence A (sociétés A1, A2), propriétaire non principal de S.
 *   T : titulaire de la licence S (société S).
 *   C : collaborateur de S.
 *
 *   node --experimental-strip-types --import ./src/garde-base-de-test.ts \
 *     --test src/les-reglages-lisent-la-licence-de-la-societe-ouverte.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { creerCompte, type Utilisateur } from "./auth.ts";
import { fermerLePool, sousIdentite } from "./db.ts";
import { executerRpc } from "./rpc.ts";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

interface Org {
  tenant_id: string;
  nom: string;
  titulaire: boolean;
}
interface Siege {
  user_id: string;
  tenant_id: string;
}

describe("les réglages lisent la licence de la société ouverte", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `licence-${Date.now()}`;
  const mdp = "MotDePasseTresLong2026!";
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let w: Utilisateur;
  let titulaireS: Utilisateur;
  let collab: Utilisateur;
  const org = { a1: "", a2: "", s: "" };

  const lire = <T>(u: Utilisateur, methode: string, tenantId: string) =>
    sousIdentite(u.id, (db) =>
      executerRpc(db, { depot: "facturation", methode, args: [tenantId] }),
    ) as Promise<T>;

  const creerOrg = async (nom: string) =>
    (
      await admin.query<{ id: string }>(
        `insert into identity.organizations (kind, name, jurisdiction, currency)
         values ('pme', $1, 'TN', 'TND') returning id`,
        [nom],
      )
    ).rows[0]!.id;
  const membre = (tenant: string, u: Utilisateur, role: string) =>
    admin.query("insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, $3)", [
      tenant,
      u.id,
      role,
    ]);
  const licence = async (u: Utilisateur, offre: string, orgs: string[]) => {
    const l = await admin.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, $2, current_date) returning id`,
      [u.id, offre],
    );
    for (const t of orgs)
      await admin.query(
        "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
        [l.rows[0]!.id, t],
      );
  };

  before(async () => {
    w = (await creerCompte(`w-${marque}@essai.local`, mdp))!;
    titulaireS = (await creerCompte(`t-${marque}@essai.local`, mdp))!;
    collab = (await creerCompte(`c-${marque}@essai.local`, mdp))!;
    org.a1 = await creerOrg(`A1 ${marque}`);
    org.a2 = await creerOrg(`A2 ${marque}`);
    org.s = await creerOrg(`S ${marque}`);
    await membre(org.a1, w, "dirigeant");
    await membre(org.a2, w, "dirigeant");
    await membre(org.s, titulaireS, "dirigeant");
    await membre(org.s, w, "dirigeant");
    await membre(org.s, collab, "collaborateur");
    await licence(w, "premium", [org.a1, org.a2]);
    await licence(titulaireS, "team", [org.s]);
  });

  after(async () => {
    try {
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = any($1::uuid[]) and archived_at is null`,
        [Object.values(org).filter(Boolean)],
      );
    } finally {
      await admin.end();
      await fermerLePool();
    }
  });

  it("la société ouverte est dans la liste, et la licence d'un autre titulaire ne déborde pas", async () => {
    const orgs = await lire<Org[]>(w, "organisations", org.s);
    assert.deepEqual(
      orgs.map((o) => [o.tenant_id, o.titulaire]),
      [[org.s, false]],
      "ni A1 ni A2 : la licence du compte n'est pas celle de la société ouverte",
    );
  });

  it("le titulaire voit toute sa licence, la société ouverte en tête", async () => {
    const orgs = await lire<Org[]>(w, "organisations", org.a2);
    assert.equal(orgs[0]?.tenant_id, org.a2);
    assert.deepEqual(new Set(orgs.map((o) => o.tenant_id)), new Set([org.a1, org.a2]));
    assert.ok(orgs.every((o) => o.titulaire));
    const deS = await lire<Org[]>(titulaireS, "organisations", org.s);
    assert.deepEqual(
      deS.map((o) => [o.tenant_id, o.titulaire]),
      [[org.s, true]],
    );
  });

  it("les sièges suivent la société ouverte", async () => {
    const deS = await lire<Siege[]>(w, "sieges", org.s);
    assert.deepEqual(new Set(deS.map((s) => s.tenant_id)), new Set([org.s]));
    assert.deepEqual(new Set(deS.map((s) => s.user_id)), new Set([w.id, titulaireS.id, collab.id]));
    const deA = await lire<Siege[]>(w, "sieges", org.a1);
    assert.deepEqual(new Set(deA.map((s) => s.tenant_id)), new Set([org.a1, org.a2]));
    assert.deepEqual(
      await lire<Siege[]>(collab, "sieges", org.s),
      [],
      "un collaborateur n'en voit aucun",
    );
  });

  it("une société dont on n'est pas membre ne se lit pas", async () => {
    await assert.rejects(lire(collab, "organisations", org.a1), /non_permis/);
    await assert.rejects(lire(collab, "sieges", org.a1), /non_permis/);
  });
});
