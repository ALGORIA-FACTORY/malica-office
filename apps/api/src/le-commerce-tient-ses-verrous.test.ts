/**
 * Le commerce tient ses verrous — le verrou de la CI du moteur commercial
 * (plan du 2 novembre 2026, annexe 2.9).
 *
 * Pour CHAQUE table de `facturation` et de `plateforme`, lue dans le
 * catalogue (jamais déclarée à la main) :
 *
 *   * RLS activée ET forcée, au moins une politique de lecture permissive ;
 *   * la politique restrictive et le déclencheur `service_hors_perimetre` :
 *     un compte de service (le relecteur de nuit) ne lit ni n'écrit rien du
 *     commerce, même par une table sans `tenant_id` ;
 *   * aucun droit d'écriture pour authenticated, anon, public ou portier,
 *     hors de ceux que `verrous/commerce.json` nomme ;
 *   * un index menant par la colonne que nomme sa politique (`cle`), sans
 *     quoi chaque lecture parcourt la table entière, tous clients confondus ;
 *   * `deny_mutation` si l'instantané la dit en ajout seul.
 *
 * Et : les vues de `plateforme` sont `security_invoker` et nomment
 * `app.is_platform()` ; le compteur sans trou n'avance que d'un ; les
 * fonctions internes du commerce ne sont pas exécutables par un client.
 *
 * Une table nouvelle non nommée échoue ; une table nommée qui a disparu aussi.
 *
 *   node --experimental-strip-types --test src/le-commerce-tient-ses-verrous.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";

import pg from "pg";

interface Verrou {
  regle: string;
  tables: Record<string, { cle: string | null; ajout_seul: boolean; raison: string }>;
  ecritures_permises: Record<string, string[]>;
  vues_hors_tour: Record<string, string>;
  internes: string[];
}

const VERROU = JSON.parse(
  readFileSync(new URL("./verrous/commerce.json", import.meta.url), "utf8"),
) as Verrou;

const ADMIN = process.env["DATABASE_URL_ADMIN"];
const pool = ADMIN ? new pg.Pool({ connectionString: ADMIN, max: 1 }) : null;

const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  (await pool!.query<T>(sql, params)).rows;

const TABLES = `
  select c.oid, n.nspname || '.' || c.relname as nom, c.relrowsecurity as rls,
         c.relforcerowsecurity as forcee
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('facturation', 'plateforme') and c.relkind = 'r'`;

describe("le commerce tient ses verrous", { skip: !ADMIN }, () => {
  after(async () => {
    await pool?.end();
  });

  it("chaque table du commerce est nommée dans l'instantané, avec sa raison", async () => {
    const noms = (await q<{ nom: string }>(`${TABLES} order by 2`)).map((r) => r.nom);
    const nommees = Object.keys(VERROU.tables).sort();
    assert.deepEqual(
      {
        nouvelles: noms.filter((n) => !nommees.includes(n)),
        parties: nommees.filter((n) => !noms.includes(n)),
      },
      { nouvelles: [], parties: [] },
      "nommez la table nouvelle dans verrous/commerce.json (cle, ajout_seul, raison), ou retirez celle qui est partie",
    );
    const sansRaison = Object.entries(VERROU.tables)
      .filter(([, t]) => t.raison.trim().length < 20)
      .map(([n]) => n);
    assert.deepEqual(sansRaison, []);
  });

  it("RLS activée et forcée, une lecture permise, et rien pour un compte de service", async () => {
    const fautes = await q<{ nom: string; faute: string }>(`
      with t as (${TABLES})
      select t.nom, f.faute from t
      cross join lateral (
        select 'rls non activée' as faute where not t.rls
        union all select 'rls non forcée' where not t.forcee
        union all select 'aucune politique de lecture'
         where not exists (select 1 from pg_policy p where p.polrelid = t.oid and p.polpermissive
                              and p.polcmd in ('r', '*'))
        union all select 'politique restrictive du service absente'
         where not exists (select 1 from pg_policy p where p.polrelid = t.oid and not p.polpermissive
                              and p.polname = 'service_hors_perimetre')
        union all select 'déclencheur du service absent'
         where not exists (select 1 from pg_trigger g where g.tgrelid = t.oid
                              and g.tgname = 'service_hors_perimetre')) f
      order by 1, 2`);
    assert.deepEqual(
      fautes.map((f) => `${f.nom} : ${f.faute}`),
      [],
    );
  });

  it("aucun client n'écrit une table du commerce, hors des droits nommés", async () => {
    const droits = await q<{ nom: string; droit: string }>(`
      select g.table_schema || '.' || g.table_name as nom, g.privilege_type || ':' || g.grantee as droit
        from information_schema.role_table_grants g
        join pg_class c on c.relname = g.table_name
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
       where g.table_schema in ('facturation', 'plateforme') and c.relkind = 'r'
         and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
         and g.grantee in ('authenticated', 'anon', 'PUBLIC', 'portier', 'service_role')
       order by 1, 2`);
    const releve: Record<string, string[]> = {};
    for (const d of droits) (releve[d.nom] ??= []).push(d.droit);
    assert.deepEqual(releve, VERROU.ecritures_permises);
  });

  it("chaque table lue par une clé a un index qui mène par elle", async () => {
    const sansIndex: string[] = [];
    for (const [nom, t] of Object.entries(VERROU.tables)) {
      if (!t.cle) continue;
      const [schema, table] = nom.split(".");
      const r = await q<{ ok: boolean }>(
        `select exists (
           select 1 from pg_index i
             join pg_class c on c.oid = i.indrelid
             join pg_namespace n on n.oid = c.relnamespace
             join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
            where n.nspname = $1 and c.relname = $2 and a.attname = $3) as ok`,
        [schema, table, t.cle],
      );
      if (!r[0]?.ok) sansIndex.push(`${nom} (${t.cle})`);
    }
    assert.deepEqual(sansIndex, []);
  });

  it("une table en ajout seul refuse la réécriture par déclencheur", async () => {
    const declarees = Object.entries(VERROU.tables).filter(([, t]) => t.ajout_seul);
    const sans: string[] = [];
    for (const [nom] of declarees) {
      const [schema, table] = nom.split(".");
      const r = await q<{ ok: boolean }>(
        `select exists (
           select 1 from pg_trigger g
             join pg_class c on c.oid = g.tgrelid
             join pg_namespace n on n.oid = c.relnamespace
             join pg_proc p on p.oid = g.tgfoid
            where n.nspname = $1 and c.relname = $2 and p.proname = 'deny_mutation') as ok`,
        [schema, table],
      );
      if (!r[0]?.ok) sans.push(nom);
    }
    assert.deepEqual(sans, []);
  });

  it("les vues de la tour suivent la RLS de l'appelant et ne s'ouvrent qu'à la plateforme", async () => {
    const vues = await q<{ nom: string; invoker: boolean; plateforme: boolean }>(`
      select n.nspname || '.' || c.relname as nom,
             coalesce('security_invoker=true' = any (c.reloptions), false) as invoker,
             pg_get_viewdef(c.oid) ~ 'is_platform' as plateforme
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'plateforme' and c.relkind = 'v'
       order by 1`);
    const fautes = vues
      .filter((v) => !v.invoker || (!v.plateforme && !(v.nom in VERROU.vues_hors_tour)))
      .map((v) => v.nom);
    assert.deepEqual(fautes, []);
    const parties = Object.keys(VERROU.vues_hors_tour).filter(
      (n) => !vues.some((v) => v.nom === n),
    );
    assert.deepEqual(parties, []);
  });

  it("le compteur sans trou n'avance que d'un, et les internes du commerce restent internes", async () => {
    const compteur = await q<{ ok: boolean }>(
      `select exists (select 1 from pg_trigger
                       where tgrelid = 'facturation.compteurs_documents'::regclass
                         and tgname = 'compteur_avance_d_un') as ok`,
    );
    assert.equal(compteur[0]?.ok, true);
    const ouvertes = await q<{ f: string }>(
      `select f from unnest($1::text[]) f
        where has_function_privilege('authenticated', f::regprocedure, 'execute')
           or has_function_privilege('portier', f::regprocedure, 'execute')`,
      [VERROU.internes],
    );
    assert.deepEqual(
      ouvertes.map((o) => o.f),
      [],
    );
  });
});
