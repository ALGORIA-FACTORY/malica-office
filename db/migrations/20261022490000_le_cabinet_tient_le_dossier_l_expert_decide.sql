-- Le cabinet tient le dossier, l'expert décide du calendrier, un mandat à la
-- fois (21 octobre 2026).
--
-- Campagne de validation du 21 octobre :
--   ANO-008 — l'expert mandaté ne pouvait créer ni compte bancaire, ni bien,
--     ni article de stock, ni ligne de relevé, ni mouvement : les politiques
--     d'insertion ne s'ouvraient qu'aux membres de la société. Les tables
--     filles (dotations, lettrages…) avaient déjà leur politique « cabinet ».
--   ANO-012 — un collaborateur posait ou retirait un report d'échéance pour
--     tout le cabinet, et un report pouvait AVANCER une échéance avant sa
--     date légale.
--   ANO-014 — une société pouvait avoir deux comptabilités mandatées actives.
-- REJEU (R11) : `drop policy if exists`, `create or replace`, `if not exists`.

begin;

-- Rattrapage de 20261022450000 ------------------------------------------------
-- Le journal d'un moyen de paiement n'est pas toujours un journal de
-- trésorerie : la traite s'inscrit en OD, et l'OD porte aussi des
-- reclassements (le timbre, 31 août 2026). Un règlement touche le compte de
-- trésorerie de son moyen ; une écriture rattrapée qui n'en touche aucun
-- redevient l'écriture de sa pièce. Celles qui portent un paiement ne
-- bougent pas : c'est la base qui les a nommées. La nature d'une écriture
-- inscrite est figée (R7) : le verrou se lève le temps de CETTE correction de
-- classement, qui ne touche ni montant, ni compte, ni date.
alter table socle.ecritures disable trigger ecritures_freeze_booked;
update socle.ecritures e
   set nature = 'piece'
 where e.nature = 'reglement' and e.paiement_id is null
   and not exists (
     select 1 from socle.ecriture_lignes l
      join public.ref_payment_means_v m
        on m.pack_version_id = e.pack_version_id and m.journal_code = e.journal
       and m.tresorerie_account is not null
      where l.ecriture_id = coalesce(e.reverses_id, e.id)
        and l.account_code like m.tresorerie_account || '%');
alter table socle.ecritures enable trigger ecritures_freeze_booked;

-- ANO-008 -------------------------------------------------------------------
-- Même forme que les politiques « cabinet » des tables filles : l'expert du
-- cabinet engagé sur la société, et une ligne partagée (le défaut de ces
-- tables), donc visible de la société comme du cabinet.

drop policy if exists banque_comptes_ins_cabinet on banque.comptes;
create policy banque_comptes_ins_cabinet on banque.comptes for insert to authenticated
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()));
drop policy if exists banque_comptes_upd_cabinet on banque.comptes;
create policy banque_comptes_upd_cabinet on banque.comptes for update to authenticated
  using (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()))
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists immo_assets_ins_cabinet on immo.assets;
create policy immo_assets_ins_cabinet on immo.assets for insert to authenticated
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()));
drop policy if exists immo_assets_upd_cabinet on immo.assets;
create policy immo_assets_upd_cabinet on immo.assets for update to authenticated
  using (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()))
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists stocks_items_ins_cabinet on stocks.items;
create policy stocks_items_ins_cabinet on stocks.items for insert to authenticated
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()));
drop policy if exists stocks_items_upd_cabinet on stocks.items;
create policy stocks_items_upd_cabinet on stocks.items for update to authenticated
  using (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()))
  with check (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists banque_releve_lignes_ins_cabinet on banque.releve_lignes;
create policy banque_releve_lignes_ins_cabinet on banque.releve_lignes for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

drop policy if exists stocks_mouvements_ins_cabinet on stocks.mouvements;
create policy stocks_mouvements_ins_cabinet on stocks.mouvements for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs_as_expert()));
drop policy if exists stocks_mouvements_upd_cabinet on stocks.mouvements;
create policy stocks_mouvements_upd_cabinet on stocks.mouvements for update to authenticated
  using (tenant_id in (select app.engaged_orgs_as_expert()))
  with check (tenant_id in (select app.engaged_orgs_as_expert()));

-- ANO-012 -------------------------------------------------------------------
-- Le calendrier du cabinet est une décision de l'expert. La table n'accepte
-- plus l'écriture d'un collaborateur, et les deux portes le refusent en clair.

drop policy if exists collab_reports_echeance_cabinet_ins on collab.reports_echeance_cabinet;
create policy collab_reports_echeance_cabinet_ins on collab.reports_echeance_cabinet
  for insert to authenticated
  with check (app.has_org_role(tenant_id, array['expert']));
drop policy if exists collab_reports_echeance_cabinet_upd on collab.reports_echeance_cabinet;
create policy collab_reports_echeance_cabinet_upd on collab.reports_echeance_cabinet
  for update to authenticated
  using (app.has_org_role(tenant_id, array['expert']))
  with check (app.has_org_role(tenant_id, array['expert']));
drop policy if exists collab_reports_echeance_cabinet_del on collab.reports_echeance_cabinet;
create policy collab_reports_echeance_cabinet_del on collab.reports_echeance_cabinet
  for delete to authenticated
  using (app.has_org_role(tenant_id, array['expert']));

create or replace function public.cabinet_report_poser(p_cabinet uuid, p_code text, p_periode text, p_date date, p_motif text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_juridiction text;
  v_id          uuid;
  v_legale      date;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul l''expert du cabinet reporte une échéance.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'la nouvelle date est requise' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'un report se motive' using errcode = 'check_violation';
  end if;
  if coalesce(p_periode, '') !~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-T[1-4])?$' then
    raise exception 'periode illisible : AAAA-MM, AAAA-Tn ou AAAA' using errcode = 'check_violation';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;
  if not (
    exists (select 1 from ref.fiscal_obligations o
             where o.jurisdiction = v_juridiction and o.code = p_code)
    or (p_code like 'CAB:%' and exists (
          select 1 from collab.obligations_propres p
           where p.tenant_id = p_cabinet and p.id::text = substr(p_code, 5)))
  ) then
    raise exception 'obligation inconnue de ce cabinet' using errcode = 'check_violation';
  end if;

  -- Un report REPOUSSE : il ne place jamais l'échéance avant sa date légale.
  select min(e.date_legale) into v_legale
    from schedule.echeances e
    join identity.engagements g on g.pme_org_id = e.tenant_id
   where g.cabinet_org_id = p_cabinet and g.status = 'actif'
     and e.kind = p_code and e.period = p_periode;
  if v_legale is not null and p_date < v_legale then
    raise exception 'Un report repousse l''échéance : le % est avant sa date légale, le %.',
      to_char(p_date, 'DD/MM/YYYY'), to_char(v_legale, 'DD/MM/YYYY')
      using errcode = 'check_violation', hint = 'report.avant_date_legale';
  end if;

  update collab.reports_echeance_cabinet
     set retire_le = now()
   where tenant_id = p_cabinet and obligation_code = p_code and periode = p_periode
     and retire_le is null;
  insert into collab.reports_echeance_cabinet
    (tenant_id, obligation_code, periode, nouvelle_date, motif, source)
  values (p_cabinet, p_code, p_periode, p_date, btrim(p_motif), nullif(btrim(p_source), ''))
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.report_echeance', 'collab', 'reports_echeance_cabinet', v_id,
          jsonb_build_object('code', p_code, 'periode', p_periode, 'date', p_date,
                             'motif', p_motif, 'source', p_source));
  return jsonb_build_object('id', v_id);
end
$function$;

create or replace function public.cabinet_report_retirer(p_cabinet uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul l''expert du cabinet retire un report.' using errcode = '42501';
  end if;
  update collab.reports_echeance_cabinet
     set retire_le = now()
   where id = p_id and tenant_id = p_cabinet and retire_le is null;
  if not found then
    raise exception 'report introuvable' using errcode = 'P0002';
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'cabinet.report_retire', 'collab', 'reports_echeance_cabinet', p_id,
          '{}'::jsonb);
  return jsonb_build_object('id', p_id);
end
$function$;

-- ANO-014 -------------------------------------------------------------------
-- Une société, une comptabilité mandatée à la fois : en accepter une seconde
-- se refuse en clair, quelle que soit la porte (réponse à un mandat, ou
-- activation directe que la politique laisse au dirigeant).

create or replace function app.un_mandat_actif_a_la_fois()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status = 'actif'
     and (tg_op = 'INSERT' or old.status is distinct from 'actif')
     and exists (select 1 from identity.engagements o
                  where o.pme_org_id = new.pme_org_id and o.status = 'actif'
                    and o.id <> new.id) then
    raise exception 'Votre société a déjà une comptabilité mandatée. Révoquez ce mandat avant d''en accepter un autre.'
      using errcode = 'check_violation', hint = 'mandat.deja_actif';
  end if;
  return new;
end $function$;

drop trigger if exists un_mandat_actif_a_la_fois on identity.engagements;
create trigger un_mandat_actif_a_la_fois
  before insert or update of status on identity.engagements
  for each row execute function app.un_mandat_actif_a_la_fois();

do $$
begin
  if exists (select 1 from identity.engagements where status = 'actif'
              group by pme_org_id having count(*) > 1) then
    raise warning 'engagements_un_actif_par_societe non posé : une société a déjà deux mandats actifs';
  else
    create unique index if not exists engagements_un_actif_par_societe
      on identity.engagements (pme_org_id) where status = 'actif';
  end if;
end $$;

commit;
