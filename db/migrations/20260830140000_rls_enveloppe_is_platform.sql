-- L'enveloppe manquante : `app.is_platform()` évalué une fois, pas par ligne.
--
-- Le générateur produisait `or app.is_platform()` — un appel nu dans le `using`
-- d'une politique. PostgreSQL n'a alors aucune raison de le hisser : il
-- l'exécute pour CHAQUE ligne examinée, sur les 41 tables passées sous le
-- helper.
--
-- Mesuré sur malica_local, 97 000 citations, un locataire qui en possède
-- 1 000 :
--
--     Seq Scan on citations  (rows=1000, Rows Removed by Filter: 96000)
--     Buffers: shared hit=194436          <- pour une table de ~1 000 blocs
--     Execution Time: 337 ms
--
-- Les 193 000 buffers excédentaires ne sont pas la table : ce sont 96 000
-- appels de fonction. Enveloppé — `or (select app.is_platform())` — l'appel
-- devient un InitPlan, évalué une fois avant le parcours.
--
-- Ce que cette migration NE fait PAS : toucher aux 38 politiques écrites à la
-- main. Elle ne connaît que celles qu'elle sait avoir produites, reconnues à
-- deux traits conjoints — le nom que le helper impose, ET la présence de
-- `app.member_orgs()` dans l'expression. Le nom seul ne suffirait pas : les
-- tables `ref` ont des politiques homonymes dont l'expression est `true`.

-- --------------------------------------------------------------------------
-- 1. Le helper, corrigé et rendu rejouable.
--
-- Rejouable, parce qu'une correction du générateur qu'on ne peut pas appliquer
-- aux tables existantes ne corrige rien. `create policy` et `create trigger`
-- échouent si l'objet existe : on retire d'abord.
-- --------------------------------------------------------------------------
create or replace function app.enable_tenant_rls(
  p_schema text,
  p_table text,
  p_visibility boolean default false,
  p_append_only boolean default false
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  q         text := quote_ident(p_schema) || '.' || quote_ident(p_table);
  prefix    text := p_schema || '_' || p_table;
  read_expr text;
begin
  execute 'alter table ' || q || ' enable row level security';
  execute 'alter table ' || q || ' force row level security';

  execute 'revoke all on table ' || q || ' from public';
  execute 'revoke all on table ' || q || ' from anon';
  execute 'revoke all on table ' || q || ' from service_role';
  execute 'grant select, insert, update, delete on table ' || q || ' to authenticated';

  -- Ce que le helper a posé, le helper peut le reprendre. Rien d'autre n'est
  -- touché : ces quatre noms lui appartiennent.
  execute 'drop policy if exists ' || quote_ident(prefix || '_sel') || ' on ' || q;
  execute 'drop policy if exists ' || quote_ident(prefix || '_ins') || ' on ' || q;
  execute 'drop policy if exists ' || quote_ident(prefix || '_upd') || ' on ' || q;
  execute 'drop policy if exists ' || quote_ident(prefix || '_del') || ' on ' || q;
  execute 'drop trigger if exists ' || quote_ident(prefix || '_no_upd') || ' on ' || q;

  -- `(select app.is_platform())` : la parenthèse n'est pas cosmétique. Un appel
  -- nu est évalué par ligne ; une sous-requête sans corrélation devient un
  -- InitPlan, évalué une fois pour toute la requête.
  --
  -- `tenant_id in (select ...)` est déjà sous cette forme et donne un SubPlan
  -- haché — on n'y touche pas.
  if p_visibility then
    read_expr :=
      '(tenant_id in (select app.member_orgs())'
      || ' or (vis = ''partage''::app.vis_t and tenant_id in (select app.engaged_orgs()))'
      || ' or (select app.is_platform()))';
  else
    read_expr :=
      '(tenant_id in (select app.member_orgs())'
      || ' or tenant_id in (select app.engaged_orgs())'
      || ' or (select app.is_platform()))';
  end if;

  execute format(
    'create policy %I on %s for select to authenticated using (%s)',
    prefix || '_sel', q, read_expr);

  execute format(
    'create policy %I on %s for insert to authenticated with check (tenant_id in (select app.member_orgs()))',
    prefix || '_ins', q);

  if p_append_only then
    execute 'create trigger ' || quote_ident(prefix || '_no_upd')
      || ' before update or delete on ' || q
      || ' for each row execute function app.deny_mutation()';
  else
    execute format(
      'create policy %I on %s for update to authenticated using (tenant_id in (select app.member_orgs())) with check (tenant_id in (select app.member_orgs()))',
      prefix || '_upd', q);
    execute format(
      'create policy %I on %s for delete to authenticated using (tenant_id in (select app.member_orgs()))',
      prefix || '_del', q);
  end if;
end
$function$;

-- --------------------------------------------------------------------------
-- 2. Le rejeu.
--
-- Les deux drapeaux ne sont pas écrits ici : ils se DÉDUISENT de l'état actuel.
-- Une liste recopiée à la main divergerait du jour où quelqu'un passerait une
-- table de plus sous le helper sans penser à ce fichier.
--
--   visibilité  <- la politique de lecture mentionne 'partage'
--   ajout seul  <- aucune politique de mise à jour, et un déclencheur _no_upd
-- --------------------------------------------------------------------------
do $$
declare
  t record;
  n integer := 0;
begin
  for t in
    with generees as (
      select schemaname as s, tablename as tb, policyname as p, cmd, qual
        from pg_policies
       where policyname in (schemaname || '_' || tablename || '_sel',
                            schemaname || '_' || tablename || '_ins',
                            schemaname || '_' || tablename || '_upd',
                            schemaname || '_' || tablename || '_del')
         and coalesce(qual, with_check) like '%app.member_orgs()%'
    )
    select s, tb,
           bool_or(cmd = 'SELECT' and qual like '%partage%') as visibilite,
           not bool_or(cmd = 'UPDATE') as ajout_seul
      from generees
     group by s, tb
     order by s, tb
  loop
    perform app.enable_tenant_rls(t.s, t.tb, t.visibilite, t.ajout_seul);
    n := n + 1;
  end loop;

  raise notice '% tables rejouées sous le helper corrigé', n;

  if n < 40 then
    raise exception 'rejeu incomplet : % tables seulement, 41 attendues', n;
  end if;
end $$;
