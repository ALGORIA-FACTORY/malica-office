-- ======================================================================
--  Qui lit une licence et ses factures (moteur commercial, 4/9 — plan du
--  2 novembre 2026, annexe 2.1, L1, F2 à F5 ; décision du dirigeant n° 14).
--
--  Deux prédicats, écrits UNE fois (R12) et repris par toutes les tables et
--  toutes les portes du commerce, sur deux briques — qui lit, côté PME
--  (`facturation.pme_lit_la_licence`) et côté cabinet
--  (`facturation.expert_du_cabinet`) :
--
--    facturation.licences_lisibles()   la plateforme ; le PROPRIÉTAIRE
--        PRINCIPAL (titulaire) ; le CHEF DE LA COMPTABILITÉ d'une société de
--        la licence (droit personnel `commerce.lire`) ; l'EXPERT du cabinet
--        qui a le mandat EN VIGUEUR d'une société de la licence, ou qui la
--        dote par un accès ACTIF dont la fenêtre couvre le jour (un accès
--        proposé, suspendu, terminé ou révoqué ne donne rien).
--        Un collaborateur de la PME, un autre dirigeant, un collaborateur du
--        cabinet : rien (décision 14 : « pas les autres collaborateurs »).
--
--    facturation.factures_lisibles()   la plateforme ; le payeur nommé (la
--        personne, ou les EXPERTS du cabinet payeur) ; le titulaire et le
--        chef de la comptabilité pour les factures de la licence. Le cabinet
--        qui a le mandat ne lit PAS les factures que la PME paie elle-même :
--        il lit celles qu'il paie.
--
--  Un compte de service ne lit rien (`app.service()` non nul), une clé
--  d'API non plus (`app.api_tenant()` non nul) : le commerce n'est pas une
--  surface d'intégration.
--
--  Le chef de la comptabilité : `identity.droits_personnels`, en ajout seul,
--  accordé ou retiré par le propriétaire principal de la licence (porte
--  `public.droit_personnel_regler`). `app.orgs_avec_droit_de` le lit, et
--  `app.droits_dans` le rend donc à l'écran sans autre chemin.
-- ======================================================================

-- ------------------------------------------------------------ 1. Le droit personnel

create table identity.droits_personnels (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete restrict,
  droit       text not null references ref.droits (code),
  accorde     boolean not null,
  motif       text not null check (length(btrim(motif)) > 0),
  decide_par  uuid not null references auth.users (id),
  decide_le   timestamptz not null default now()
);
comment on table identity.droits_personnels is
  'Un droit accordé à UNE personne dans une organisation, hors de son rôle d''adhésion '
  '(ref.droits.personnel). Ajout seul : la dernière décision vaut ; un retrait est une ligne.';
create index droits_personnels_tenant_idx
  on identity.droits_personnels (tenant_id, user_id, droit, decide_le desc);
create index droits_personnels_user_idx on identity.droits_personnels (user_id);
create index droits_personnels_droit_idx on identity.droits_personnels (droit);
create index droits_personnels_decide_par_idx on identity.droits_personnels (decide_par);

alter table identity.droits_personnels enable row level security;
alter table identity.droits_personnels force row level security;
revoke all on table identity.droits_personnels from public, anon, service_role;
grant select on table identity.droits_personnels to authenticated;
create policy droits_personnels_sel on identity.droits_personnels for select to authenticated
  using ((tenant_id in (select app.member_orgs())) or (select app.is_platform()));
create policy service_hors_perimetre on identity.droits_personnels as restrictive
  for select to authenticated using ((select app.service()) is null);
create trigger service_hors_perimetre before insert or update or delete on identity.droits_personnels
  for each statement execute function app.service_hors_perimetre();
create trigger droits_personnels_ajout_seul before update or delete on identity.droits_personnels
  for each row execute function app.deny_mutation();

/** Le droit d'une personne : celui de son rôle, plus ses droits personnels en vigueur. */
create or replace function app.orgs_avec_droit_de(p_personne uuid, p_droit text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id
    from identity.memberships m
    join identity.organizations o on o.id = m.tenant_id
    join ref.droits_des_roles d
      on d.org_kind = o.kind and d.role = m.role and d.droit = p_droit
     and d.valid_from <= current_date
     and (d.valid_to is null or d.valid_to > current_date)
   where m.user_id = p_personne
  union
  select g.tenant_id
    from (select distinct on (dp.tenant_id) dp.tenant_id, dp.accorde
            from identity.droits_personnels dp
           where dp.user_id = p_personne and dp.droit = p_droit
           order by dp.tenant_id, dp.decide_le desc, dp.id desc) g
    join identity.memberships m on m.tenant_id = g.tenant_id and m.user_id = p_personne
   where g.accorde
$$;

/** Les sociétés dont l'appelant est le propriétaire principal (titulaire de la licence). */
create function facturation.societes_du_titulaire()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select lo.tenant_id
    from facturation.licence_organisations lo
    join facturation.licences l on l.id = lo.licence_id
   where l.titulaire = auth.uid()
$$;
revoke all on function facturation.societes_du_titulaire() from public, anon;
grant execute on function facturation.societes_du_titulaire() to authenticated;

-- La porte s'exécute sous le portier (R6) : la politique d'insertion est la
-- règle de droits elle-même — le propriétaire principal, signé de lui-même.
create policy droits_personnels_ins on identity.droits_personnels for insert to authenticated
  with check (decide_par = (select auth.uid())
              and tenant_id in (select facturation.societes_du_titulaire()));
grant insert on table identity.droits_personnels to portier;

/**
 * Le propriétaire principal accorde ou retire un droit personnel à un membre
 * de sa société (décision 14 : le chef de la comptabilité). Une porte du
 * chemin du client : elle appartient au `portier` (R6).
 */
create function public.droit_personnel_regler(
  p_tenant uuid, p_personne uuid, p_droit text, p_accorde boolean, p_motif text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_tenant is null or p_tenant not in (select facturation.societes_du_titulaire()) then
    raise exception 'refus.reserve.titulaire' using errcode = '42501';
  end if;
  if not exists (select 1 from ref.droits d where d.code = p_droit and d.personnel) then
    raise exception 'refus.droit.non_personnel' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.memberships m
                  where m.tenant_id = p_tenant and m.user_id = p_personne) then
    raise exception 'refus.droit.hors_societe' using errcode = 'check_violation';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.commerce.motif_requis' using errcode = 'check_violation';
  end if;
  insert into identity.droits_personnels (tenant_id, user_id, droit, accorde, motif, decide_par)
  values (p_tenant, p_personne, p_droit, p_accorde, p_motif, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), case when p_accorde then 'droit.accorde' else 'droit.retire' end,
          'identity', 'droits_personnels', v_id,
          jsonb_build_object('droit', p_droit, 'personne', p_personne));
  return jsonb_build_object('id', v_id, 'accorde', p_accorde);
end
$$;
alter function public.droit_personnel_regler(uuid, uuid, text, boolean, text) owner to portier;
revoke all on function public.droit_personnel_regler(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.droit_personnel_regler(uuid, uuid, text, boolean, text) to authenticated;

-- ------------------------------------------------------------ 2. Les deux prédicats

/**
 * Le jour civil d'une organisation à un instant : son fuseau, sinon celui de
 * sa juridiction ; aucun repli (#194, R4). 23 h 30 UTC le 30 novembre est le
 * 1er décembre à Tunis.
 */
create function facturation.jour_a(p_org uuid, p_instant timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select (p_instant at time zone app.fuseau_du_cabinet(p_org))::date
$$;
revoke all on function facturation.jour_a(uuid, timestamptz) from public, anon;
grant execute on function facturation.jour_a(uuid, timestamptz) to authenticated;

/** Le jour civil d'une organisation, maintenant. Toute règle du commerce qui dit « aujourd'hui » le lit ici. */
create function facturation.jour_de_l_organisation(p_org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select facturation.jour_a(p_org, now())
$$;
revoke all on function facturation.jour_de_l_organisation(uuid) from public, anon;
grant execute on function facturation.jour_de_l_organisation(uuid) to authenticated;

/**
 * Le jour civil d'une licence : celui de sa première société. Les sociétés
 * d'un Premium partagent une juridiction (une licence, une devise).
 */
create function facturation.jour_de_la_licence(p_licence uuid) returns date
language sql stable security definer set search_path = '' as $$
  select facturation.jour_de_l_organisation(
           (select lo.tenant_id from facturation.licence_organisations lo
             where lo.licence_id = p_licence order by lo.tenant_id limit 1))
$$;
revoke all on function facturation.jour_de_la_licence(uuid) from public, anon;
grant execute on function facturation.jour_de_la_licence(uuid) to authenticated;

/** Côté PME : le propriétaire principal, ou le chef de la comptabilité d'une société de la licence. */
create function facturation.pme_lit_la_licence(p_licence uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from facturation.licences l
                  where l.id = p_licence and l.titulaire = auth.uid())
      or exists (select 1 from facturation.licence_organisations lo
                  where lo.licence_id = p_licence
                    and app.a_le_droit(lo.tenant_id, 'commerce.lire'))
$$;
revoke all on function facturation.pme_lit_la_licence(uuid) from public, anon;
grant execute on function facturation.pme_lit_la_licence(uuid) to authenticated;

/** Côté cabinet : ses experts, et eux seuls — pas ses collaborateurs ni ses assistants (décision 14). */
create function facturation.expert_du_cabinet(p_cabinet uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_org_role(p_cabinet, array['expert'])
$$;
revoke all on function facturation.expert_du_cabinet(uuid) from public, anon;
grant execute on function facturation.expert_du_cabinet(uuid) to authenticated;

create function facturation.licences_lisibles()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select l.id
    from facturation.licences l
   where (select app.service()) is null
     and app.api_tenant() is null
     and (app.is_platform()
          or facturation.pme_lit_la_licence(l.id)
          -- Le mandat en vigueur AUJOURD'HUI (statut et dates), par le prédicat
          -- du dépôt : `app.engaged_orgs_as_expert` (revue Codex de #202).
          or exists (select 1 from facturation.licence_organisations lo
                      where lo.licence_id = l.id
                        and lo.tenant_id in (select app.engaged_orgs_as_expert()))
          -- L'accès qui dote : ACTIF, et en vigueur au jour du cabinet.
          or exists (select 1 from facturation.acces a
                      where a.licence_id = l.id
                        and a.statut = 'actif'
                        and a.cabinet_tenant_id is not null
                        and facturation.expert_du_cabinet(a.cabinet_tenant_id)
                        and a.effet_du is not null
                        and a.effet_du <= facturation.jour_de_l_organisation(a.cabinet_tenant_id)
                        and (a.effet_au is null
                             or a.effet_au > facturation.jour_de_l_organisation(a.cabinet_tenant_id))))
$$;
comment on function facturation.licences_lisibles() is
  'Les licences que l''appelant lit : plateforme, titulaire, chef de la comptabilité '
  '(commerce.lire), expert du cabinet sous mandat en vigueur ou qui dote par un accès actif en '
  'vigueur. Rien pour un service ni une clé.';
revoke all on function facturation.licences_lisibles() from public, anon;
grant execute on function facturation.licences_lisibles() to authenticated;

create function facturation.factures_lisibles()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select f.id
    from facturation.factures f
   where (select app.service()) is null
     and app.api_tenant() is null
     and (app.is_platform()
          or f.payeur_personne = auth.uid()
          or (f.payeur_type = 'cabinet' and facturation.expert_du_cabinet(f.payeur_tenant_id))
          or (f.payeur_type = 'titulaire' and facturation.pme_lit_la_licence(f.licence_id)))
$$;
comment on function facturation.factures_lisibles() is
  'Les factures et avoirs que l''appelant lit : plateforme, payeur nommé (personne ou experts du '
  'cabinet payeur), titulaire et chef de la comptabilité pour la part de la PME. Repris par les '
  'lignes, décisions, documents, envois et encaissements.';
revoke all on function facturation.factures_lisibles() from public, anon;
grant execute on function facturation.factures_lisibles() to authenticated;

-- ------------------------------------------------------------ 3. Les politiques

drop policy facturation_licences_sel on facturation.licences;
create policy facturation_licences_sel on facturation.licences for select to authenticated
  using (id in (select facturation.licences_lisibles()));

drop policy facturation_factures_sel on facturation.factures;
drop policy facturation_factures_ins on facturation.factures;
create policy facturation_factures_sel on facturation.factures for select to authenticated
  using (id in (select facturation.factures_lisibles()));

drop policy facturation_facture_lignes_sel on facturation.facture_lignes;
drop policy facturation_facture_lignes_ins on facturation.facture_lignes;
create policy facturation_facture_lignes_sel on facturation.facture_lignes for select to authenticated
  using ((select app.is_platform()) or facture_id in (select facturation.factures_lisibles()));

drop policy facturation_encaissements_sel on facturation.encaissements;
drop policy facturation_encaissements_ins on facturation.encaissements;
create policy facturation_encaissements_sel on facturation.encaissements for select to authenticated
  using (facture_id in (select facturation.factures_lisibles()));

-- Les gestes : la tour lit tout, notes comprises ; la PME et son cabinet lisent
-- les gestes VISIBLES de leur licence (une note interne ne sort jamais).
drop policy plateforme_interventions_ins on plateforme.interventions;
create policy plateforme_interventions_sel_client on plateforme.interventions for select to authenticated
  using (licence_id in (select facturation.licences_lisibles())
         and acte in (select a.code from ref.actes_intervention a where a.visible_client));
