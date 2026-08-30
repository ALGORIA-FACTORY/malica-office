-- 010_immo_comptabilisation.sql
-- Comptes de dépréciation au référentiel (versionnés par pack, jamais en dur en TS).
alter table ref.immo_categories
  add column if not exists account_deprec text,
  add column if not exists account_deprec_dotation text,
  add column if not exists account_deprec_reprise text;

update ref.immo_categories
   set account_deprec = coalesce(account_deprec, '29' || substring(account_immo from 2)),
       account_deprec_dotation = coalesce(account_deprec_dotation, '6817'),
       account_deprec_reprise = coalesce(account_deprec_reprise, '7817')
 where account_deprec is null
    or account_deprec_dotation is null
    or account_deprec_reprise is null;

-- Dotation aux amortissements : écriture produite puis journal ajout-seul, en un seul geste.
create or replace function public.immo_dotation_constater(
  p_asset uuid,
  p_exercice smallint,
  p_months smallint,
  p_dotation numeric,
  p_cumul numeric,
  p_vnc numeric,
  p_pack_version uuid,
  p_date date default null,
  p_journal text default 'OD'
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_amort text;
  v_acc_dot text;
  v_date date;
  v_ecr uuid;
  v_dot uuid;
begin
  select a.tenant_id, a.entity_id, a.vis, a.devise, a.label,
         c.account_amort, c.account_dotation
    into v_tenant, v_entity, v_vis, v_devise, v_label, v_acc_amort, v_acc_dot
    from immo.assets a
    join ref.immo_categories c on c.id = a.category_id
   where a.id = p_asset;

  if v_tenant is null then
    raise exception 'immobilisation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if coalesce(p_dotation, 0) <= 0 then
    raise exception 'dotation nulle ou negative' using errcode = 'check_violation';
  end if;
  if exists (select 1 from immo.dotations d
              where d.asset_id = p_asset and d.exercice = p_exercice) then
    raise exception 'dotation deja constatee pour cet exercice' using errcode = 'unique_violation';
  end if;

  v_date := coalesce(p_date, make_date(p_exercice::int, 12, 31));

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, v_date, v_devise,
          'Dotation aux amortissements ' || p_exercice::text || ' — ' || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                     libelle, debit, credit)
  values (v_tenant, v_ecr, 1, v_acc_dot, 'Dotation — ' || v_label, p_dotation, 0),
         (v_tenant, v_ecr, 2, v_acc_amort, 'Amortissements — ' || v_label, 0, p_dotation);

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into immo.dotations (tenant_id, asset_id, exercice, months, dotation, cumul,
                              vnc, ecriture_id, pack_version_id, created_by)
  values (v_tenant, p_asset, p_exercice, p_months, p_dotation, p_cumul, p_vnc,
          v_ecr, p_pack_version, auth.uid())
  returning id into v_dot;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'immo.dotation_constatee', 'immo', 'dotations', v_dot,
          p_pack_version,
          jsonb_build_object('asset_id', p_asset, 'exercice', p_exercice,
                             'dotation', p_dotation, 'ecriture_id', v_ecr));

  return jsonb_build_object('dotation_id', v_dot, 'ecriture_id', v_ecr);
end $$;

-- Dépréciation ou reprise : mouvement > 0 = dépréciation, < 0 = reprise.
create or replace function public.immo_depreciation_constater(
  p_asset uuid,
  p_at date,
  p_vnc numeric,
  p_valeur_recouvrable numeric,
  p_mouvement numeric,
  p_cumul numeric,
  p_pack_version uuid,
  p_note text default null,
  p_journal text default 'OD'
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_devise text;
  v_label text;
  v_acc_deprec text;
  v_acc_dot text;
  v_acc_rep text;
  v_abs numeric;
  v_ecr uuid;
  v_dep uuid;
begin
  select a.tenant_id, a.entity_id, a.vis, a.devise, a.label,
         c.account_deprec, c.account_deprec_dotation, c.account_deprec_reprise
    into v_tenant, v_entity, v_vis, v_devise, v_label,
         v_acc_deprec, v_acc_dot, v_acc_rep
    from immo.assets a
    join ref.immo_categories c on c.id = a.category_id
   where a.id = p_asset;

  if v_tenant is null then
    raise exception 'immobilisation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if coalesce(p_mouvement, 0) = 0 then
    raise exception 'aucun mouvement a constater' using errcode = 'check_violation';
  end if;

  v_abs := abs(p_mouvement);

  insert into socle.ecritures (tenant_id, entity_id, vis, journal, date_ecriture,
                              devise, libelle, pack_version_id, status)
  values (v_tenant, v_entity, v_vis, p_journal, p_at, v_devise,
          case when p_mouvement > 0 then 'Dépréciation — ' else 'Reprise de dépréciation — ' end
            || v_label,
          p_pack_version, 'proposee')
  returning id into v_ecr;

  if p_mouvement > 0 then
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_dot, 'Dotation dépréciation — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_deprec, 'Dépréciation — ' || v_label, 0, v_abs);
  else
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit)
    values (v_tenant, v_ecr, 1, v_acc_deprec, 'Dépréciation — ' || v_label, v_abs, 0),
           (v_tenant, v_ecr, 2, v_acc_rep, 'Reprise dépréciation — ' || v_label, 0, v_abs);
  end if;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_ecr;

  insert into immo.depreciations (tenant_id, asset_id, at, vnc, valeur_recouvrable,
                                  mouvement, cumul, note, ecriture_id, created_by)
  values (v_tenant, p_asset, p_at, p_vnc, p_valeur_recouvrable, p_mouvement, p_cumul,
          p_note, v_ecr, auth.uid())
  returning id into v_dep;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'immo.depreciation_constatee', 'immo', 'depreciations',
          v_dep, p_pack_version,
          jsonb_build_object('asset_id', p_asset, 'at', p_at, 'mouvement', p_mouvement,
                             'ecriture_id', v_ecr, 'note', p_note));

  return jsonb_build_object('depreciation_id', v_dep, 'ecriture_id', v_ecr);
end $$;

grant execute on function public.immo_dotation_constater(uuid, smallint, smallint, numeric, numeric, numeric, uuid, date, text) to authenticated;
grant execute on function public.immo_depreciation_constater(uuid, date, numeric, numeric, numeric, numeric, uuid, text, text) to authenticated;
