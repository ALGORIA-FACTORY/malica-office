-- ======================================================================
--  L'accès total : un opérateur de la plateforme agit, dans TOUTE
--  organisation, comme son rôle le plus haut (décision du dirigeant,
--  5 novembre 2026, prise après l'avertissement sur l'isolation des clients :
--  « accès total partout » plutôt qu'un accès de support borné dans le temps).
--
--  CE QUE CE FICHIER POSE
--
--  1. `plateforme.acces_total` : la décision, datée, motivée, en ajout seul
--     (R7). La dernière ligne d'une personne vaut ; un retrait est une ligne
--     de plus. Aucun compte n'est nommé ici (R4) : la Tour accorde à un compte
--     existant, par sa porte, et retire de la même façon. Cette migration
--     n'accorde rien à personne.
--
--  2. Deux portes de la plateforme, journalisées dans `audit.event_log` sous
--     l'organisation d'ALGORIA (l'émetteur des factures en vigueur) :
--     `plateforme.acces_total_accorder(email, motif)` et
--     `plateforme.acces_total_retirer(personne, motif)`. Seul un opérateur
--     accorde ; il n'accorde qu'à un AUTRE opérateur (quatre yeux : nul ne se
--     donne l'accès total à lui-même) ; il retire à quiconque, lui compris.
--
--  3. L'effet, posé UNE fois, dans les prédicats dont dépendent les
--     politiques et les portes — pas dans les ~600 politiques :
--       - `app.a_l_acces_total()` : l'appelant, en personne (ni clé d'API, ni
--         compte de service), opérateur à cet instant, et dont la dernière
--         décision est « accordé ». Retirer l'opérateur coupe l'accès aussi.
--       - `app.role_d_acces_total(org)` : le rôle que l'accès total donne
--         dans cette organisation, lu dans le référentiel
--         (`ref.types_d_organisation.role_d_acces_total` : dirigeant d'une
--         PME, expert d'un cabinet). Une organisation archivée n'en donne pas.
--       - `app.adhesions_de(personne)` : les adhésions RÉELLES, plus, pour
--         l'appelant qui a l'accès total, une adhésion VIRTUELLE par
--         organisation. C'est la seule source « en forme d'adhésion » que
--         lisent `app.member_orgs()`, `app.orgs_avec_droit_de()` (donc
--         `app.a_le_droit`, `app.droits_dans`), `public.mon_acces()` et les
--         listes « mes organisations » (`public.mes_adhesions_v`).
--       - `app.has_org_role()` : l'adhésion réelle, ou le rôle d'accès total.
--       - `app.expert_mandate_sur()`, `app.supervise_le_dossier()` lisent le
--         rôle par `app.has_org_role()` au lieu de relire la table.
--       - la politique `profiles_own` : sous l'accès total, les prénoms de
--         tous (il est de toutes les organisations) ; le reste inchangé.
--       - `public.piece_voir` : ouvrir sous l'accès total n'écrit pas de
--         « Vue » (ci-dessous).
--
--  POURQUOI DES ADHÉSIONS VIRTUELLES, ET PAS DES LIGNES DANS
--  `identity.memberships`. Une ligne réelle prendrait une place (les places
--  et les sièges se comptent sur la table : `facturation.places_occupees`,
--  `places_engagees`, `licence_sieges_de`, `facturation.places_v`), entrerait
--  dans les factures, apparaîtrait aux clients (« qui dirige », l'équipe, les
--  sièges, les destinataires du circuit) et recevrait leurs notifications.
--  L'adhésion virtuelle n'existe que du point de vue de son titulaire : la
--  table n'est pas touchée, et tout ce qui compte, facture ou liste pour un
--  client continue de la lire seule. Le seul endroit où le client peut voir
--  le titulaire est le journal (`audit.event_log.actor = auth.uid()`), et
--  l'auteur que le produit affiche d'un geste fait (une écriture inscrite
--  par…) : un geste se signe du nom de qui l'a fait, il ne se maquille pas.
--
--  CE QUI RESTE FERMÉ, DÉLIBÉRÉMENT
--
--  - Les pièces « Mon espace privé » (`vis = 'personnel'`) d'une AUTRE
--    personne : `app.piece_lisible` ne les rend qu'à leur auteur, et rien
--    ici ne l'élargit. Ce sont des données personnelles de tiers (INPDP,
--    loi 2004-63) ; la réquisition (`plateforme.requisitions`) reste la seule
--    exception, nommée et approuvée. À confirmer par le dirigeant.
--  - Les gestes du TITULAIRE de la licence (payer, changer d'offre, souscrire
--    l'année, transmettre la licence) exigent `licences.titulaire =
--    auth.uid()` : l'accès total ne fait pas payer un client, et la Tour a
--    ses propres portes sur les licences.
--  - Ouvrir une pièce sous l'accès total n'écrit pas de « Vue » : le client
--    croirait que son propriétaire, ou son cabinet, l'a vue.
--  - La relecture de nuit, les notifications, les destinataires du circuit,
--    la « prise en charge » d'une écriture par le cabinet suivent les
--    adhésions réelles.
-- ======================================================================

begin;

-- ------------------------------------------------- 1. Le rôle que l'accès total donne

alter table ref.types_d_organisation add column role_d_acces_total text;
alter table ref.types_d_organisation
  add constraint types_d_organisation_role_d_acces_total_fk
  foreign key (code, role_d_acces_total) references ref.roles_d_adhesion (org_kind, role);

update ref.types_d_organisation set role_d_acces_total = 'dirigeant' where code = 'pme';
update ref.types_d_organisation set role_d_acces_total = 'expert' where code = 'cabinet';

comment on column ref.types_d_organisation.role_d_acces_total is
  'Le rôle qu''un opérateur qui a l''accès total (plateforme.acces_total) tient dans une '
  'organisation de ce type : le plus haut. Vide : l''accès total n''ouvre pas ce type.';

-- ------------------------------------------------------------ 2. La décision

create table plateforme.acces_total (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  actif   boolean not null,
  motif   text not null check (length(btrim(motif)) > 0),
  par     uuid not null references auth.users (id),
  le      timestamptz not null default now(),
  -- L'ORDRE des décisions, et lui seul (revue Codex de #231). `le` est figé au
  -- début de la transaction : un retrait ouvert AVANT un accord, mais inscrit
  -- après lui, portait un `le` antérieur, et l'accord restait en vigueur. Les
  -- portes s'inscrivent sous un verrou par personne : le rang suit l'ordre
  -- réel d'inscription. `le` ne sert qu'à l'affichage.
  rang    bigint generated always as identity
);

create index acces_total_user_id_idx on plateforme.acces_total (user_id, rang desc);
create index acces_total_par_fk_idx on plateforme.acces_total (par);

comment on table plateforme.acces_total is
  'L''accès total d''un opérateur à toutes les organisations, comme leur rôle le plus haut '
  '(décision du dirigeant du 5 novembre 2026). Daté, motivé, en ajout seul : la dernière '
  'ligne d''une personne vaut. Accordé et retiré par la Tour, jamais par une migration.';

alter table plateforme.acces_total enable row level security;
alter table plateforme.acces_total force row level security;
revoke all on table plateforme.acces_total from public, anon;
grant select on table plateforme.acces_total to authenticated;
create policy acces_total_lire on plateforme.acces_total
  for select to authenticated using ((select app.is_platform()));
create trigger acces_total_ne_se_reecrit_pas
  before update or delete on plateforme.acces_total
  for each row execute function app.deny_mutation();

-- ------------------------------------------------------ 3. Les prédicats, une fois

/* L'appelant a-t-il l'accès total, ici et maintenant ? En personne seulement :
   `app.is_platform()` écarte une clé d'API et un compte de service, et cesse
   dès que la personne n'est plus opératrice. */
create function app.a_l_acces_total()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.actif from plateforme.acces_total a
                    where a.user_id = auth.uid()
                    order by a.rang desc
                    limit 1), false)
     and app.is_platform()
$$;

revoke all on function app.a_l_acces_total() from public, anon;
grant execute on function app.a_l_acces_total() to authenticated;

/* Le rôle que l'accès total de l'appelant lui donne dans cette organisation,
   ou NULL : sans accès total, organisation archivée, ou type sans rôle. */
create function app.role_d_acces_total(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.role_d_acces_total
    from identity.organizations o
    join ref.types_d_organisation t on t.code = o.kind
   where o.id = p_org
     and o.archived_at is null
     and app.a_l_acces_total()
$$;

revoke all on function app.role_d_acces_total(uuid) from public, anon, authenticated;

/* Les adhésions d'une personne : les réelles, et, pour l'appelant qui a
   l'accès total, une virtuelle par organisation, à son rôle le plus haut —
   qui remplace la réelle là où il en a une. `par_acces_total` : la personne
   n'est là QUE par l'accès total. Interne : la lire pour un autre que
   soi-même dirait ses adhésions (`app.mes_adhesions()` pour soi). */
create function app.adhesions_de(p_personne uuid)
returns table (tenant_id uuid, role text, par_acces_total boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with total as (
    select coalesce(p_personne = auth.uid(), false) and app.a_l_acces_total() as oui
  )
  select m.tenant_id, m.role, false
    from identity.memberships m
   where m.user_id = p_personne
     and not ((select oui from total) and app.role_d_acces_total(m.tenant_id) is not null)
  union all
  select o.id, app.role_d_acces_total(o.id),
         not exists (select 1 from identity.memberships m
                      where m.tenant_id = o.id and m.user_id = p_personne)
    from identity.organizations o
   where (select oui from total)
     and app.role_d_acces_total(o.id) is not null
$$;

revoke all on function app.adhesions_de(uuid) from public, anon, authenticated;

/* Mes adhésions : ce que lisent les listes « mes organisations ». */
create function app.mes_adhesions()
returns table (tenant_id uuid, role text, par_acces_total boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.tenant_id, a.role, a.par_acces_total from app.adhesions_de(auth.uid()) a
$$;

revoke all on function app.mes_adhesions() from public, anon;
grant execute on function app.mes_adhesions() to authenticated;

create view public.mes_adhesions_v with (security_invoker = true) as
  select a.tenant_id, a.role, a.par_acces_total from app.mes_adhesions() a;

revoke all on table public.mes_adhesions_v from public, anon;
grant select on table public.mes_adhesions_v to authenticated;

comment on view public.mes_adhesions_v is
  'Les organisations de l''appelant et son rôle dans chacune : ses adhésions réelles, et '
  'celles que lui donne l''accès total (par_acces_total). Ni une place, ni un siège : '
  'les comptes et les listes des clients lisent identity.memberships.';

-- Les organisations dont l'appelant est membre : la première branche lit
-- désormais `app.adhesions_de`, le reste est inchangé.
create or replace function app.member_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.tenant_id
    from app.adhesions_de(auth.uid()) a
   where app.api_tenant() is null
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
  union all
  -- Le relecteur de nuit : son dossier, tant qu'il y a une relecture à faire.
  select s.dossier
    from (select app.dossier_du_service() as dossier) s
   where s.dossier is not null
     and app.relecture_due(s.dossier, null)
$$;

-- Le rôle : l'adhésion réelle, ou celui que donne l'accès total. Appelée par
-- ligne dans les politiques : l'adhésion réelle se lit d'abord, par l'index,
-- et l'accès total ne se cherche que si une décision nomme l'appelant — une
-- sonde d'index, sans appel imbriqué pour qui n'en a jamais eu.
create or replace function app.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from identity.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_org
      and m.role = any(p_roles)
  ) or (exists (select 1 from plateforme.acces_total g where g.user_id = auth.uid())
        and coalesce(app.role_d_acces_total(p_org) = any(p_roles), false))
$$;

-- Les droits d'une personne : par ses adhésions (`app.adhesions_de`).
create or replace function app.orgs_avec_droit_de(p_personne uuid, p_droit text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from app.adhesions_de(p_personne) m
    join identity.organizations o on o.id = m.tenant_id
    join ref.droits_des_roles d
      on d.org_kind = o.kind and d.role = m.role and d.droit = p_droit
     and d.valid_from <= current_date
     and (d.valid_to is null or d.valid_to > current_date)
$$;

create or replace function app.expert_mandate_sur(p_pme uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from identity.engagements e
     where e.pme_org_id = p_pme and e.status = 'actif'
       and app.has_org_role(e.cabinet_org_id, array['expert']))
$$;

create or replace function app.supervise_le_dossier(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from identity.engagements e
     where e.pme_org_id = p_tenant and e.status = 'actif'
       and (app.has_org_role(e.cabinet_org_id, array['expert'])
            or (app.has_org_role(e.cabinet_org_id, array['collaborateur'])
                and exists (select 1 from collab.assignments a
                             where a.cabinet_tenant_id = e.cabinet_org_id
                               and a.client_tenant_id = p_tenant
                               and a.collaborator_id = auth.uid()
                               and a.active))))
$$;

create or replace function public.mon_acces(p_tenant uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'role', (select a.role from app.mes_adhesions() a
              where a.tenant_id = p_tenant
              limit 1),
    'plateforme', app.is_platform());
$$;

-- Les prénoms : les miens, ceux des membres de mes organisations réelles
-- (inchangé), et, sous l'accès total, ceux de tous — il est de toutes les
-- organisations. Lui n'est membre d'aucune organisation d'un client : son
-- profil ne leur est pas rendu. L'appel s'enveloppe : il s'évalue une fois.
drop policy profiles_own on identity.profiles;
create policy profiles_own on identity.profiles for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1
                      from identity.memberships a
                      join identity.memberships b on b.tenant_id = a.tenant_id
                     where a.user_id = auth.uid() and b.user_id = profiles.user_id)
         or (select app.a_l_acces_total()));

-- Ouvrir une pièce : le comptable se cherche parmi ses adhésions RÉELLES
-- (inchangé), et le propriétaire qui n'est là que par l'accès total n'écrit
-- pas de « Vue ». Le reste du corps est celui de 20261110090100.
create or replace function public.piece_voir(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_cabinet uuid;
  v_archivee timestamptz;
  v_depuis  timestamptz;
  v_le      timestamptz;
  v_membre  boolean;
  v_rien    constant jsonb := jsonb_build_object('piece_id', p_piece, 'vue_le', null,
                                                 'deja', false);
begin
  select tenant_id, vis, archivee_le into v_tenant, v_vis, v_archivee
    from capture.pieces where id = p_piece;
  v_membre := coalesce(v_tenant in (select app.member_orgs()) and app.piece_lisible(p_piece),
                       false);

  -- Dans la société : le propriétaire qui ouvre la pièce qu'un siège lui a
  -- envoyée la « voit ». Ouvrir n'importe quelle autre pièce de la société
  -- n'écrit rien, et ne refuse rien : l'écran ouvre, la base décide. Une pièce
  -- PARTAGÉE prend le passage du comptable, même pour qui est membre des deux
  -- côtés (compte de développement : la « Vue » du cabinet ne s'écrivait plus).
  if v_membre and v_vis = 'entite'::app.vis_t then
    if v_archivee is not null
       or not app.a_le_droit(v_tenant, 'circuit.recevoir')
       -- L'accès total ouvre sans « voir » : le siège croirait que son
       -- propriétaire a vu la pièce (20261129090000).
       or exists (select 1 from app.mes_adhesions() a
                   where a.tenant_id = v_tenant and a.par_acces_total)
       or exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
       or (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      return v_rien;
    end if;
    -- Une « Vue » par envoi et par correction de l'auteur — la première, quel
    -- que soit le propriétaire : deux propriétaires qui ouvrent ensemble n'en
    -- écrivent qu'une (l'index unique tranche).
    v_depuis := greatest(app.dernier_envoi_au_proprietaire(p_piece),
                         coalesce(app.corrigee_par_l_auteur(p_piece), '-infinity'::timestamptz));
    insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
    values (v_tenant, p_piece, v_tenant, auth.uid(), app.prenom_au_moment(auth.uid()), v_depuis)
    on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
    returning vue_le into v_le;
    if v_le is not null then
      return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
    end if;
    select v.vue_le into v_le
      from capture.vues v
     where v.tenant_id = v_tenant and v.piece_id = p_piece
       and v.cabinet_org_id = v_tenant and v.depuis = v_depuis;
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
  end if;

  -- Le comptable : repris de `20261030090000`. Un membre qui n'est pas du
  -- cabinet ouvre sans rien écrire.
  if v_tenant is null or v_vis <> 'partage'::app.vis_t then
    if v_membre then
      return v_rien;
    end if;
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id
   where e.pme_org_id = v_tenant and e.status = 'actif' and m.user_id = auth.uid()
     and v_tenant in (select app.mandats_visibles(e.cabinet_org_id))
   order by e.starts_on desc nulls last
   limit 1;
  if v_cabinet is null then
    if v_membre then
      return v_rien;
    end if;
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_archivee is not null
     or exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return v_rien;
  end if;

  v_depuis := coalesce(greatest(app.dernier_envoi(p_piece), app.corrigee_par_le_client(p_piece)),
                       '-infinity'::timestamptz);
  insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
  values (v_tenant, p_piece, v_cabinet, auth.uid(), app.nom_au_moment(auth.uid()), v_depuis)
  on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
  returning vue_le into v_le;
  if v_le is not null then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
  end if;

  select v.vue_le into v_le
    from capture.vues v
   where v.tenant_id = v_tenant and v.piece_id = p_piece
     and v.cabinet_org_id = v_cabinet and v.depuis = v_depuis;
  return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
end
$function$;

-- ------------------------------------------------------------ 4. Les portes

/* L'organisation sous laquelle la plateforme journalise ses décisions : celle
   d'ALGORIA, l'émetteur des factures en vigueur. Aucun repli. */
create function plateforme.organisation_de_la_plateforme()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.organisation_id
    from facturation.emetteurs e
   where e.valide_des <= current_date
   order by e.valide_des desc, e.created_at desc
   limit 1
$$;

revoke all on function plateforme.organisation_de_la_plateforme() from public, anon, authenticated;

create function plateforme.acces_total_accorder(p_email text, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_org  uuid;
  v_id   uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.acces_total.motif_requis' using errcode = '22023';
  end if;
  select u.id into v_user
    from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'refus.introuvable.compte' using errcode = '22023';
  end if;
  if not exists (select 1 from app.platform_operators po where po.user_id = v_user) then
    raise exception 'refus.acces_total.pas_operateur' using errcode = '22023';
  end if;
  if v_user = auth.uid() then
    raise exception 'refus.acces_total.pour_soi_meme' using errcode = '42501';
  end if;
  -- Une décision à la fois par personne : deux accords simultanés liraient le
  -- même état et s'inscriraient tous les deux.
  perform pg_advisory_xact_lock(hashtextextended('plateforme.acces_total:' || v_user::text, 0));
  if coalesce((select a.actif from plateforme.acces_total a where a.user_id = v_user
                order by a.rang desc limit 1), false) then
    raise exception 'refus.acces_total.deja_accorde' using errcode = '22023';
  end if;
  v_org := plateforme.organisation_de_la_plateforme();
  if v_org is null then
    raise exception 'refus.acces_total.sans_emetteur' using errcode = '22023';
  end if;

  insert into plateforme.acces_total (user_id, actif, motif, par)
  values (v_user, true, btrim(p_motif), auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (v_org, auth.uid(), 'acces_total.accorde', 'plateforme', 'acces_total', v_id,
          jsonb_build_object('personne', v_user, 'motif', btrim(p_motif)));

  return jsonb_build_object('decision', v_id, 'personne', v_user, 'actif', true);
end
$$;

revoke all on function plateforme.acces_total_accorder(text, text) from public, anon;
grant execute on function plateforme.acces_total_accorder(text, text) to authenticated;

create function plateforme.acces_total_retirer(p_personne uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.acces_total.motif_requis' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plateforme.acces_total:' || p_personne::text, 0));
  if not coalesce((select a.actif from plateforme.acces_total a where a.user_id = p_personne
                    order by a.rang desc limit 1), false) then
    raise exception 'refus.acces_total.non_accorde' using errcode = '22023';
  end if;
  v_org := plateforme.organisation_de_la_plateforme();
  if v_org is null then
    raise exception 'refus.acces_total.sans_emetteur' using errcode = '22023';
  end if;

  insert into plateforme.acces_total (user_id, actif, motif, par)
  values (p_personne, false, btrim(p_motif), auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (v_org, auth.uid(), 'acces_total.retire', 'plateforme', 'acces_total', v_id,
          jsonb_build_object('personne', p_personne, 'motif', btrim(p_motif)));

  return jsonb_build_object('decision', v_id, 'personne', p_personne, 'actif', false);
end
$$;

revoke all on function plateforme.acces_total_retirer(uuid, text) from public, anon;
grant execute on function plateforme.acces_total_retirer(uuid, text) to authenticated;

/* Qui a l'accès total aujourd'hui, depuis quand, pourquoi, et qui l'a donné. */
create function plateforme.acces_total_en_vigueur()
returns table (user_id uuid, email text, nom text, depuis timestamptz, motif text,
               par_email text, operateur boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return query
    with derniere as (
      select distinct on (a.user_id) a.user_id, a.actif, a.motif, a.par, a.le
        from plateforme.acces_total a
       order by a.user_id, a.rang desc
    )
    select d.user_id, u.email::text, pr.display_name::text, d.le, d.motif, p.email::text,
           exists (select 1 from app.platform_operators po where po.user_id = d.user_id)
      from derniere d
      join auth.users u on u.id = d.user_id
      left join auth.users p on p.id = d.par
      left join identity.profiles pr on pr.user_id = d.user_id
     where d.actif
     order by d.le, u.email;
end
$$;

revoke all on function plateforme.acces_total_en_vigueur() from public, anon;
grant execute on function plateforme.acces_total_en_vigueur() to authenticated;

commit;
