/**
 * L'application Android invite, sur une place incluse seulement (23 octobre 2026).
 *
 * Décision de Wissem : l'invitation est rouverte dans la coque pour les places
 * comprises dans l'abonnement. Une place au-delà serait facturée — un achat,
 * que les règles de Google Play veulent hors de l'application. La base compte
 * les places occupées ET les invitations en attente ; le web garde tout.
 *
 *   node --experimental-strip-types --test src/la-coque-n-invite-que-sur-une-place-incluse.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import pg from "pg";

const BASE_CONFIGUREE = Boolean(
  process.env["DATABASE_URL"] && process.env["JWT_SECRET"] && process.env["DATABASE_URL_ADMIN"],
);

describe("la coque n'invite que sur une place incluse", { skip: !BASE_CONFIGUREE }, () => {
  const marque = `invite-coque-${Date.now()}`;
  const COQUE = { "X-Malica-Client": "coque-android/0.2.70" };
  const admin = new pg.Pool({ connectionString: process.env["DATABASE_URL_ADMIN"] });
  let base = "";
  let jeton = "";
  let tenant = "";
  let arret: (() => Promise<void>) | null = null;

  before(async () => {
    const { app } = await import("./app.ts");
    const serveur = app.listen(0);
    await new Promise((resoudre) => serveur.once("listening", resoudre));
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    arret = () => new Promise<void>((resoudre) => serveur.close(() => resoudre()));
    const email = `${marque}@essai.local`;
    const r = await fetch(`${base}/auth/inscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, motDePasse: "MotDePasseTresLong2026!" }),
    });
    assert.equal(r.status, 201);
    jeton = ((await r.json()) as { jeton: string }).jeton;
    const { rows: u } = await admin.query<{ id: string }>(
      "select id from auth.users where email = $1",
      [email],
    );
    const titulaire = u[0]!.id;
    const o = await admin.query<{ id: string }>(
      `insert into identity.organizations (kind, name, jurisdiction, currency)
       values ('pme', $1, 'TN', 'TND') returning id`,
      [`PME ${marque}`],
    );
    tenant = o.rows[0]!.id;
    await admin.query(
      "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
      [tenant, titulaire],
    );
    // Team : deux places incluses, d'après `ref.offres`.
    const l = await admin.query<{ id: string }>(
      `insert into facturation.licences (titulaire, offre_code, offre_depuis)
       values ($1, 'team', current_date) returning id`,
      [titulaire],
    );
    await admin.query(
      "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
      [l.rows[0]!.id, tenant],
    );
  });

  after(async () => {
    try {
      await arret?.();
      await admin.query(
        `update identity.organizations
            set archived_at = now(), archived_reason = 'fixture de test automatisé'
          where id = $1 and archived_at is null`,
        [tenant],
      );
    } finally {
      await admin.end();
      const { fermerLePool } = await import("./db.ts");
      await fermerLePool();
    }
  });

  const inviter = (email: string, entetes: Record<string, string>) =>
    fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jeton}`, ...entetes },
      body: JSON.stringify({
        depot: "facturation",
        methode: "inviterSiege",
        args: [`${email}-${marque}@essai.local`, tenant],
      }),
    });

  it("les places incluses s'offrent depuis la coque, invitations en attente comprises", async () => {
    const { rows } = await admin.query<{ n: number }>(
      `select d.sieges_inclus as n from facturation.droits_v d
         join facturation.licence_organisations lo on lo.licence_id = d.licence_id
        where lo.tenant_id = $1`,
      [tenant],
    );
    const incluses = Number(rows[0]!.n);
    assert.ok(incluses > 0, "l'offre d'essai porte des places incluses");
    for (let i = 0; i < incluses; i++) {
      assert.equal((await inviter(`inclus${i}`, COQUE)).status, 200);
    }
    // La même adresse, déjà invitée, est rendue telle quelle : rien de plus n'est engagé.
    assert.equal((await inviter("inclus0", COQUE)).status, 200);

    const refus = await inviter("de-trop", COQUE);
    assert.equal(refus.status, 400);
    const { erreur } = (await refus.json()) as { erreur: string };
    assert.equal(erreur, "refus.place.incluses_prises");
    assert.doesNotMatch(erreur, /pay|navigateur|web/i, "le refus n'invite pas à payer ailleurs");
  });

  it("le web garde la place facturée", async () => {
    assert.equal((await inviter("de-trop", {})).status, 200);
  });
});
