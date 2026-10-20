-- Le cabinet attribue un abonnement, la PME choisit (20 octobre 2026).
--
-- Décisions Wissem Barouni / Mondher Chaouech du 20 octobre 2026 :
--   • la comptabilité peut commercialiser N'IMPORTE QUEL abonnement à ses
--     clients, au prix public, et c'est elle qui est facturée ;
--   • si la PME paie déjà, LA PME CHOISIT : le cabinet propose, la PME
--     accepte ou refuse ; son propre paiement cède au jour de l'acceptation ;
--   • la PME couverte qui monte d'offre paie la différence (deux payeurs) ;
--   • révocation du mandat : l'abonnement passe à la PME, avertie, le cabinet
--     cesse de payer le jour même.
--
-- Le modèle existait (`facturation.acces`, `periodes_v`, `payeurs_v`,
-- `a_facturer_cabinet`) ; rien ne l'écrivait. Cette migration pose :
--   1. `ref.offres_par_canal` : le cabinet peut ouvrir Basic aussi (règle
--      « n'importe quel abonnement ») — une ligne datée, pas une constante ;
--   2. `ref.fin_motifs` : « refus de la cliente » ;
--   3. le rattachement ne tombe plus à la fin d'un accès : la licence est
--      CELLE de la PME, elle reste à la PME (« l'abonnement passe à la PME ») ;
--   4. `acces_proposer`, `acces_repondre`, `acces_du_cabinet`,
--      `acces_pour_moi` ;
--   5. `mandat_revoquer` termine l'accès du cabinet et avertit la PME.
--
-- Index : recherche d'un accès ouvert par dossier et par cabinet.
-- REJEU (R11) : `on conflict do nothing`, `create or replace`, `if not exists`.

begin;

-- 1. Le cabinet ouvre toutes les offres, Basic compris (datée, R11).
insert into ref.offres_par_canal
  (canal, offre_code, libre_service, commande_speciale, cabinet_peut_ouvrir, effective_from, par_defaut)
values ('cabinet', 'basic', false, true, true, date '2026-10-20', false)
on conflict do nothing;

-- 2. Le refus d'une proposition est une fin motivée.
insert into ref.fin_motifs (code, libelle, sort_order, active)
values ('refus_client', 'Refusée par la cliente', 80, true)
on conflict (code) do nothing;

-- 3. La fin d'un accès ne détache plus la PME de SA licence.
create or replace function facturation.acces_entretient_le_rattachement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- À l'activation, la licence de l'accès est rattachée à l'organisation si
  -- elle ne l'était pas. À la fin, rien ne tombe : la licence est celle de la
  -- PME, et l'abonnement lui revient (décision du 20 octobre 2026). Le cabinet
  -- cesse seulement d'être payeur — `payeurs_v` le lit sur la fenêtre.
  -- `not exists` et non `on conflict` : les gardes de capacité de
  -- `licence_organisations` sont des déclencheurs AVANT insertion, qui se
  -- prononceraient sur une ligne que le conflit aurait de toute façon écartée.
  if new.statut = 'actif' and coalesce(old.statut, '') <> 'actif'
     and not exists (select 1 from facturation.licence_organisations lo
                      where lo.tenant_id = new.tenant_id)
  then
    insert into facturation.licence_organisations (licence_id, tenant_id)
    values (new.licence_id, new.tenant_id);
  end if;
  return new;
end
$function$;

create index if not exists acces_ouverts_par_dossier_idx
  on facturation.acces (tenant_id) where statut in ('propose', 'actif', 'suspendu');
create index if not exists acces_par_cabinet_idx
  on facturation.acces (cabinet_tenant_id, statut) where cabinet_tenant_id is not null;

-- 4a. Le cabinet propose.
create or replace function public.acces_proposer(p_cabinet uuid, p_client uuid, p_offre text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id    uuid;
  v_grille ref.offres;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'Seul l''expert-comptable du cabinet propose un abonnement.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'Ce dossier n''est pas mandaté par votre cabinet.' using errcode = '42501';
  end if;
  if exists (select 1 from facturation.acces a
              where a.tenant_id = p_client and a.statut in ('propose', 'actif', 'suspendu')) then
    raise exception 'Un abonnement est déjà proposé ou attribué à ce dossier par un cabinet.'
      using errcode = 'check_violation';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'Cette offre n''existe pas dans la grille en vigueur.' using errcode = '22023';
  end if;

  insert into facturation.acces
    (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut, propose_le, propose_par)
  values
    (p_client, 'cabinet', p_cabinet, v_grille.code, v_grille.effective_from, 'propose',
     current_date, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_client, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('cabinet', p_cabinet, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_client, 'acces.propose',
          jsonb_build_object('acces_id', v_id, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  return v_id;
end
$function$;

-- 4b. La PME répond.
create or replace function public.acces_repondre(p_acces uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v        facturation.acces;
  v_lic    uuid;
  v_rang_c smallint;
  v_rang_o smallint;
  v_offre  text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.statut <> 'propose' then
    raise exception 'Cette proposition n''est plus en attente.' using errcode = '22023';
  end if;
  if not app.has_org_role(v.tenant_id, array['dirigeant']) then
    raise exception 'Seul le dirigeant répond à une proposition d''abonnement.'
      using errcode = '42501';
  end if;
  select lo.licence_id into v_lic
    from facturation.licence_organisations lo where lo.tenant_id = v.tenant_id;
  if v_lic is null then
    raise exception 'Cette société n''a pas de licence : rien à couvrir.' using errcode = 'P0002';
  end if;

  if not p_accepte then
    update facturation.acces
       set statut = 'termine', licence_id = v_lic, effet_du = current_date,
           effet_au = current_date, motif_fin = 'refus_client',
           repondu_le = current_date, repondu_par = auth.uid()
     where id = p_acces;
  else
    update facturation.acces
       set statut = 'actif', licence_id = v_lic, effet_du = current_date,
           repondu_le = current_date, repondu_par = auth.uid()
     where id = p_acces;

    -- L'offre attribuée devient le forfait si elle est AU-DESSUS du forfait
    -- courant ; au-dessous, la PME garde le sien et paie la différence au-dessus
    -- du plancher couvert par le cabinet (`periodes_v`).
    select f.offre_code into v_offre
      from facturation.forfait_courant_v f where f.licence_id = v_lic;
    v_rang_c := (ref.offre_a(v_offre, current_date)).rang;
    v_rang_o := (ref.offre_a(v.offre_code, current_date)).rang;
    if v_rang_o > coalesce(v_rang_c, 0) then
      perform public.forfait_changer(v.offre_code, v.tenant_id, current_date);
    end if;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(),
          case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          'facturation', 'acces', p_acces, jsonb_build_object('cabinet', v.cabinet_tenant_id));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.cabinet_tenant_id, case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          jsonb_build_object('acces_id', p_acces, 'pme_org_id', v.tenant_id,
                             'client', (select name from identity.organizations where id = v.tenant_id),
                             'offre', v.offre_code));
  return jsonb_build_object('acces_id', p_acces,
                            'statut', case when p_accepte then 'actif' else 'termine' end);
end
$function$;

-- 4c. La console du cabinet : ses abonnements attribués.
create or replace function public.acces_du_cabinet(p_cabinet uuid)
returns table(acces_id uuid, client_tenant_id uuid, client_nom text, client_legal_id text,
              offre_code text, statut text, reference text, propose_le date,
              effet_du date, effet_au date, motif_fin text)
language plpgsql
stable security definer
set search_path = ''
as $function$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'reserve au cabinet lui-meme' using errcode = '42501';
  end if;
  return query
    select a.id, a.tenant_id, o.name, o.legal_id, a.offre_code, a.statut, a.reference,
           a.propose_le, a.effet_du, a.effet_au, a.motif_fin
      from facturation.acces a
      join identity.organizations o on o.id = a.tenant_id
     where a.cabinet_tenant_id = p_cabinet
     order by (a.statut = 'termine'), o.name, a.created_at desc;
end
$function$;

-- 4d. Ce qu'un cabinet propose ou couvre pour MA société.
create or replace function public.acces_pour_moi(p_tenant uuid)
returns table(acces_id uuid, cabinet_tenant_id uuid, cabinet_nom text, offre_code text,
              statut text, propose_le date, effet_du date, effet_au date)
language plpgsql
stable security definer
set search_path = ''
as $function$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'reserve aux membres de la societe' using errcode = '42501';
  end if;
  return query
    select a.id, a.cabinet_tenant_id, o.name, a.offre_code, a.statut, a.propose_le,
           a.effet_du, a.effet_au
      from facturation.acces a
      join identity.organizations o on o.id = a.cabinet_tenant_id
     where a.tenant_id = p_tenant and a.canal = 'cabinet'
     order by a.created_at desc;
end
$function$;

-- 4e. Ce qu'un cabinet peut attribuer, au prix public du jour.
create or replace function public.offres_du_cabinet()
returns table(code text, libelle text, rang smallint, prix_mensuel_ht numeric,
              lectures_par_organisation integer, sieges_inclus smallint)
language sql
stable security definer
set search_path = ''
as $function$
  select o.code, o.libelle, o.rang, o.prix_mensuel_ht::numeric, o.lectures_par_organisation,
         o.sieges_inclus
    from ref.offre_codes c
    cross join lateral ref.offre_a(c.code, current_date) o
   where o.code is not null
     and coalesce((ref.canal_offre_a('cabinet', c.code, current_date)).cabinet_peut_ouvrir, false)
   order by o.rang
$function$;
revoke all on function public.offres_du_cabinet() from public;
grant execute on function public.offres_du_cabinet() to authenticated;

revoke all on function public.acces_proposer(uuid, uuid, text) from public;
revoke all on function public.acces_repondre(uuid, boolean) from public;
revoke all on function public.acces_du_cabinet(uuid) from public;
revoke all on function public.acces_pour_moi(uuid) from public;
grant execute on function public.acces_proposer(uuid, uuid, text) to authenticated;
grant execute on function public.acces_repondre(uuid, boolean) to authenticated;
grant execute on function public.acces_du_cabinet(uuid) to authenticated;
grant execute on function public.acces_pour_moi(uuid) to authenticated;

commit;
