/**
 * Trois garde-fous sur le SCHÉMA, pas sur les fichiers.
 *
 * La différence est tout le sujet. Relire les migrations dit ce qu'on a voulu ;
 * interroger `pg_index` et `pg_policies` dit ce qui est. Entre les deux il y a
 * une migration qui a échoué au milieu, une main qui a corrigé en direct, un
 * fichier ajouté sans être joué. C'est la base qui fait foi.
 *
 * Ces vérifications sont rédigées pour ÉCHOUER de façon lisible : elles nomment
 * la table, la politique ou le compte, pour qu'un rouge se répare sans enquête.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { fermerLePool, horsRlsAuthentificationSeule } from "./db.ts";

const BASE_CONFIGUREE = Boolean(process.env["DATABASE_URL"] && process.env["JWT_SECRET"]);

async function interroger<T extends Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return horsRlsAuthentificationSeule(async (db) => {
    const { rows } = await db.query<T>(sql, args);
    return rows;
  });
}

describe("le schéma tient ses promesses", { skip: !BASE_CONFIGUREE }, () => {
  after(async () => {
    await fermerLePool();
  });

  /**
   * (a) Toute table passée sous `app.enable_tenant_rls` a un index dont la
   * PREMIÈRE colonne est `tenant_id`.
   *
   * Pourquoi la première : un index sur (piece_id, tenant_id) ne sert pas le
   * prédicat de la politique, qui ne connaît que le tenant. La position compte
   * autant que la présence.
   *
   * Les tables sont reconnues à leurs politiques, pas à une liste : une table
   * ajoutée demain sous le helper est couverte sans que ce fichier bouge.
   */
  it("chaque table sous RLS de tenant a un index menant par tenant_id", async () => {
    const manquantes = await interroger<{ table_: string }>(`
      with sous_helper as (
        select distinct schemaname as s, tablename as t
          from pg_policies
         where policyname in (schemaname || '_' || tablename || '_sel',
                              schemaname || '_' || tablename || '_ins')
           and coalesce(qual, with_check) like '%app.member_orgs()%'
      )
      select h.s || '.' || h.t as table_
        from sous_helper h
        join pg_class c on c.relname = h.t
         and c.relnamespace::regnamespace::text = h.s
       where exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0)
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.oid
              and (select attname from pg_attribute
                    where attrelid = c.oid and attnum = i.indkey[0]) = 'tenant_id')
       order by 1`);

    assert.deepEqual(
      manquantes.map((r) => r.table_),
      [],
      "ces tables filtrent par tenant_id à chaque lecture sans index pour le servir",
    );
  });

  /**
   * (b) Aucune politique ne contient un appel de fonction nu.
   *
   * `app.is_platform()` dans un `using` est évalué PAR LIGNE. Enveloppé en
   * `(select app.is_platform())`, il devient un InitPlan évalué une fois. Sur
   * 97 000 lignes, la différence mesurée était de 194 436 buffers à 2 438.
   *
   * PostgreSQL rend les expressions sous la forme `( SELECT app.f() AS f)` :
   * l'enveloppe se reconnaît donc à un `select` qui précède immédiatement
   * l'appel.
   */
  it("aucune politique n'appelle une fonction sans l'envelopper", async () => {
    const nus = await interroger<{ tbl: string; policyname: string; expr: string }>(`
      select schemaname || '.' || tablename as tbl, policyname,
             coalesce(qual, '') || ' | ' || coalesce(with_check, '') as expr
        from pg_policies
       where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(?<!select )app\\.\\w+\\(\\)'
       order by 1, 2`);

    assert.deepEqual(
      nus.map((r) => `${r.tbl} → ${r.policyname}`),
      [],
      "un appel nu dans une politique est réévalué à chaque ligne examinée",
    );
  });

  /**
   * (c) Un compte ne sert qu'à une chose.
   *
   * L'énoncé d'origine parlait d'« un seul libellé par pack ». Les données ne
   * disent pas cela : `ref.accounts` n'a aucun doublon de code, et ce test
   * aurait été vert dès l'écriture — donc sans valeur.
   *
   * Le défaut réel est ailleurs, et il est pire : le compte 4367 « Etat - TVA
   * collectee » est à la fois le compte de TVA des cinq codes de vente
   * (`ref.account_mappings.vat_account`) ET le compte d'imputation du droit de
   * timbre (`ref.fiscal_charges.account_code`). Les deux se mélangent dans la
   * même balance, et la déclaration de TVA sort fausse.
   *
   * C'est donc ce conflit-là que ce test interdit. Écrit avant le correctif, il
   * échoue sur 4367 — c'est la seule preuve qu'il fonctionne.
   */
  it("aucun compte n'est à la fois compte de TVA et compte de charge fiscale", async () => {
    const conflits = await interroger<{ compte: string; libelle: string; usages: string }>(`
      select a.account_code as compte,
             a.label as libelle,
             'TVA de ' || (select string_agg(distinct m.document_kind || '/' || m.tax_code, ', ')
                             from ref.account_mappings m
                            where m.vat_account = a.account_code
                              and m.pack_version_id = a.pack_version_id)
             || '  ET  charge ' || (select string_agg(distinct f.code || '/' || f.document_kind, ', ')
                             from ref.fiscal_charges f
                            where f.account_code = a.account_code
                              and f.pack_version_id = a.pack_version_id) as usages
        from ref.accounts a
       where exists (select 1 from ref.account_mappings m
                      where m.vat_account = a.account_code
                        and m.pack_version_id = a.pack_version_id)
         and exists (select 1 from ref.fiscal_charges f
                      where f.account_code = a.account_code
                        and f.pack_version_id = a.pack_version_id)
       order by 1`);

    assert.deepEqual(
      conflits.map((c) => `${c.compte} « ${c.libelle} » — ${c.usages}`),
      [],
      "un compte qui porte deux natures rend toute déclaration bâtie dessus fausse",
    );
  });
});
