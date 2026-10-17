/**
 * Une vue n'est pas une porte dérobée.
 *
 * `postgres` est superutilisateur ET `bypassrls` sur cette base. Une vue qui
 * lui appartient et n'est pas `security_invoker` lit ses tables avec les droits
 * de son propriétaire : la RLS ne s'applique pas, et la vue rend les lignes de
 * TOUS les clients à quiconque a `select` dessus. C'est le troisième chemin
 * que R6 ne nomme pas — ni un filtre applicatif oublié, ni une politique
 * oubliée, mais une politique contournée.
 *
 * Il est passé inaperçu tant que le schéma `facturation` n'avait pas `usage`
 * pour `authenticated` : les quatre vues étaient inatteignables. Le jour où le
 * droit a été ouvert — il le fallait — la fuite est devenue réelle.
 *
 * Preuve par exécution, pas par lecture : deux licences, deux titulaires. Sous
 * l'identité du titulaire A, authentifié et non-plateforme, aucune vue ne rend
 * une ligne de B ; A voit bien les siennes (sinon on a fermé plus que le trou) ;
 * et un opérateur de la plateforme voit les deux.
 *
 * Tout se passe dans une transaction annulée.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import pg from "pg";

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

interface Abonne {
  titulaire: string;
  licence: string;
  tenant: string;
}

/** Une licence complète : organisation, dirigeant, facture en retard, réclamation, envoi. */
async function abonner(db: pg.PoolClient, nom: string, ht: number): Promise<Abonne> {
  const titulaire = randomUUID();
  const licence = randomUUID();
  const org = await db.query<{ id: string }>(
    `insert into identity.organizations (kind, name, jurisdiction, currency)
     values ('pme', $1, 'TN', 'TND') returning id`,
    [`Abonné ${nom}`],
  );
  const tenant = org.rows[0]!.id;
  await db.query(
    "insert into identity.memberships (tenant_id, user_id, role) values ($1, $2, 'dirigeant')",
    [tenant, titulaire],
  );
  await db.query(
    `insert into facturation.licences (id, titulaire, offre_code, offre_depuis)
     values ($1, $2, 'solo', current_date)`,
    [licence, titulaire],
  );
  await db.query("insert into identity.entities (tenant_id, code, name) values ($1, $2, $3)", [
    tenant,
    `E-${nom}`,
    `Établissement ${nom}`,
  ]);
  await db.query(
    "insert into facturation.licence_organisations (licence_id, tenant_id) values ($1, $2)",
    [licence, tenant],
  );
  // En retard depuis longtemps : `a_relancer_v` la retient, à un palier.
  await db.query(
    `insert into facturation.factures
       (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations,
        sieges_payants, montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise)
     values ($1, $2, date '2024-12-01', date '2024-12-01', date '2025-01-15', 'solo', 1,
             0, $3::numeric, 0.19, $3::numeric * 0.19, 1, $3::numeric * 1.19 + 1, 'TND')`,
    [licence, `ESSAI-${nom}-${licence.slice(0, 8)}`, ht],
  );
  await db.query(
    `insert into plateforme.reclamations (licence_id, tenant_id, objet, sujet, corps, ouverte_par)
     values ($1, $2, 'autre', $3, 'corps', $4)`,
    [licence, tenant, `Sujet ${nom}`, titulaire],
  );
  await db.query(
    `insert into notif.envois
       (tenant_id, destinataire, code, canal, sujet_cle, titre_rendu, corps_rendu, decision)
     values ($1, $2, 'essai', 'app', $3, 'titre', 'corps', 'a_remettre')`,
    [tenant, titulaire, `cle-${nom}-${licence}`],
  );
  return { titulaire, licence, tenant };
}

/** Lit sous le rôle `authenticated`, avec l'identité donnée, puis rend la main. */
async function lire<T extends Record<string, unknown>>(
  db: pg.PoolClient,
  identite: string,
  sql: string,
): Promise<T[]> {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [identite]);
  try {
    const { rows } = await db.query<T>(sql);
    return rows;
  } finally {
    await db.query("reset role");
  }
}

/** Les vues rattachées à une licence : colonne qui la porte. */
const PAR_LICENCE: Array<[string, string]> = [
  ["facturation.droits_v", "licence_id"],
  ["facturation.consommation_v", "licence_id"],
  ["facturation.droits_reels_v", "licence_id"],
  ["facturation.encours_v", "licence_id"],
  ["facturation.a_relancer_v", "licence_id"],
  ["plateforme.clients_v", "licence_id"],
  ["plateforme.reclamations_v", "licence_id"],
];

describe("les vues accordées n'ouvrent pas l'isolation entre clients", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  async function dansUneTransaction(
    corps: (db: pg.PoolClient, a: Abonne, b: Abonne, operateur: string) => Promise<void>,
  ): Promise<void> {
    const db = await pool!.connect();
    try {
      await db.query("begin");
      const a = await abonner(db, "A", 100);
      const b = await abonner(db, "B", 200);
      const operateur = randomUUID();
      await db.query("insert into app.platform_operators (user_id) values ($1)", [operateur]);
      await corps(db, a, b, operateur);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }

  for (const [vue, colonne] of PAR_LICENCE) {
    it(`${vue} : A ne voit rien de B, voit le sien ; la plateforme voit les deux`, async () => {
      await dansUneTransaction(async (db, a, b, operateur) => {
        const requete = (licence: string) => `select 1 from ${vue} where ${colonne} = '${licence}'`;

        const deB = await lire(db, a.titulaire, requete(b.licence));
        assert.equal(deB.length, 0, `${vue} rend des lignes de la licence d'un AUTRE client`);

        const deA = await lire(db, a.titulaire, requete(a.licence));
        assert.ok(deA.length >= 1, `${vue} ne rend plus à A ce qui est à lui`);

        const parLaPlateforme = [
          ...(await lire(db, operateur, requete(a.licence))),
          ...(await lire(db, operateur, requete(b.licence))),
        ];
        assert.ok(
          parLaPlateforme.length >= 2,
          `${vue} : la plateforme doit voir les deux licences`,
        );
      });
    });
  }

  it("public.entities_v : A ne voit pas les établissements de B, voit les siens", async () => {
    await dansUneTransaction(async (db, a, b) => {
      const requete = (tenant: string) =>
        `select 1 from public.entities_v where tenant_id = '${tenant}'`;
      assert.equal((await lire(db, a.titulaire, requete(b.tenant))).length, 0);
      assert.ok((await lire(db, a.titulaire, requete(a.tenant))).length >= 1);
    });
  });

  it("notif.envois_v : A ne voit pas l'envoi destiné à B, voit le sien", async () => {
    await dansUneTransaction(async (db, a, b, operateur) => {
      const requete = (dest: string) =>
        `select 1 from notif.envois_v where destinataire = '${dest}'`;
      assert.equal((await lire(db, a.titulaire, requete(b.titulaire))).length, 0);
      assert.ok((await lire(db, a.titulaire, requete(a.titulaire))).length >= 1);
      assert.ok((await lire(db, operateur, requete(b.titulaire))).length >= 1);
    });
  });

  it("facturation.flux_mensuel_v : le chiffre d'affaires de B n'entre pas dans les mois de A", async () => {
    await dansUneTransaction(async (db, a, _b, operateur) => {
      const mois =
        "select facture_ht::numeric as ht from facturation.flux_mensuel_v where mois = date '2024-12-01'";

      const vuParA = await lire<{ ht: string }>(db, a.titulaire, mois);
      assert.equal(vuParA.length, 1);
      assert.equal(
        Number(vuParA[0]!.ht),
        100,
        "A ne doit voir que sa propre facture (100), pas celle de B",
      );

      const vuParLaPlateforme = await lire<{ ht: string }>(db, operateur, mois);
      assert.equal(
        Number(vuParLaPlateforme[0]!.ht),
        300,
        "la plateforme voit les deux (100 + 200)",
      );
    });
  });
});
