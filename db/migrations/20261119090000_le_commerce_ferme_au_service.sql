-- ======================================================================
--  Le commerce fermé au service (moteur commercial, 1/9 — plan validé par le
--  dirigeant le 2 novembre 2026, annexe 2.0-6 et 2.1).
--
--  Deux écarts relevés sur la base, et non plus à la lecture :
--
--    * vingt tables de `facturation` et de `plateforme` avaient la RLS
--      ACTIVÉE mais pas FORCÉE (`reglages_*`, `grilles_publiees`, `recharges`,
--      `engagements_annuels`, `paiements_en_ligne`, `moyens_*`…). L'effet est
--      nul tant que leur propriétaire est superutilisateur ; c'est pourtant un
--      écart à R6 qu'une table nouvelle copierait ;
--    * la garde du relecteur de nuit (20261118100000) n'a été posée que sur
--      les tables qui portent un `tenant_id`. `factures`, `licences`,
--      `interventions`, `encaissements` n'en portent pas : seuls leurs
--      prédicats les protégeaient, et `app.member_orgs()` rend le dossier du
--      relecteur.
--
--  Ici, TOUTE table de `facturation` et de `plateforme` reçoit, si elle ne
--  l'a pas : `force row level security`, la politique restrictive
--  `service_hors_perimetre` (zéro ligne pour un compte de service) et le
--  déclencheur d'instruction `service_hors_perimetre` (écriture refusée). Les
--  tables nées après cette migration les posent elles-mêmes ; le verrou
--  `verrous/commerce.json` le vérifie table par table.
--
--  REJEU : idempotente (chaque objet est posé s'il manque).
-- ======================================================================

do $$
declare
  r record;
begin
  for r in
    select n.nspname as s, c.relname as t, c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('facturation', 'plateforme')
       and c.relkind = 'r'
  loop
    execute format('alter table %I.%I enable row level security', r.s, r.t);
    execute format('alter table %I.%I force row level security', r.s, r.t);
    if not exists (select 1 from pg_trigger g
                    where g.tgrelid = r.oid and g.tgname = 'service_hors_perimetre') then
      execute format(
        'create trigger service_hors_perimetre before insert or update or delete on %I.%I '
        'for each statement execute function app.service_hors_perimetre()', r.s, r.t);
    end if;
    if not exists (select 1 from pg_policy p
                    where p.polrelid = r.oid and p.polname = 'service_hors_perimetre') then
      execute format(
        'create policy service_hors_perimetre on %I.%I as restrictive for select '
        'to authenticated using ((select app.service()) is null)', r.s, r.t);
    end if;
  end loop;
end
$$;
