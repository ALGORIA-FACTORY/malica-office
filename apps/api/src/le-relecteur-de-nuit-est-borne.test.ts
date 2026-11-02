/**
 * Le relecteur de nuit est borné par la base (B.5.1 et B.5.2 de la passe de
 * nuit) — éprouvé sous `authenticated`, avec les claims tels que `db.ts` les
 * pose, jamais en superutilisateur.
 *
 *   ce qu'il voit       son dossier, tant qu'une relecture y est due ; rien
 *                       d'un autre dossier ; zéro ligne d'écritures, de
 *                       conversations, d'adhésions, de facturation ;
 *   ce qu'il écrit      la pièce qu'il relit, par les portes de la relecture ;
 *                       toute autre table ou toute autre pièce → refus ;
 *   qui il est          un claim avec le `sub` d'une personne, sans la marque
 *                       du serveur, ou sur un compte révoqué ne vaut rien ;
 *   un cabinet          n'ouvre pas ses PME ;
 *   le verrou           toute table de tenant est gardée, ou nommée avec sa
 *                       raison (`verrous/relecteur-de-nuit.json`).
 *
 *   node --experimental-strip-types --test src/le-relecteur-de-nuit-est-borne.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { BASE_CONFIGUREE, monterUneSociete, type SocieteDEssai } from "./circuit-d-essai.ts";
import { fermerLePool, sousIdentite, sousIdentiteDuServeur, sousLeRelecteurDeNuit } from "./db.ts";
import { parametrage } from "./depots/parametrage.ts";

interface Verrou {
  regle: string;
  ecriture: Record<string, string>;
  lecture: Record<string, string>;
}

const VERROU = JSON.parse(
  readFileSync(new URL("./verrous/relecteur-de-nuit.json", import.meta.url), "utf8"),
) as Verrou;

describe("le relecteur de nuit est borné par la base", { skip: !BASE_CONFIGUREE }, () => {
  let a: SocieteDEssai;
  let b: SocieteDEssai;
  /** La pièce de A dont la relecture est due. */
  let due = "";
  /** Une autre pièce de A, lue, sans relecture. */
  let autre = "";
  /** Une pièce de B. */
  let ailleurs = "";
  /** Une pièce personnelle de Sonia, et une pièce archivée de A. */
  let privee = "";
  let archivee = "";
  let operateur = "";
  let service = "";
  /** Le rôle de connexion de l'API, pour poser des claims à la main. */
  const api = new pg.Pool({ connectionString: process.env["DATABASE_URL"], max: 2 });

  before(async () => {
    a = await monterUneSociete(`borne-a-${Date.now()}`);
    b = await monterUneSociete(`borne-b-${Date.now()}`);
    const jour = (
      await sousIdentiteDuServeur(a.gens.expert.id, (db) =>
        parametrage.fuseauDuCabinet(db, a.cabinet),
      )
    ).aujourdhui!;
    await sousIdentiteDuServeur(a.gens.expert.id, (db) =>
      parametrage.arreterReglagesComptables(db, {
        cabinetId: a.cabinet,
        portee: "dossier",
        porteeId: a.pme,
        packId: a.pack,
        depuis: jour,
        valeurs: [
          { code: "lecture.relecture_nuit", valeur: "active" },
          { code: "lecture.relecture_delai_heures", valeur: "0.000001" },
        ],
      }),
    );
    due = await a.deposer("sami", "personnel");
    await a.lire("sami", due);
    await sousIdentiteDuServeur(a.gens.sami.id, (db) =>
      db.query(
        `select fabrique.relecture_inscrire($1, '{"lecteur":"vision","paddleTente":false}')`,
        [due],
      ),
    );
    autre = await a.deposer("sonia", "entite");
    await a.lire("sonia", autre);
    ailleurs = await b.deposer("sami", "entite");
    privee = await a.deposer("sonia", "personnel");
    archivee = await a.deposer("sonia", "entite");
    await a.admin.query(`update capture.pieces set archivee_le = now() where id = $1`, [archivee]);
    await b.lire("sami", ailleurs);
    operateur = a.gens.bilel.id;
    await a.admin.query(`insert into app.platform_operators (user_id, note) values ($1, $2)`, [
      operateur,
      "épreuve du relecteur de nuit",
    ]);
    service = (
      await a.admin.query<{ id: string }>(
        `select id from identity.comptes_de_service where code = 'relecteur_de_nuit'`,
      )
    ).rows[0]!.id;
  });

  after(async () => {
    try {
      await a.admin.query(`delete from app.platform_operators where user_id = $1`, [operateur]);
      await a?.fermer();
      await b?.fermer();
    } finally {
      await api.end();
      await fermerLePool();
    }
  });

  /** Une requête sous le relecteur, pour un dossier. */
  const sous = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    tenant: string,
    sql: string,
    params: unknown[] = [],
  ) => sousLeRelecteurDeNuit(tenant, async (db) => (await db.query<T>(sql, params)).rows);

  /** Ce que voit une transaction aux claims posés à la main. */
  async function sousClaims(claims: Record<string, string>, serveur: boolean, sql: string) {
    const client = await api.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      for (const [k, v] of Object.entries(claims)) {
        await client.query("select set_config($1, $2, true)", [`request.jwt.claim.${k}`, v]);
      }
      if (serveur) await client.query("select set_config('malica.origine', 'serveur', true)");
      return (await client.query(sql)).rows;
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("il est le relecteur, et rien d'autre : ni plateforme, ni cabinet", async () => {
    const [r] = await sous<{ s: string; p: boolean; e: number }>(
      a.pme,
      `select app.service() as s, app.is_platform() as p,
              (select count(*) from app.engaged_orgs())::int as e`,
    );
    assert.deepEqual(r, { s: "relecteur_de_nuit", p: false, e: 0 });
  });

  it("il lit les pièces de son dossier — personnelle comprise —, et rien d'un autre", async () => {
    const vues = await sous<{ id: string }>(a.pme, `select id from capture.pieces`);
    const ids = vues.map((v) => v.id);
    assert.ok(ids.includes(due), "la pièce à relire, quoique personnelle");
    assert.ok(ids.includes(autre), "les autres pièces du dossier, pour juger (doublon probable)");
    assert.ok(!ids.includes(ailleurs), "rien de B");
    // Jamais plus que l'auteur de la pièce relue (Sami) n'en verrait.
    assert.ok(!ids.includes(privee), "ni la pièce PERSONNELLE de Sonia");
    assert.ok(!ids.includes(archivee), "ni une pièce archivée");
    const deB = await sous(a.pme, `select 1 from capture.pieces where tenant_id = $1`, [b.pme]);
    assert.equal(deB.length, 0);
  });

  it("zéro ligne d'adhésions, d'écritures, de conversations, de facturation", async () => {
    for (const table of [
      "identity.memberships",
      "socle.ecritures",
      "agents.conversations",
      "facturation.lectures",
      "facturation.licence_organisations",
    ]) {
      const rows = await sous(a.pme, `select 1 from ${table} where tenant_id = $1`, [a.pme]);
      assert.equal(rows.length, 0, table);
    }
    // Ce que voit un membre qui voit tout, pour que le zéro ait un sens.
    const membres = await sousIdentite(
      a.gens.amel.id,
      async (db) =>
        (await db.query(`select 1 from identity.memberships where tenant_id = $1`, [a.pme])).rows,
    );
    assert.ok(membres.length > 0);
  });

  it("une écriture hors de sa liste est refusée, une autre pièce aussi", async () => {
    // Une précision : `capture.precisions` n'est pas dans la liste d'écriture.
    await assert.rejects(
      sous(a.pme, `select public.capture_precision_persist($1, 'document_date', '2026-09-02')`, [
        due,
      ]),
      /refus\.service\.hors_perimetre/,
    );
    // Décompter une lecture : `facturation.lectures` est exclue (ALGORIA paie).
    await assert.rejects(
      sous(a.pme, `select public.lecture_consommer($1)`, [due]),
      /refus\.(service\.hors_perimetre|lecture\.)/,
    );
    // Un journal de coût sur une AUTRE pièce que celle qu'il relit.
    const [tarif] = (
      await a.admin.query<{ model: string; role: string }>(
        `select model, role from agents.model_pricing where effective_to is null limit 1`,
      )
    ).rows;
    await assert.rejects(
      sous(a.pme, `select public.agents_run_log($1, 'essai', $2, $3, 'ok', 1, 1, 1, $4, null)`, [
        a.pme,
        tarif!.model,
        tarif!.role,
        autre,
      ]),
      /refus\.service\.hors_perimetre/,
    );
    // Un coût sans pièce n'est pas de la relecture.
    await assert.rejects(
      sous(a.pme, `select public.agents_run_log($1, 'essai', $2, $3, 'ok', 1, 1, 1, null, null)`, [
        a.pme,
        tarif!.model,
        tarif!.role,
      ]),
      /refus\.service\.hors_perimetre/,
    );
    // Le même, sur sa pièce, passe : c'est le chemin de la relecture.
    const [ok] = await sous<{ id: string }>(
      a.pme,
      `select public.agents_run_log($1, 'essai', $2, $3, 'ok', 1, 1, 1, $4, null) as id`,
      [a.pme, tarif!.model, tarif!.role, due],
    );
    assert.ok(ok?.id);
    const [acteur] = (
      await a.admin.query<{ created_by: string }>(
        `select created_by from agents.agent_runs where id = $1`,
        [ok!.id],
      )
    ).rows;
    assert.equal(acteur?.created_by, service, "le relecteur est l'acteur");
  });

  it("sans relecture due, il ne voit rien du dossier", async () => {
    const rows = await sous(b.pme, `select 1 from capture.pieces`);
    assert.equal(rows.length, 0);
    const orgs = await sous(b.pme, `select app.member_orgs()`);
    assert.equal(orgs.length, 0);
  });

  it("un cabinet n'ouvre pas ses PME", async () => {
    const rows = await sous(a.cabinet, `select 1 from capture.pieces where tenant_id = $1`, [
      a.pme,
    ]);
    assert.equal(rows.length, 0);
  });

  it("le claim ne vaut rien avec le `sub` d'une personne, ou sans la marque du serveur", async () => {
    const personne = await sousClaims(
      { sub: a.gens.sonia.id, service: "relecteur_de_nuit", service_tenant: a.pme },
      true,
      `select app.service() as s`,
    );
    assert.equal(personne[0]?.s, null);
    const sansServeur = await sousClaims(
      { sub: service, service: "relecteur_de_nuit", service_tenant: a.pme },
      false,
      `select app.service() as s, (select count(*) from capture.pieces)::int as n`,
    );
    assert.deepEqual(sansServeur[0], { s: null, n: 0 });
  });

  it("révoqué par la tour, sans déploiement, il ne voit plus rien", async () => {
    /*
     * Dans UNE transaction annulée : la révocation est globale, et la base
     * d'essai est partagée avec la passe de nuit qui tourne en parallèle.
     * L'opérateur révoque, puis la même transaction prend les claims du
     * relecteur — exactement ceux que pose `sousLeRelecteurDeNuit`.
     */
    const client = await api.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      const claim = (k: string, v: string) =>
        client.query("select set_config($1, $2, true)", [`request.jwt.claim.${k}`, v]);
      await claim("sub", operateur);
      await client.query(
        `select identity.compte_de_service_regler('relecteur_de_nuit', false, 'épreuve')`,
      );
      await claim("sub", service);
      await claim("service", "relecteur_de_nuit");
      await claim("service_tenant", a.pme);
      await client.query("select set_config('malica.origine', 'serveur', true)");
      const { rows } = await client.query<{ s: string | null; n: number }>(
        `select app.service() as s, (select count(*) from capture.pieces)::int as n`,
      );
      assert.deepEqual(rows[0], { s: null, n: 0 });
    } finally {
      await client.query("rollback");
      client.release();
    }
    const [r] = await sous<{ s: string }>(a.pme, `select app.service() as s`);
    assert.equal(r?.s, "relecteur_de_nuit", "la révocation annulée, il est toujours là");
    // Un membre ne règle pas le compte.
    await assert.rejects(
      sousIdentite(a.gens.amel.id, (db) =>
        db.query(`select identity.compte_de_service_regler('relecteur_de_nuit', false, 'non')`),
      ),
      /refus\.reserve\.plateforme/,
    );
  });

  it("le verrou : chaque table de tenant est gardée, ou nommée avec sa raison", async () => {
    const sansRaison = [...Object.entries(VERROU.ecriture), ...Object.entries(VERROU.lecture)]
      .filter(([, raison]) => raison.trim().length < 20)
      .map(([t]) => t);
    assert.deepEqual(sansRaison, []);

    const { rows } = await a.admin.query<{ nom: string; ecrit: boolean; lit: boolean }>(`
      select n.nspname || '.' || c.relname as nom,
             not exists (select 1 from pg_trigger t
                          where t.tgrelid = c.oid and t.tgname = 'service_hors_perimetre') as ecrit,
             not exists (select 1 from pg_policies p
                          where p.schemaname = n.nspname and p.tablename = c.relname
                            and p.policyname = 'service_hors_perimetre'
                            and p.permissive = 'RESTRICTIVE') as lit
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute x on x.attrelid = c.oid and x.attname = 'tenant_id'
                           and x.attnum > 0 and not x.attisdropped
       where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema')
       order by 1`);
    assert.deepEqual(
      rows.filter((r) => r.ecrit).map((r) => r.nom),
      Object.keys(VERROU.ecriture).sort(),
      "tables de tenant que le relecteur peut écrire : gardez la nouvelle, ou nommez-la",
    );
    assert.deepEqual(
      rows.filter((r) => r.lit).map((r) => r.nom),
      Object.keys(VERROU.lecture).sort(),
      "tables de tenant que le relecteur peut lire : gardez la nouvelle, ou nommez-la",
    );
  });
});
