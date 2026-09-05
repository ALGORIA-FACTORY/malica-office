-- ============================================================================
-- Les réglages du cabinet.
--
-- POURQUOI
--
-- Le cabinet décide de ses seuils : au-dessus de quelle confiance de lecture
-- un lot se valide d''un geste, en dessous de laquelle chaque pièce se revoit,
-- au-delà de quel montant une écriture demande deux signatures. Ces nombres
-- ne sont pas des constantes de code (R4) : ils sont à lui, ils changent, et
-- chaque changement laisse une trace.
--
-- Une ligne par cabinet. Elle n''existe pas tant que rien n''a été réglé : la
-- lecture rend alors les valeurs par défaut des colonnes — posées ICI, dans
-- le schéma, pas dans un écran.
-- ============================================================================

create table collab.reglages_cabinet (
  tenant_id                 uuid primary key references identity.organizations(id) on delete cascade,
  -- Au-dessus : le lot se valide d''un geste. Entre les deux : une à une.
  seuil_confiance_lot       numeric(3,2) not null default 0.90
                            check (seuil_confiance_lot between 0 and 1),
  seuil_confiance_revue     numeric(3,2) not null default 0.70
                            check (seuil_confiance_revue between 0 and 1),
  -- Au-delà de ce montant, une écriture demande une seconde signature. Nul : jamais.
  double_validation_au_dela numeric(18,3)
                            check (double_validation_au_dela is null or double_validation_au_dela >= 0),
  -- Regalica propose-t-elle d''elle-même dans le panneau ?
  propositions_proactives   boolean not null default true,
  updated_by                uuid not null default auth.uid(),
  updated_at                timestamptz not null default now(),
  check (seuil_confiance_revue <= seuil_confiance_lot)
);
create index reglages_cabinet_tenant_idx on collab.reglages_cabinet (tenant_id);

comment on table collab.reglages_cabinet is
  'Les seuils et préférences d''un cabinet. Une ligne par cabinet ; absente, les défauts du schéma valent.';

select app.enable_tenant_rls('collab', 'reglages_cabinet', false, false);

create or replace view public.reglages_cabinet_v with (security_invoker = true) as
select tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
       propositions_proactives, updated_by, updated_at
from collab.reglages_cabinet;
grant select on public.reglages_cabinet_v to authenticated;

-- ----------------------------------------------------------------------------
-- Lire : la ligne du cabinet, ou les défauts du schéma si rien n''a été réglé.
-- Les défauts sont lus dans le catalogue, pas recopiés : une seule vérité.
-- ----------------------------------------------------------------------------
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
           'regle', true)
    into v
    from collab.reglages_cabinet r where r.tenant_id = p_tenant;
  if v is not null then return v; end if;

  -- Les défauts, tels que le schéma les déclare.
  select jsonb_build_object(
           'seuilConfianceLot', (select column_default::numeric from information_schema.columns
                                  where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                    and column_name = 'seuil_confiance_lot'),
           'seuilConfianceRevue', (select column_default::numeric from information_schema.columns
                                    where table_schema = 'collab' and table_name = 'reglages_cabinet'
                                      and column_name = 'seuil_confiance_revue'),
           'doubleValidationAuDela', null,
           'propositionsProactives', true,
           'regle', false)
    into v;
  return v;
end $$;

revoke all on function public.cabinet_reglages_lire(uuid) from public, anon;
grant execute on function public.cabinet_reglages_lire(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Régler : une ligne posée ou reprise, et l''événement au journal d''audit.
-- ----------------------------------------------------------------------------
create or replace function public.cabinet_reglages_definir(
  p_tenant uuid,
  p_seuil_lot numeric,
  p_seuil_revue numeric,
  p_double_validation numeric,
  p_proactives boolean
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
    (tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela, propositions_proactives)
  values (p_tenant, p_seuil_lot, p_seuil_revue, p_double_validation, p_proactives)
  on conflict (tenant_id) do update
    set seuil_confiance_lot = excluded.seuil_confiance_lot,
        seuil_confiance_revue = excluded.seuil_confiance_revue,
        double_validation_au_dela = excluded.double_validation_au_dela,
        propositions_proactives = excluded.propositions_proactives,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.reglages', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('seuil_lot', p_seuil_lot, 'seuil_revue', p_seuil_revue,
                             'double_validation', p_double_validation, 'proactives', p_proactives));

  return public.cabinet_reglages_lire(p_tenant);
end $$;

revoke all on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean) to authenticated;
