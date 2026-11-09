-- La page Clients unique de la comptabilité (8 novembre 2026).
--
-- Décisions du dirigeant d'ALGORIA, prises sur la maquette :
--   1. Quand la comptabilité paie, elle donne les places sans demander ; sinon
--      elle suggère, et le propriétaire décide.
--   2. Elle monte l'offre librement, le dirigeant est seulement prévenu ; une
--      descente attend l'accord du dirigeant.
--   3. Quand elle arrête de payer, l'abonnement revient au dirigeant, prévenu
--      le jour même.
--   4. (Règle A2) Un dossier ouvert par la comptabilité est actif, et rien
--      n'est facturé tant que le dirigeant n'a pas rejoint. Quand il rejoint
--      par son invitation, l'offre que la comptabilité avait choisie démarre
--      d'elle-même : c'est elle qui paie, il n'a rien à accepter.
--   5. Les sociétés d'un même dirigeant se regroupent sous sa licence, dans la
--      limite des sociétés que son offre inclut : jamais de supplément imposé.
--
-- Tout passe par des portes `security definer` qui vérifient le rôle (R5) ;
-- un refus remonte en clé (`refus.…`), traduite à l'écran.

-- ------------------------------------------------------------------ motifs

insert into ref.fin_motifs (code, libelle, sort_order) values
  ('changement_offre', 'Changement d''offre par la comptabilité', 15)
on conflict (code) do nothing;

-- Une proposition retirée ou remplacée avant l'arrivée du dirigeant n'a
-- jamais eu de licence (A2) : « terminé » n'exige plus de licence, seuls
-- l'actif et le suspendu en portent une.
alter table facturation.acces drop constraint if exists acces_propose_sans_licence;
alter table facturation.acces add constraint acces_propose_sans_licence
  check (statut <> 'propose' or licence_id is null);
alter table facturation.acces drop constraint if exists acces_vivant_avec_licence;
alter table facturation.acces add constraint acces_vivant_avec_licence
  check (statut not in ('actif', 'suspendu') or licence_id is not null);

-- -------------------------------------------- les descentes en attente

create table if not exists facturation.acces_descentes (
  id           uuid primary key default gen_random_uuid(),
  acces_id     uuid not null references facturation.acces(id) on delete restrict,
  tenant_id    uuid not null references identity.organizations(id) on delete restrict,
  offre_code   text not null references ref.offre_codes(code) on delete restrict,
  statut       text not null default 'propose'
               check (statut in ('propose', 'acceptee', 'refusee', 'retiree')),
  propose_le   date not null default current_date,
  propose_par  uuid not null,
  repondu_le   date,
  repondu_par  uuid,
  created_at   timestamptz not null default now(),
  constraint acces_descentes_reponse check ((statut = 'propose') = (repondu_le is null))
);

comment on table facturation.acces_descentes is
  'Une descente d''offre demandée par la comptabilité qui paie : elle attend '
  'l''accord du dirigeant. Une montée, elle, s''applique sur-le-champ.';

create unique index if not exists acces_descentes_une_ouverte
  on facturation.acces_descentes (tenant_id) where statut = 'propose';
create index if not exists acces_descentes_acces_idx
  on facturation.acces_descentes (acces_id);
create index if not exists acces_descentes_offre_idx
  on facturation.acces_descentes (offre_code);

alter table facturation.acces_descentes enable row level security;
alter table facturation.acces_descentes force row level security;

drop policy if exists acces_descentes_lire on facturation.acces_descentes;
create policy acces_descentes_lire on facturation.acces_descentes
  for select using (
    app.has_org_role(tenant_id, array['dirigeant'])
    or exists (select 1 from facturation.acces a
                where a.id = acces_id
                  and app.has_org_role(a.cabinet_tenant_id, array['expert']))
  );

grant select on facturation.acces_descentes to authenticated;

-- Le relecteur de nuit (compte de service) n'y écrit ni n'y lit : une
-- descente d'offre n'est pas une pièce (`20261118100000_le_relecteur_de_nuit`).
drop trigger if exists service_hors_perimetre on facturation.acces_descentes;
create trigger service_hors_perimetre before insert or update or delete on facturation.acces_descentes
  for each statement execute function app.service_hors_perimetre();
drop policy if exists service_hors_perimetre on facturation.acces_descentes;
create policy service_hors_perimetre on facturation.acces_descentes as restrictive for select
  to authenticated using ((select app.service()) is null);

drop trigger if exists acces_descentes_pas_de_suppression on facturation.acces_descentes;
create trigger acces_descentes_pas_de_suppression
  before delete on facturation.acces_descentes
  for each row execute function app.deny_mutation();

-- ------------------------------------------------- outils internes

-- Le forfait de la licence passe à une offre, décidé par quelqu'un d'autre
-- que le titulaire (la comptabilité qui paie). Même écriture que
-- `forfait_changer`, sans l'exiger du titulaire.
create or replace function facturation.forfait_poser(p_licence uuid, p_offre text, p_le date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courant record;
  v_rang_c  smallint;
  v_rang_o  smallint;
begin
  select f.offre_code, f.canal into v_courant
    from facturation.forfait_courant_v f where f.licence_id = p_licence;
  if v_courant.offre_code = p_offre then
    return;
  end if;
  v_rang_c := (ref.offre_a(v_courant.offre_code, p_le)).rang;
  v_rang_o := (ref.offre_a(p_offre, p_le)).rang;
  update facturation.forfait_historique
     set effet_au = p_le
   where licence_id = p_licence and effet_au is null;
  insert into facturation.forfait_historique
    (licence_id, offre_code, offre_depuis, canal, effet_du, motif, decide_par)
  values
    (p_licence, p_offre, p_le, v_courant.canal, p_le,
     case when v_rang_o > coalesce(v_rang_c, 0) then 'montee' else 'descente' end,
     auth.uid());
end
$$;

revoke all on function facturation.forfait_poser(uuid, text, date) from public;

-- L'accès en cours passe à une autre offre : il se ferme aujourd'hui et un
-- nouveau s'ouvre aujourd'hui (R7 : rien ne se réécrit). Rend le nouvel id.
create or replace function facturation.acces_relayer(p_acces uuid, p_offre text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      facturation.acces;
  v_grille ref.offres;
  v_id   uuid;
begin
  select * into v from facturation.acces where id = p_acces for update;
  v_grille := ref.offre_a(p_offre, current_date);
  update facturation.acces
     set statut = 'termine', effet_au = current_date, motif_fin = 'changement_offre'
   where id = p_acces;
  insert into facturation.acces
    (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
     propose_le, propose_par, repondu_le, repondu_par, effet_du)
  values
    (v.tenant_id, v.licence_id, 'cabinet', v.cabinet_tenant_id, v_grille.code,
     v_grille.effective_from, 'actif', current_date, auth.uid(), current_date, auth.uid(),
     current_date)
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function facturation.acces_relayer(uuid, text) from public;

-- Ce qui empêcherait le forfait de descendre (sociétés, places en trop) ;
-- la prise en charge elle-même n'en est pas un empêchement ici.
create or replace function facturation.descente_possible(p_licence uuid, p_offre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cible ref.offres;
  v_usage record;
begin
  v_cible := ref.offre_a(p_offre, current_date);
  select co.sieges_occupes, co.organisations into v_usage
    from facturation.consommation_v co where co.licence_id = p_licence;
  if coalesce(v_usage.sieges_occupes, 0) > v_cible.sieges_max then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', 'sieges_occupes',
      'chiffres', jsonb_build_object('occupes', v_usage.sieges_occupes, 'max', v_cible.sieges_max)::text)
      using errcode = 'check_violation';
  end if;
  if coalesce(v_usage.organisations, 0) > v_cible.organisations_incluses then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', 'organisations',
      'chiffres', jsonb_build_object('ouvertes', v_usage.organisations,
                                     'max', v_cible.organisations_incluses)::text)
      using errcode = 'check_violation';
  end if;
end
$$;

revoke all on function facturation.descente_possible(uuid, text) from public;

-- ---------------------------------------------- changer l'offre

create or replace function public.acces_changer_offre(p_acces uuid, p_offre text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        facturation.acces;
  v_grille ref.offres;
  v_regle  ref.offres_par_canal;
  v_id     uuid;
  v_rang_a smallint;
  v_rang_o smallint;
  v_forfait text;
  v_nom    text;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  v_regle := ref.canal_offre_a('cabinet', v_grille.code, current_date);
  if v_regle.canal is null or not v_regle.cabinet_peut_ouvrir then
    raise exception '%', app.refus_avec_valeurs('refus.offre.pas_par_un_cabinet', 'offre', v_grille.code)
      using errcode = 'check_violation';
  end if;
  if v_grille.code = v.offre_code then
    return jsonb_build_object('acces_id', v.id, 'effet', 'inchange');
  end if;
  v_nom := (select name from identity.organizations where id = v.cabinet_tenant_id);

  -- Le dirigeant n'a pas encore rejoint (A2) : la proposition change, rien ne se facture.
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'changement_offre', licence_id = null
     where id = v.id;
    insert into facturation.acces
      (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
       propose_le, propose_par)
    values
      (v.tenant_id, 'cabinet', v.cabinet_tenant_id, v_grille.code, v_grille.effective_from,
       'propose', current_date, auth.uid())
    returning id into v_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.cabinet_tenant_id, auth.uid(), 'acces.offre_changee', 'facturation', 'acces', v_id,
            jsonb_build_object('client', v.tenant_id, 'avant', v.offre_code, 'offre', v_grille.code));
    return jsonb_build_object('acces_id', v_id, 'effet', 'proposition');
  end if;

  v_rang_a := (ref.offre_a(v.offre_code, current_date)).rang;
  v_rang_o := v_grille.rang;

  if v_rang_o > v_rang_a then
    -- Montée : sur-le-champ, le dirigeant est prévenu.
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where tenant_id = v.tenant_id and statut = 'propose';
    v_id := facturation.acces_relayer(v.id, v_grille.code);
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_rang_o > coalesce((ref.offre_a(v_forfait, current_date)).rang, 0) then
      perform facturation.forfait_poser(v.licence_id, v_grille.code, current_date);
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'acces.monte', 'facturation', 'acces', v_id,
            jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                               'offre', v_grille.code));
    insert into collab.notifications (tenant_id, kind, payload)
    values (v.tenant_id, 'acces.monte',
            jsonb_build_object('acces_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
    return jsonb_build_object('acces_id', v_id, 'effet', 'immediat');
  end if;

  -- Descente : elle attend l'accord du dirigeant. Elle doit tenir dans ce
  -- que la société utilise déjà (sociétés, places), si le forfait la suit.
  select f.offre_code into v_forfait
    from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
  if v_forfait = v.offre_code then
    perform facturation.descente_possible(v.licence_id, v_grille.code);
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  insert into facturation.acces_descentes (acces_id, tenant_id, offre_code, propose_par)
  values (v.id, v.tenant_id, v_grille.code, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.descente_demandee', 'facturation', 'acces_descentes', v_id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'avant', v.offre_code,
                             'offre', v_grille.code));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.tenant_id, 'acces.descente_demandee',
          jsonb_build_object('descente_id', v_id, 'offre', v_grille.code, 'cabinet', v_nom));
  return jsonb_build_object('acces_id', v.id, 'descente_id', v_id, 'effet', 'accord_attendu');
end
$$;

revoke all on function public.acces_changer_offre(uuid, text) from public;
grant execute on function public.acces_changer_offre(uuid, text) to authenticated;

-- ------------------------------------- le dirigeant répond à une descente

create or replace function public.acces_descente_repondre(p_descente uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d        facturation.acces_descentes;
  v        facturation.acces;
  v_id     uuid;
  v_forfait text;
begin
  select * into d from facturation.acces_descentes where id = p_descente for update;
  if d.id is null or d.statut <> 'propose' then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  if not app.has_org_role(d.tenant_id, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant' using errcode = '42501';
  end if;
  select * into v from facturation.acces where id = d.acces_id for update;
  if v.statut <> 'actif' then
    update facturation.acces_descentes
       set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
     where id = d.id;
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  update facturation.acces_descentes
     set statut = case when p_accepte then 'acceptee' else 'refusee' end,
         repondu_le = current_date, repondu_par = auth.uid()
   where id = d.id;
  if p_accepte then
    v_id := facturation.acces_relayer(v.id, d.offre_code);
    -- Le forfait suit la comptabilité, sauf si le dirigeant avait monté à sa charge.
    select f.offre_code into v_forfait
      from facturation.forfait_courant_v f where f.licence_id = v.licence_id;
    if v_forfait = v.offre_code then
      perform facturation.descente_possible(v.licence_id, d.offre_code);
      perform facturation.forfait_poser(v.licence_id, d.offre_code, current_date);
    end if;
  end if;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (d.tenant_id, auth.uid(),
          case when p_accepte then 'acces.descente_acceptee' else 'acces.descente_refusee' end,
          'facturation', 'acces_descentes', d.id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'offre', d.offre_code));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.cabinet_tenant_id,
          case when p_accepte then 'acces.descente_acceptee' else 'acces.descente_refusee' end,
          jsonb_build_object('pme_org_id', d.tenant_id, 'offre', d.offre_code,
                             'client', (select name from identity.organizations where id = d.tenant_id)));
  return jsonb_build_object('descente_id', d.id,
                            'statut', case when p_accepte then 'acceptee' else 'refusee' end);
end
$$;

revoke all on function public.acces_descente_repondre(uuid, boolean) from public;
grant execute on function public.acces_descente_repondre(uuid, boolean) to authenticated;

-- Ce que le dirigeant a à trancher : la descente ouverte de sa société.
create or replace function public.acces_descente_pour_moi(p_tenant uuid)
returns table (descente_id uuid, offre_code text, comptabilite text, propose_le date)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.offre_code, o.name, d.propose_le
    from facturation.acces_descentes d
    join facturation.acces a on a.id = d.acces_id
    join identity.organizations o on o.id = a.cabinet_tenant_id
   where d.tenant_id = p_tenant and d.statut = 'propose'
     and app.has_org_role(p_tenant, array['dirigeant'])
$$;

revoke all on function public.acces_descente_pour_moi(uuid) from public;
grant execute on function public.acces_descente_pour_moi(uuid) to authenticated;

-- ---------------------------------------------- arrêter de payer

create or replace function public.acces_arreter(p_acces uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v facturation.acces;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.canal <> 'cabinet'
     or not app.has_org_role(v.cabinet_tenant_id, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v.statut not in ('propose', 'actif', 'suspendu') then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  update facturation.acces_descentes
     set statut = 'retiree', repondu_le = current_date, repondu_par = auth.uid()
   where tenant_id = v.tenant_id and statut = 'propose';
  if v.statut = 'propose' then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'retrait_cabinet'
     where id = v.id;
    return jsonb_build_object('acces_id', v.id, 'effet', 'retiree');
  end if;
  update facturation.acces
     set statut = 'termine', effet_au = current_date, motif_fin = 'retrait_cabinet'
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'acces.arrete', 'facturation', 'acces', v.id,
          jsonb_build_object('cabinet', v.cabinet_tenant_id, 'offre', v.offre_code));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.tenant_id, 'acces.arrete',
          jsonb_build_object('acces_id', v.id, 'offre', v.offre_code,
                             'cabinet', (select name from identity.organizations where id = v.cabinet_tenant_id)));
  return jsonb_build_object('acces_id', v.id, 'effet', 'rendu_au_dirigeant');
end
$$;

revoke all on function public.acces_arreter(uuid) from public;
grant execute on function public.acces_arreter(uuid) to authenticated;

-- ---------------------------------------------- modifier le dossier

create or replace function public.cabinet_modifier_dossier(
  p_cabinet uuid, p_pme uuid, p_nom text, p_legal_id text, p_adresse text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom     text := nullif(trim(coalesce(p_nom, '')), '');
  v_mf      text := upper(nullif(trim(coalesce(p_legal_id, '')), ''));
  v_adresse text := nullif(trim(coalesce(p_adresse, '')), '');
  v_org     record;
  v_refus   text;
begin
  if not app.has_org_role(p_cabinet, array['expert'])
     or not exists (select 1 from identity.engagements e
                     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_pme
                       and e.status = 'actif') then
    raise exception 'refus.reserve.expert_mandate' using errcode = '42501';
  end if;
  select id, name, legal_id, jurisdiction, adresse into v_org
    from identity.organizations where id = p_pme and archived_at is null;
  if v_org.id is null then
    raise exception 'refus.reserve.expert_mandate' using errcode = '42501';
  end if;
  if v_nom is null then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023';
  end if;
  if v_mf is null then
    raise exception 'refus.dossier.matricule_requis' using errcode = '22023';
  end if;
  if v_mf is distinct from upper(coalesce(v_org.legal_id, '')) then
    -- Le matricule se fige à la première pièce reçue.
    if exists (select 1 from public.pieces_v p where p.tenant_id = p_pme) then
      raise exception 'refus.dossier.matricule_fige' using errcode = '22023';
    end if;
    v_refus := public.identifiant_verifier(v_org.jurisdiction, 'matricule_fiscal', v_mf);
    if v_refus is not null then
      raise exception '%', v_refus using errcode = '22023';
    end if;
    if exists (select 1 from identity.organizations o
                where o.archived_at is null and o.id <> p_pme
                  and upper(trim(o.legal_id)) = v_mf) then
      raise exception 'refus.dossier.matricule_existant' using errcode = '23505';
    end if;
  end if;
  update identity.organizations
     set name = v_nom, legal_id = v_mf, adresse = v_adresse
   where id = p_pme;
  update identity.entities set name = v_nom
   where tenant_id = p_pme and is_default and name = v_org.name;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_pme, auth.uid(), 'dossier.modifie', 'identity', 'organizations', p_pme,
          jsonb_build_object('cabinet', p_cabinet,
                             'avant', jsonb_build_object('nom', v_org.name, 'legalId', v_org.legal_id,
                                                         'adresse', v_org.adresse),
                             'apres', jsonb_build_object('nom', v_nom, 'legalId', v_mf,
                                                         'adresse', v_adresse)));
  return jsonb_build_object('id', p_pme, 'name', v_nom, 'legalId', v_mf, 'adresse', v_adresse);
end
$$;

revoke all on function public.cabinet_modifier_dossier(uuid, uuid, text, text, text) from public;
grant execute on function public.cabinet_modifier_dossier(uuid, uuid, text, text, text) to authenticated;

-- ------------------------------------------- une place pour le client

create or replace function public.cabinet_place_pour_le_client(
  p_cabinet uuid, p_pme uuid, p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_paye  boolean;
  v_lic   uuid;
  v_max   smallint;
  v_inclus smallint;
begin
  if not app.has_org_role(p_cabinet, array['expert'])
     or not exists (select 1 from identity.engagements e
                     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_pme
                       and e.status = 'actif') then
    raise exception 'refus.reserve.expert_mandate' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'refus.invitation.adresse' using errcode = '22023';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_pme and m.role = 'dirigeant') then
    raise exception 'refus.dossier.dirigeant_attendu' using errcode = '22023';
  end if;
  v_paye := exists (select 1 from facturation.acces a
                     where a.tenant_id = p_pme and a.cabinet_tenant_id = p_cabinet
                       and a.statut = 'actif');
  if v_paye then
    v_lic := facturation.licence_de(p_pme);
    select sieges_max into v_max from facturation.droits_v where licence_id = v_lic;
    if v_max is not null and facturation.places_occupees(v_lic) >= v_max then
      raise exception '%', app.refus_avec_valeurs('refus.place.offre_pleine', 'places', (v_max)::text)
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from identity.memberships m
                where m.tenant_id = p_pme
                  and lower(coalesce(app.email_du_membre(m.user_id), '')) = v_email) then
      raise exception 'refus.invitation.deja_membre' using errcode = '22023';
    end if;
    -- Comme `place_offrir` : depuis l'application installée, une place au-delà
    -- des places incluses se vend, et elle ne se vend pas là (Google Play).
    select sieges_inclus into v_inclus from facturation.droits_v where licence_id = v_lic;
    if coalesce(current_setting('malica.client_coque', true), '') = 'oui'
       and not exists (select 1 from identity.invitations i
                        where i.tenant_id = p_pme and lower(i.email) = v_email
                          and i.accepted_at is null and i.revoked_at is null
                          and i.expires_at > now())
       and facturation.places_engagees(v_lic) >= coalesce(v_inclus, 0) then
      raise exception 'refus.place.incluses_prises' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from identity.invitations i
                    where i.tenant_id = p_pme and lower(i.email) = v_email
                      and i.accepted_at is null and i.revoked_at is null
                      and i.expires_at > now()) then
      insert into identity.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
      values (p_pme, v_email, 'collaborateur',
              encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
              auth.uid(), now() + interval '30 days');
    end if;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (p_pme, auth.uid(), 'place.donnee', 'identity', 'organizations', p_pme,
            jsonb_build_object('cabinet', p_cabinet, 'email', v_email));
    insert into collab.notifications (tenant_id, kind, payload)
    values (p_pme, 'place.donnee',
            jsonb_build_object('email', v_email,
                               'cabinet', (select name from identity.organizations where id = p_cabinet)));
    return jsonb_build_object('mode', 'donnee');
  end if;
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_pme, 'place.suggeree',
          jsonb_build_object('email', v_email,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_pme, auth.uid(), 'place.suggeree', 'identity', 'organizations', p_pme,
          jsonb_build_object('cabinet', p_cabinet, 'email', v_email));
  return jsonb_build_object('mode', 'suggeree');
end
$$;

revoke all on function public.cabinet_place_pour_le_client(uuid, uuid, text) from public;
grant execute on function public.cabinet_place_pour_le_client(uuid, uuid, text) to authenticated;

-- ------------------------------------------- vérifier une liste à importer

-- Chaque ligne : { "matricule", "raison_sociale", "email" }. Rien n'est créé :
-- la page dit, ligne par ligne, ce qui se passera.
create or replace function public.dossiers_verifier(p_cabinet uuid, p_lignes jsonb)
returns table (ligne integer, statut text, motif text, organisation text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cab   record;
  r       record;
  v_mf    text;
  v_nom   text;
  v_mail  text;
  v_refus text;
  v_org   record;
  v_vus   text[] := array[]::text[];
begin
  select id, kind, jurisdiction into v_cab
    from identity.organizations where id = p_cabinet and archived_at is null;
  if v_cab.id is null or v_cab.kind <> 'cabinet'
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) > 500 then
    raise exception 'refus.import.trop_de_lignes' using errcode = '22023';
  end if;
  for r in select e.value as v, e.ordinality::int as n
             from jsonb_array_elements(p_lignes) with ordinality e loop
    ligne := r.n;
    organisation := null;
    v_mf := upper(nullif(trim(coalesce(r.v ->> 'matricule', '')), ''));
    v_nom := nullif(trim(coalesce(r.v ->> 'raison_sociale', '')), '');
    v_mail := lower(nullif(trim(coalesce(r.v ->> 'email', '')), ''));
    if v_mf is null then
      statut := 'a_corriger'; motif := 'refus.dossier.matricule_requis'; return next; continue;
    end if;
    v_refus := public.identifiant_verifier(v_cab.jurisdiction, 'matricule_fiscal', v_mf);
    if v_refus is not null then
      statut := 'a_corriger'; motif := v_refus; return next; continue;
    end if;
    if v_mf = any(v_vus) then
      statut := 'a_corriger'; motif := 'refus.import.matricule_en_double'; return next; continue;
    end if;
    v_vus := v_vus || v_mf;
    select o.id, o.name into v_org
      from identity.organizations o
     where o.archived_at is null and upper(trim(o.legal_id)) = v_mf;
    if v_org.id is not null then
      organisation := v_org.name;
      if exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = v_org.id
                    and e.status in ('propose', 'actif')) then
        statut := 'deja_client'; motif := null;
      else
        statut := 'existant'; motif := null;
      end if;
      return next; continue;
    end if;
    if v_nom is null then
      statut := 'a_corriger'; motif := 'refus.dossier.raison_sociale_requise'; return next; continue;
    end if;
    if v_mail is null or v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      statut := 'a_corriger'; motif := 'refus.invitation.adresse'; return next; continue;
    end if;
    statut := 'pret'; motif := null;
    return next;
  end loop;
end
$$;

revoke all on function public.dossiers_verifier(uuid, jsonb) from public;
grant execute on function public.dossiers_verifier(uuid, jsonb) to authenticated;

-- ------------------------------------------- l'état de chaque client

drop function if exists public.clients_du_cabinet_etat(uuid);
create or replace function public.clients_du_cabinet_etat(p_cabinet uuid)
returns table (
  tenant_id uuid,
  adresse text,
  dirigeant_present boolean,
  invitation_email text,
  invitation_envoyee timestamptz,
  invitation_expiree boolean,
  acces_id uuid,
  acces_statut text,
  acces_offre text,
  descente_offre text,
  licence_id uuid,
  titulaire_nom text,
  forfait_offre text,
  organisations integer,
  organisations_incluses integer,
  sieges_occupes integer,
  sieges_inclus integer,
  places_en_attente integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         o.adresse,
         exists (select 1 from identity.memberships m
                  where m.tenant_id = o.id and m.role = 'dirigeant'),
         inv.email,
         inv.created_at,
         inv.expires_at <= now(),
         a.id, a.statut, a.offre_code,
         (select d.offre_code from facturation.acces_descentes d
           where d.tenant_id = o.id and d.statut = 'propose'),
         lo.licence_id,
         coalesce(nullif(trim(p.display_name), ''), u.email::text),
         dv.offre_code,
         dv.organisations::int, dv.organisations_incluses::int,
         dv.sieges_occupes::int, dv.sieges_inclus::int,
         (select count(*)::int from identity.invitations i
           where i.tenant_id = o.id and i.role <> 'dirigeant'
             and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    from identity.engagements e
    join identity.organizations o on o.id = e.pme_org_id and o.archived_at is null
    left join lateral (
      select i.email, i.created_at, i.expires_at
        from identity.invitations i
       where i.tenant_id = o.id and i.accepted_at is null and i.revoked_at is null
         and i.role = 'dirigeant'
       order by i.created_at desc limit 1
    ) inv on true
    left join lateral (
      select x.id, x.statut, x.offre_code
        from facturation.acces x
       where x.tenant_id = o.id and x.cabinet_tenant_id = p_cabinet and x.statut <> 'termine'
       limit 1
    ) a on true
    left join facturation.licence_organisations lo on lo.tenant_id = o.id
    left join facturation.licences l on l.id = lo.licence_id
    left join identity.profiles p on p.user_id = l.titulaire
    left join auth.users u on u.id = l.titulaire
    left join facturation.droits_v dv on dv.licence_id = lo.licence_id
   where e.cabinet_org_id = p_cabinet
     and e.status in ('propose', 'actif')
     and app.has_org_role(p_cabinet, array['expert', 'collaborateur', 'assistant'])
     and e.pme_org_id in (select app.mandats_visibles(p_cabinet))
$$;

revoke all on function public.clients_du_cabinet_etat(uuid) from public;
grant execute on function public.clients_du_cabinet_etat(uuid) to authenticated;

-- ---------------------------- le dirigeant rejoint : licence et offre

-- Ce qui se passe quand le dirigeant arrive, par le lien ou par l'invitation
-- reçue dans l'application : sa société rejoint sa licence s'il en a une qui
-- l'inclut encore, sinon une licence naît ; puis l'offre que la comptabilité
-- avait choisie démarre (A2) — c'est elle qui paie, il n'a rien à accepter.
create or replace function facturation.dirigeant_arrive(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lic   uuid;
  v_acces uuid;
begin
  if not exists (select 1 from facturation.licence_organisations lo
                  where lo.tenant_id = p_tenant) then
    select dv.licence_id into v_lic
      from facturation.droits_v dv
     where dv.titulaire = auth.uid()
       and dv.organisations < dv.organisations_incluses
     order by dv.offre_rang desc nulls last
     limit 1;
    if v_lic is not null then
      insert into facturation.licence_organisations (licence_id, tenant_id)
      values (v_lic, p_tenant);
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (p_tenant, auth.uid(), 'licence.rattachee', 'facturation', 'licences', v_lic,
              jsonb_build_object('par', 'meme_dirigeant'));
    end if;
  end if;
  v_lic := facturation.licence_naitre(p_tenant, auth.uid(), null, current_date);
  select a.id into v_acces
    from facturation.acces a
   where a.tenant_id = p_tenant and a.canal = 'cabinet' and a.statut = 'propose';
  if v_acces is null then
    return;
  end if;
  -- Rattachée à une licence qu'une comptabilité paie déjà : la société est
  -- couverte par elle, la proposition à part se retire (pas de double facture).
  if exists (select 1 from facturation.acces a
              where a.licence_id = v_lic and a.statut = 'actif' and a.canal = 'cabinet') then
    update facturation.acces
       set statut = 'termine', effet_du = current_date, effet_au = current_date,
           motif_fin = 'retrait_cabinet'
     where id = v_acces;
    return;
  end if;
  perform public.acces_repondre(v_acces, true);
end
$$;

revoke all on function facturation.dirigeant_arrive(uuid) from public;

create or replace function public.invitation_par_lien_accepter(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  insert into identity.memberships (tenant_id, user_id, role)
  values (v.tenant_id, auth.uid(), v.role)
  on conflict (tenant_id, user_id) do nothing;
  if v.role = 'dirigeant' then
    perform facturation.dirigeant_arrive(v.tenant_id);
  end if;
  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', v.id,
          jsonb_build_object('role', v.role, 'par', 'lien'));
  return jsonb_build_object('tenantId', v.tenant_id, 'role', v.role);
end
$$;

create or replace function public.invitation_repondre(p_id uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations where id = p_id;
  if v.id is null
     or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'refus.introuvable.invitation' using errcode = '42501';
  end if;
  if v.accepted_at is not null or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'refus.invitation.expiree' using errcode = '22023';
  end if;
  if p_accepte then
    insert into identity.memberships (tenant_id, user_id, role)
    values (v.tenant_id, auth.uid(), v.role)
    on conflict (tenant_id, user_id) do nothing;
    if v.role = 'dirigeant' then
      perform facturation.dirigeant_arrive(v.tenant_id);
    end if;
    update identity.invitations
       set accepted_at = now(), accepted_by = auth.uid()
     where id = p_id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
    values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', p_id,
            jsonb_build_object('role', v.role));
    return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', true);
  end if;
  update identity.invitations set expires_at = now() where id = p_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.decline', 'identity', 'invitations', p_id,
          jsonb_build_object('role', v.role));
  return jsonb_build_object('id', p_id, 'tenantId', v.tenant_id, 'role', v.role, 'rejoint', false);
end
$$;

-- Proposer : refusé à une société déjà couverte par sa licence partagée.
create or replace function public.acces_proposer(p_cabinet uuid, p_client uuid, p_offre text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_grille ref.offres;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '42501';
  end if;
  if exists (select 1 from facturation.acces a
              where a.tenant_id = p_client and a.statut in ('propose', 'actif', 'suspendu')) then
    raise exception 'refus.abonnement.deja_propose'
      using errcode = 'check_violation';
  end if;
  -- Une société rattachée à une licence que la comptabilité paie déjà est
  -- couverte : un second abonnement la ferait payer deux fois.
  if exists (select 1 from facturation.licence_organisations lo
               join facturation.acces a on a.licence_id = lo.licence_id
              where lo.tenant_id = p_client and a.statut = 'actif' and a.canal = 'cabinet') then
    raise exception 'refus.abonnement.couvert_par_la_licence' using errcode = 'check_violation';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;
  insert into facturation.acces
    (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut, propose_le, propose_par)
  values
    (p_client, 'cabinet', p_cabinet, v_grille.code, v_grille.effective_from, 'propose',
     current_date, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_client, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('cabinet', p_cabinet, 'offre', v_grille.code));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('client', p_client, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_client, 'acces.propose',
          jsonb_build_object('acces_id', v_id, 'offre', v_grille.code,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  return v_id;
end
$$;

-- Une question tranchée ne reste pas « à traiter » : quand une proposition
-- d'abonnement ou une descente reçoit sa réponse (ou démarre d'elle-même à
-- l'arrivée du dirigeant), sa notification passe lue pour tout le dossier.
create or replace function collab.question_tranchee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.statut = 'propose' and new.statut <> 'propose' then
    update collab.notifications n
       set read_at = coalesce(n.read_at, now())
     where n.tenant_id = new.tenant_id
       and n.read_at is null
       and ((tg_table_name = 'acces' and n.kind = 'acces.propose'
             and n.payload ->> 'acces_id' = new.id::text)
         or (tg_table_name = 'acces_descentes' and n.kind = 'acces.descente_demandee'
             and n.payload ->> 'descente_id' = new.id::text));
  end if;
  return new;
end
$$;

revoke all on function collab.question_tranchee() from public;

drop trigger if exists question_tranchee on facturation.acces;
create trigger question_tranchee after update of statut on facturation.acces
  for each row execute function collab.question_tranchee();
drop trigger if exists question_tranchee on facturation.acces_descentes;
create trigger question_tranchee after update of statut on facturation.acces_descentes
  for each row execute function collab.question_tranchee();
