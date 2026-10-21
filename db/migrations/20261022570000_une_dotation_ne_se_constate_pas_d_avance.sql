-- Une dotation ne se constate pas dans un exercice futur (ANO-CAB-002, 21 octobre 2026).
--
-- Recette en direct : le 21/10/2026, « Constater » sur la ligne 2027 du plan
-- d'amortissement inscrivait une écriture 6811/2882 datée du 31/12/2027,
-- comptabilisée, et figeait la ligne. L'exercice n'est pas ouvert : la
-- dotation se constate quand il l'est, et sa date tombe dans l'exercice.
-- Corps repris de la base vivante ; seules les deux gardes s'ajoutent.
-- REJEU (R11) : `create or replace`.

begin;
CREATE OR REPLACE FUNCTION public.immo_dotation_constater(p_asset uuid, p_exercice smallint, p_months smallint, p_dotation numeric, p_cumul numeric, p_vnc numeric, p_pack_version uuid, p_date date DEFAULT NULL::date, p_journal text DEFAULT 'OD'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  if p_exercice > extract(year from current_date)::int then
    raise exception 'L''exercice % n''est pas encore ouvert : sa dotation se constate à partir du 1er janvier %.', p_exercice, p_exercice
      using errcode = '22023', hint = 'immo.exercice_futur';
  end if;
  if p_date is not null and extract(year from p_date)::int <> p_exercice then
    raise exception 'La date de la dotation doit tomber dans l''exercice %.', p_exercice
      using errcode = '22023', hint = 'immo.date_hors_exercice';
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
end $function$;

commit;
