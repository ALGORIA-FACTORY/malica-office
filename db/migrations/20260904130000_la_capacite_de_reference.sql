-- ============================================================================
-- La capacité de référence d''un collaborateur.
--
-- Le pilotage compare la charge de chacun à une capacité — « 8 dossiers
-- actifs » dans la maquette. Ce nombre appartient au cabinet : un cabinet
-- de trois personnes et un de trente ne se pilotent pas avec la même jauge.
-- Il rejoint les réglages ; les deux fonctions de lecture et d''écriture le
-- portent désormais.
-- ============================================================================

alter table collab.reglages_cabinet
  add column if not exists capacite_dossiers_par_collaborateur integer not null default 8
    check (capacite_dossiers_par_collaborateur > 0);

-- Une vue existante n''accepte qu''une colonne AJOUTÉE EN FIN de liste.
create or replace view public.reglages_cabinet_v with (security_invoker = true) as
select tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
       propositions_proactives, updated_by, updated_at, capacite_dossiers_par_collaborateur
from collab.reglages_cabinet;
grant select on public.reglages_cabinet_v to authenticated;

create or replace function public.cabinet_reglages_lire(p_tenant uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'seuilConfianceLot', r.seuil_confiance_lot,
           'seuilConfianceRevue', r.seuil_confiance_revue,
           'doubleValidationAuDela', r.double_validation_au_dela,
           'propositionsProactives', r.propositions_proactives,
           'capaciteDossiers', r.capacite_dossiers_par_collaborateur,
           'regle', true)
    into v
    from collab.reglages_cabinet r where r.tenant_id = p_tenant;
  if v is not null then return v; end if;

  select jsonb_build_object(
           'seuilConfianceLot', (select column_default::numeric from information_schema.columns
                                  where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                    and column_name = 'seuil_confiance_lot'),
           'seuilConfianceRevue', (select column_default::numeric from information_schema.columns
                                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                      and column_name = 'seuil_confiance_revue'),
           'doubleValidationAuDela', null,
           'propositionsProactives', true,
           'capaciteDossiers', (select column_default::integer from information_schema.columns
                                 where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                   and column_name = 'capacite_dossiers_par_collaborateur'),
           'regle', false)
    into v;
  return v;
end $$;

drop function if exists public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean);

create or replace function public.cabinet_reglages_definir(
  p_tenant uuid,
  p_seuil_lot numeric,
  p_seuil_revue numeric,
  p_double_validation numeric,
  p_proactives boolean,
  p_capacite integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into collab.reglages_cabinet
    (tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
     propositions_proactives, capacite_dossiers_par_collaborateur)
  values (p_tenant, p_seuil_lot, p_seuil_revue, p_double_validation, p_proactives, p_capacite)
  on conflict (tenant_id) do update
    set seuil_confiance_lot = excluded.seuil_confiance_lot,
        seuil_confiance_revue = excluded.seuil_confiance_revue,
        double_validation_au_dela = excluded.double_validation_au_dela,
        propositions_proactives = excluded.propositions_proactives,
        capacite_dossiers_par_collaborateur = excluded.capacite_dossiers_par_collaborateur,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.reglages', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('seuil_lot', p_seuil_lot, 'seuil_revue', p_seuil_revue,
                             'double_validation', p_double_validation, 'proactives', p_proactives,
                             'capacite', p_capacite));

  return public.cabinet_reglages_lire(p_tenant);
end $$;

revoke all on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer) from public, anon;
grant execute on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer) to authenticated;
