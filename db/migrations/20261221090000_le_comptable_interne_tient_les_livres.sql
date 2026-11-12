-- ======================================================================
--  Le comptable interne tient les livres de sa société (décision du
--  dirigeant du 12 novembre 2026, point 7.2).
--
--  Un salarié comptable est un MEMBRE de la société PME, avec un rôle dédié,
--  « comptable ». Il a les droits de TRAVAIL d'une comptabilité sur cette
--  société — il voit ses pièces, reçoit celles qu'on lui transmet, prépare,
--  inscrit, valide ou force les écritures, retourne une pièce, tient les
--  échéances, la TVA et les exports —, et jamais l'abonnement, les places ni
--  les sociétés (ces portes exigent le dirigeant : il ne l'est pas). Il ne
--  voit pas le Privé des autres : une pièce `personnel` reste à son auteur.
--
--  1. LE RÉFÉRENTIEL. Le rôle (`ref.roles_d_adhesion`) et un droit nouveau,
--     `livres.tenir`, datés comme les autres (`ref.droits_des_roles`). Aucun
--     écran ni aucune porte ne lit le rôle : ils lisent le droit.
--
--  2. LA PLACE « COMPTABLE ». Une place comprise dans CHAQUE offre, dès
--     Basic, qui ne consomme pas les places payantes : un paramètre de la
--     grille (`ref.offres.places_comptable_incluses`). La colonne naît à 1 sur
--     les offres déjà publiées — c'est la décision — puis perd son défaut :
--     une grille publiée à la tour la porte, ou elle a un trou
--     (`place_comptable_absente`, `places_comptable_decroissantes`). Les
--     places payantes (`places_v`, `places_occupees`) ne comptent que les
--     dirigeants, collaborateurs et assistants : le comptable n'y entre pas.
--
--  3. QUI VALIDE. Les livres d'une société sont tenus par une comptabilité
--     dès qu'un mandat externe est en vigueur OU qu'elle a un comptable
--     interne : elle n'est plus « autonome » au sens où personne ne valide
--     (`app.livres_tenus_par_le_cabinet`). Règle par défaut, à confirmer par
--     le dirigeant (docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md) :
--       - sans comptabilité externe, le comptable interne valide ;
--       - quand une comptabilité externe a un mandat actif, c'est elle qui
--         valide : le comptable interne PRÉPARE (établit le type, propose),
--         il n'inscrit, ne valide, ne force ni ne retourne.
--     Préparer (`app.prepare_le_dossier`) et valider
--     (`app.supervise_le_dossier`) sont deux prédicats ; chaque porte qui
--     prépare lit le premier, chaque porte qui tranche le second.
--
--  4. CE QU'IL LIT. Ce qu'une comptabilité engagée lit du dossier
--     (`app.engaged_orgs()`) : les écritures, les pièces transmises, la file.
--
--  REJEU (R11) : les dates de validité sont des littéraux ; la colonne de
--  la grille prend une constante de schéma, jamais la date du jour.
-- ======================================================================

-- 1. Le référentiel -----------------------------------------------------

insert into ref.roles_d_adhesion (org_kind, role, sort_order)
values ('pme', 'comptable', 30);

insert into ref.droits (code, sort_order) values ('livres.tenir', 70);

insert into ref.droits_des_roles (org_kind, role, droit, valid_from)
values ('pme', 'comptable', 'societe.tout_voir', date '2026-11-12'),
       ('pme', 'comptable', 'livres.tenir', date '2026-11-12');

alter table identity.memberships drop constraint memberships_role_check;
alter table identity.memberships add constraint memberships_role_check
  check (role = any (array['dirigeant', 'collaborateur', 'expert', 'assistant', 'comptable']));

alter table identity.invitations drop constraint invitations_role_check;
alter table identity.invitations add constraint invitations_role_check
  check (role = any (array['dirigeant', 'collaborateur', 'expert', 'assistant', 'comptable']));

-- 2. La place « comptable » de la grille --------------------------------

alter table ref.offres
  add column places_comptable_incluses smallint not null default 1
    constraint offres_places_comptable_incluses_check check (places_comptable_incluses >= 0);
alter table ref.offres alter column places_comptable_incluses drop default;

comment on column ref.offres.places_comptable_incluses is
  'Places « Comptable interne » comprises dans l''offre (7.2, 12 novembre 2026) : '
  'hors des places payantes, au moins une dans chaque offre (grille_trous).';

-- Les places « comptable » qu'offre la licence, à son offre courante.
create function facturation.places_comptable_incluses(p_licence uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (ref.offre_a(h.offre_code, h.offre_depuis)).places_comptable_incluses::integer
    from facturation.forfait_courant_v h
   where h.licence_id = p_licence
$$;
revoke all on function facturation.places_comptable_incluses(uuid) from public;

-- Les places « comptable » prises ou promises sur la licence : les personnes
-- qui l'occupent, et les invitations en attente pour une autre adresse.
create function facturation.places_comptable_engagees(p_licence uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with occupants as (
    select distinct m.user_id, lower(u.email::text) as email
      from facturation.licence_organisations lo
      join identity.memberships m on m.tenant_id = lo.tenant_id and m.role = 'comptable'
      join auth.users u on u.id = m.user_id
     where lo.licence_id = p_licence
  )
  select (select count(*)::int from occupants)
       + (select count(distinct lower(i.email))::int
            from identity.invitations i
            join facturation.licence_organisations lo on lo.tenant_id = i.tenant_id
           where lo.licence_id = p_licence
             and i.role = 'comptable'
             and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
             and lower(i.email) not in (select o.email from occupants o))
$$;
revoke all on function facturation.places_comptable_engagees(uuid) from public;

-- Refuse une place « comptable » de trop. `p_email` : une invitation (la
-- place est promise) ; `p_personne` : une arrivée (la place est prise). Une
-- personne déjà comptable ailleurs dans la licence, ou l'invitation qu'on
-- accepte, n'en prend pas une de plus.
create function facturation.place_comptable_exiger(p_tenant uuid, p_personne uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid := facturation.licence_de(p_tenant);
  v_incluses integer;
  v_engagees integer;
begin
  if v_licence is null then
    return;
  end if;
  perform 1 from facturation.licences l where l.id = v_licence for update;
  if p_personne is not null and exists (
       select 1 from facturation.licence_organisations lo
         join identity.memberships m on m.tenant_id = lo.tenant_id
        where lo.licence_id = v_licence and m.user_id = p_personne and m.role = 'comptable') then
    return;
  end if;
  v_incluses := coalesce(facturation.places_comptable_incluses(v_licence), 0);
  v_engagees := facturation.places_comptable_engagees(v_licence);
  -- L'arrivée d'une personne invitée ne compte pas deux fois : son
  -- invitation, encore en attente, est déjà dans les places engagées.
  if p_personne is not null and exists (
       select 1 from identity.invitations i
         join facturation.licence_organisations lo on lo.tenant_id = i.tenant_id
        where lo.licence_id = v_licence and i.role = 'comptable'
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
          and lower(i.email) = (select lower(u.email::text) from auth.users u
                                 where u.id = p_personne)) then
    v_engagees := v_engagees - 1;
  end if;
  if p_email is not null and exists (
       select 1 from identity.invitations i
         join facturation.licence_organisations lo on lo.tenant_id = i.tenant_id
        where lo.licence_id = v_licence and i.role = 'comptable'
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
          and lower(i.email) = lower(btrim(p_email))) then
    return;
  end if;
  if v_engagees >= v_incluses then
    raise exception '%', app.refus_avec_valeurs('refus.place.comptable_prise', 'places', (v_incluses)::text)
      using errcode = 'check_violation';
  end if;
end
$$;
revoke all on function facturation.place_comptable_exiger(uuid, uuid, text) from public;

-- La porte : le propriétaire invite le comptable interne de SA société. Une
-- place comprise, jamais facturée : elle s'offre aussi depuis la coque.
create function public.comptable_interne_inviter(p_tenant uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'refus.reserve.proprietaire' using errcode = '42501';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_tenant and o.kind = 'pme' and o.archived_at is null) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  perform facturation.place_comptable_exiger(p_tenant, null, p_email);
  return public.cabinet_inviter(p_tenant, p_email, 'comptable');
end
$$;
revoke all on function public.comptable_interne_inviter(uuid, text) from public;
grant execute on function public.comptable_interne_inviter(uuid, text) to authenticated;

-- Ce que voient le propriétaire et son comptable : la place comprise, et qui
-- l'occupe ou l'attend. Jamais un prix.
create function public.place_comptable_lire(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid := facturation.licence_de(p_tenant);
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'incluses', coalesce(facturation.places_comptable_incluses(v_licence), 0),
    'engagees', coalesce(facturation.places_comptable_engagees(v_licence), 0),
    'comptables', coalesce((
      select jsonb_agg(jsonb_build_object('userId', m.user_id,
                                          'nom', app.nom_au_moment(m.user_id))
                       order by m.created_at)
        from identity.memberships m
       where m.tenant_id = p_tenant and m.role = 'comptable'), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email,
                                          'envoyeeLe', i.created_at, 'expiresAt', i.expires_at)
                       order by i.created_at desc)
        from identity.invitations i
       where i.tenant_id = p_tenant and i.role = 'comptable'
         and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
         and app.has_org_role(p_tenant, array['dirigeant'])), '[]'::jsonb));
end
$$;
revoke all on function public.place_comptable_lire(uuid) from public;
grant execute on function public.place_comptable_lire(uuid) to authenticated;

-- 3. Qui prépare, qui valide --------------------------------------------

-- Les sociétés dont la personne connectée est le comptable interne. Jamais
-- par une clé d'API : la clé agit pour sa société, elle n'en tient pas les
-- livres.
create function app.dossiers_du_comptable_interne()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x from app.orgs_avec_droit_de(auth.uid(), 'livres.tenir') x
   where app.api_tenant() is null
     and (select app.service()) is null
$$;
revoke all on function app.dossiers_du_comptable_interne() from public;
grant execute on function app.dossiers_du_comptable_interne() to authenticated;

-- La société a-t-elle un comptable interne ? Indépendant de qui demande.
create function app.a_un_comptable_interne(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from identity.memberships m
      join identity.organizations o on o.id = m.tenant_id
      join ref.droits_des_roles d
        on d.org_kind = o.kind and d.role = m.role and d.droit = 'livres.tenir'
       and d.valid_from <= current_date
       and (d.valid_to is null or d.valid_to > current_date)
     where m.tenant_id = p_tenant)
$$;
revoke all on function app.a_un_comptable_interne(uuid) from public;
grant execute on function app.a_un_comptable_interne(uuid) to authenticated;

-- Un mandat externe en vigueur sur la société.
create function app.mandat_externe_en_vigueur(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from identity.engagements g
                  where g.pme_org_id = p_tenant
                    and app.engagement_en_vigueur(g.status, g.starts_on, g.ends_on))
$$;
revoke all on function app.mandat_externe_en_vigueur(uuid) from public;
grant execute on function app.mandat_externe_en_vigueur(uuid) to authenticated;

-- Les livres sont tenus par une comptabilité — externe, ou interne.
create or replace function app.livres_tenus_par_le_cabinet(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.mandat_externe_en_vigueur(p_tenant) or app.a_un_comptable_interne(p_tenant)
$$;

-- Valider : l'expert ou le collaborateur affecté du cabinet engagé, ou le
-- comptable interne quand aucune comptabilité externe n'est en vigueur.
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
     where e.pme_org_id = p_tenant
       and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
       and (app.has_org_role(e.cabinet_org_id, array['expert'])
            or (app.has_org_role(e.cabinet_org_id, array['collaborateur'])
                and exists (select 1 from collab.assignments a
                             where a.cabinet_tenant_id = e.cabinet_org_id
                               and a.client_tenant_id = p_tenant
                               and a.collaborator_id = auth.uid()
                               and a.active))))
  or (p_tenant in (select app.dossiers_du_comptable_interne())
      and not app.mandat_externe_en_vigueur(p_tenant))
$$;

-- Préparer : qui valide, et le comptable interne en toute circonstance.
create function app.prepare_le_dossier(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.supervise_le_dossier(p_tenant)
      or p_tenant in (select app.dossiers_du_comptable_interne())
$$;
revoke all on function app.prepare_le_dossier(uuid) from public;
grant execute on function app.prepare_le_dossier(uuid) to authenticated;

-- 4. Ce qu'il lit : ce qu'une comptabilité engagée lit du dossier ---------

create or replace function app.engaged_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and (select app.service()) is null
     and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
     and (
       app.has_org_role(e.cabinet_org_id, array['expert'])
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = e.cabinet_org_id
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     )
  union
  select x from app.dossiers_du_comptable_interne() x
$$;

-- Les exports : la comptabilité exporte ses mandats ; le comptable interne,
-- sa société (cabinet = client = la société).
create or replace function app.export_mandats(p_cabinet uuid, p_client uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_interne boolean := p_client is not null and p_client = p_cabinet
                       and p_client in (select app.dossiers_du_comptable_interne());
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'refus.introuvable.cabinet' using errcode = '42501';
  end if;
  if p_client is not null and not v_interne and not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)) then
    raise exception 'refus.introuvable.dossier' using errcode = '42501';
  end if;
  if p_client is not null then
    perform app.exiger_licence_active(p_client, 'export');
  end if;
  return query
    select e.pme_org_id
      from identity.engagements e
     where e.cabinet_org_id = p_cabinet
       and (p_client is null or e.pme_org_id = p_client)
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)
       and app.licence_active(e.pme_org_id)
    union
    select p_client where v_interne and app.licence_active(p_client);
end
$$;

-- Les portes qui préparent lisent `prepare_le_dossier` ; celles qui tranchent
-- (`socle_ecriture_book`, `socle_ecriture_review`, `piece_retourner`)
-- gardent `supervise_le_dossier` et `peut_superviser`, inchangées.

CREATE OR REPLACE FUNCTION public.piece_type_etabli_par_le_cabinet(p_piece uuid, p_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_type   text;
  v_statut text;
  v_retenu text;
  v_id     uuid;
begin
  select tenant_id, vis, document_kind, document_kind_statut
    into v_tenant, v_vis, v_type, v_statut
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if not app.prepare_le_dossier(v_tenant) then
    raise exception 'refus.supervision.reservee'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  v_retenu := coalesce(nullif(btrim(p_type), ''), v_type);
  if v_retenu is null then
    raise exception 'refus.inscription.type_inconnu' using errcode = 'check_violation';
  end if;
  if v_statut = 'confirme' and v_retenu = v_type then
    return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', true);
  end if;
  -- Un type qui ne porte pas d'écriture ne s'établit pas pour en inscrire une.
  if not exists (select 1 from ref.document_types d
                  where d.code = v_retenu and d.porte_ecriture) then
    raise exception 'refus.inscription.type_sans_ecriture' using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, 'document_kind', v_retenu)
  returning id into v_id;

  update capture.pieces
     set document_kind = v_retenu, document_kind_statut = 'confirme', updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', 'document_kind', 'valeur', v_retenu,
                             'avant', v_type, 'par_le_cabinet', true));

  return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', false);
end
$function$;

CREATE OR REPLACE FUNCTION public.capture_precision_persist(p_piece uuid, p_champ text, p_valeur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_status text;
  v_avant  text;
  v_statut text;
  v_id uuid;
  v_date date;
  v_nom  text;
  v_lu   text;
begin
  select tenant_id, status, document_kind, document_kind_statut
    into v_tenant, v_status, v_avant, v_statut
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'refus.precision.engagee'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après, et derrière les
    -- deux portes, les types précis (planche 3).
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur
                      and (d.propose_a_la_capture or d.propose_en_correction)) then
      raise exception '%', app.refus_avec_valeurs('refus.precision.type_non_propose', 'type', (p_valeur)::text) using errcode = 'check_violation';
    end if;
    -- Le sens (un type qui porte une écriture) est l'acte du cabinet quand il
    -- tient les livres : la PME ne le pose pas, et ne défait pas celui qu'une
    -- personne a établi.
    if app.livres_tenus_par_le_cabinet(v_tenant)
       and not app.prepare_le_dossier(v_tenant)
       and (exists (select 1 from ref.document_types d
                     where d.code = p_valeur and d.porte_ecriture)
            or (v_statut = 'confirme'
                and exists (select 1 from ref.document_types d
                             where d.code = v_avant and d.porte_ecriture))) then
      raise exception 'refus.sens.reserve_au_cabinet'
        using errcode = '42501', hint = 'sens.cabinet';
    end if;
  elsif p_champ = 'document_date' then
    -- Une date qui n'est pas une date lève ici, et non trois écrans plus loin.
    begin
      v_date := p_valeur::date;
    exception when others then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_illisible', 'date', (p_valeur)::text) using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_a_venir', 'date', (p_valeur)::text)
        using errcode = 'check_violation';
    end if;
  elsif p_champ = 'issuer' then
    -- Le nom de l'émetteur, tel que la personne le lit sur sa pièce : le
    -- logo lu « MITEK » quand la facture imprime « MyTek ». Les blancs se
    -- resserrent ; un nom vide n'est pas un nom.
    v_nom := btrim(regexp_replace(coalesce(p_valeur, ''), '\s+', ' ', 'g'));
    if v_nom = '' then
      raise exception 'refus.precision.nom_vide' using errcode = 'check_violation';
    end if;
    -- Borne technique d'une saisie (pas une règle métier) : un nom de société
    -- tient sur une ligne de journal.
    if length(v_nom) > 200 then
      raise exception '%', app.refus_avec_valeurs('refus.precision.nom_trop_long', 'max', '200')
        using errcode = 'check_violation';
    end if;
    -- Ce qui était retenu avant : la dernière correction, sinon la lecture.
    v_lu := coalesce(app.emetteur_dit(p_piece),
                     (select x.payload ->> 'issuer' from capture.extractions x
                       where x.piece_id = p_piece order by x.created_at desc limit 1));
    if v_lu is not distinct from v_nom then
      -- Redire le même nom n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  elsif app.est_un_champ_de_lecture(p_champ) then
    -- Un montant ou un mot de la facture, tel que la personne le lit sur sa
    -- pièce : la base borne la saisie (devise, décimales), le moteur rejuge.
    v_nom := app.precision_de_lecture(p_piece, p_champ, p_valeur);
    v_lu := app.precision_avant(p_piece, p_champ);
    if app.precision_dite(p_piece, p_champ) is not distinct from v_nom then
      -- Redire la même valeur n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  else
    raise exception '%', app.refus_avec_valeurs('refus.precision.champ', 'champ', (p_champ)::text) using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, coalesce(v_nom, p_valeur))
  returning id into v_id;

  -- La personne a tranché : la pièce porte le type, confirmé, et c'est ce que
  -- le verrou R2 attend avant toute écriture. Une date précisée ne touche pas
  -- au type.
  if p_champ = 'document_kind' then
    update capture.pieces
       set document_kind = p_valeur,
           document_kind_statut = 'confirme',
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ,
                             'valeur', coalesce(v_nom, p_valeur))
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant)
                  when p_champ = 'issuer' or app.est_un_champ_de_lecture(p_champ)
                  then jsonb_build_object('avant', v_lu) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', coalesce(v_nom, p_valeur));
end
$function$;

CREATE OR REPLACE FUNCTION app.pieces_de_la_liste(p_tenants uuid[])
 RETURNS TABLE(piece_id uuid, a_une_histoire boolean, a_une_lecture boolean, payload jsonb, precision_kind text, emetteur_dit text, circuit_recoit boolean, circuit_dernier text, circuit_envoyee timestamp with time zone, circuit_vue_le timestamp with time zone, circuit_vue_par text, circuit_retournee timestamp with time zone, circuit_retour_par text, circuit_corrigee timestamp with time zone, circuit_auteur text, circuit_mienne boolean, suivi_envoyee timestamp with time zone, suivi_vue_le timestamp with time zone, suivi_vue_par text, suivi_corrigee timestamp with time zone, suivi_prise_le timestamp with time zone, suivi_prise text, suivi_prise_par text)
 LANGUAGE sql
 STABLE SECURITY DEFINER ROWS 5000
 SET search_path TO ''
AS $function$
  with membres as materialized (
    select m as tenant_id from app.member_orgs() m
  ),
  -- Une fois par société : seules celles qui ont au moins une pièce.
  droits as materialized (
    select t.tenant_id,
           t.tenant_id in (select tenant_id from membres) as membre,
           t.tenant_id in (select app.engaged_orgs()) as engage,
           coalesce(t.tenant_id in (select app.orgs_avec_droit('societe.tout_voir')), false)
             as tout_voir,
           coalesce(t.tenant_id in (select app.orgs_avec_droit('circuit.recevoir')), false)
             as recoit,
           app.plateforme_requise(t.tenant_id) as requise,
           t.tenant_id in (select tenant_id from membres)
             and not app.prepare_le_dossier(t.tenant_id) as client
      from (select distinct p.tenant_id from capture.pieces p
             where p.tenant_id = any(p_tenants)) t
  ),
  ayant_une_histoire as materialized (
    select h as id from app.pieces_avec_historique(p_tenants) h
  ),
  -- Celles que la liste montre, ni archivées ni remplacées, et la règle de
  -- `app.piece_lisible` pour celles-là.
  lisibles as materialized (
    select p.id, p.tenant_id, p.vis, p.created_by, p.created_at, p.transmise_le,
           d.membre, d.recoit, d.client,
           p.id in (select id from ayant_une_histoire) as a_une_histoire
      from capture.pieces p
      join droits d on d.tenant_id = p.tenant_id
     where p.tenant_id = any(p_tenants)
       and p.archivee_le is null
       and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
       and ((p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
            or (p.vis in ('entite'::app.vis_t, 'partage'::app.vis_t)
                and (d.tout_voir or (d.membre and p.created_by = auth.uid())))
            or (p.vis = 'partage'::app.vis_t and d.engage)
            or d.requise
            or case when app.dossier_du_service() is null then false
                    else app.piece_lisible(p.id) end)
  ),
  lectures as (
    select distinct on (e.piece_id) e.piece_id, e.payload
      from capture.extractions e
      join lisibles l on l.id = e.piece_id
     where e.contract like 'extract.v1%'
     order by e.piece_id, e.created_at desc
  ),
  precisions_dites as (
    select distinct on (q.piece_id, q.champ) q.piece_id, q.champ, q.valeur
      from capture.precisions q
      join lisibles l on l.id = q.piece_id
     where q.champ in ('document_kind', 'issuer')
     order by q.piece_id, q.champ, q.decided_at desc
  ),
  cibles as materialized (
    select l.*,
           exists (select 1 from capture.remplacements r where r.remplacee_par = l.id)
             as a_des_versions
      from lisibles l
     where l.a_une_histoire
  ),
  -- Une pièce jamais remplacée n'a qu'une version : elle-même.
  versions as materialized (
    select c.id as piece_id, c.id as version_id from cibles c where not c.a_des_versions
    union all
    select c.id, v from cibles c, app.versions_de_la_piece(c.id) v where c.a_des_versions
  ),
  auteurs as materialized (
    select a.created_by, app.prenom_au_moment(a.created_by) as prenom
      from (select distinct created_by from cibles
             where membre and created_by is not null) a
  ),
  faits as materialized (
    select v.piece_id, f.id, f.fait, f.le, f.par_nom, f.tenant_id
      from versions v
      join capture.circuit f on f.piece_id = v.version_id
  ),
  dernier as (
    select distinct on (f.piece_id) f.piece_id, f.fait
      from faits f
     where f.tenant_id in (select tenant_id from membres)
     order by f.piece_id, f.le desc, f.id desc
  ),
  envois as materialized (
    select f.piece_id, max(f.le) as le from faits f where f.fait = 'envoyee' group by 1
  ),
  retours as (
    select distinct on (f.piece_id) f.piece_id, f.le, f.par_nom
      from faits f
     where f.fait = 'retournee'
     order by f.piece_id, f.le desc
  ),
  vues as materialized (
    select v.piece_id, x.vue_le, x.par_nom, x.cabinet_org_id, x.tenant_id
      from versions v
      join capture.vues x on x.piece_id = v.version_id
  ),
  vue_de_la_societe as (
    select distinct on (x.piece_id) x.piece_id, x.vue_le, x.par_nom
      from vues x
     where x.cabinet_org_id = x.tenant_id
     order by x.piece_id, x.vue_le desc
  ),
  vue_du_cabinet as (
    select distinct on (x.piece_id) x.piece_id, x.vue_le, o.name
      from vues x
      join identity.organizations o on o.id = x.cabinet_org_id
     where x.cabinet_org_id <> x.tenant_id
     order by x.piece_id, x.vue_le desc
  ),
  corrections as materialized (
    select v.piece_id, pr.decided_at as le, pr.decided_by as par, true as precision
      from versions v
      join capture.precisions pr on pr.piece_id = v.version_id
    union all
    select v.piece_id, r.created_at, r.auteur, false
      from versions v
      join capture.remplacements r on r.remplacee_par = v.version_id
  ),
  par_l_auteur as (
    select k.piece_id, max(k.le) as le
      from corrections k
      join cibles c on c.id = k.piece_id
      join envois e on e.piece_id = k.piece_id
     where k.le > e.le and k.par = c.created_by
     group by 1
  ),
  par_le_client as (
    select k.piece_id, max(k.le) as le
      from corrections k
      join cibles c on c.id = k.piece_id
     where k.le > coalesce(c.transmise_le, c.created_at)
       and (not k.precision
            or exists (select 1 from identity.memberships m
                        where m.tenant_id = c.tenant_id and m.user_id = k.par))
     group by 1
  ),
  renvois as (
    select v.piece_id, max(a.at) as le
      from versions v
      join audit.event_log a on a.object_id = v.version_id
     where a.object_table = 'pieces' and a.action = 'piece.renvoyee'
     group by 1
  ),
  prises as materialized (
    select distinct on (v.piece_id) v.piece_id, e.id as ecriture_id, pc.tenant_id as cabinet,
           pc.prise_le, pc.par_nom
      from versions v
      join socle.ecritures e on e.piece_id = v.version_id
      join socle.prises_en_charge pc on pc.ecriture_id = e.id
     where e.nature = 'piece'
       and e.status = 'booked'
       and e.reverses_id is null
       and not exists (select 1 from socle.ecritures r
                        where r.reverses_id = e.id and r.status = 'booked')
     order by v.piece_id, pc.prise_le desc
  ),
  origines as (
    select x.*, o.origine
      from prises x
      left join lateral app.ecriture_prise_en_charge(x.cabinet, x.ecriture_id) o on true
  )
  select l.id, l.a_une_histoire,
         exists (select 1 from capture.extractions e where e.piece_id = l.id),
         lu.payload, qk.valeur, qi.valeur,
         case when c.membre then c.recoit end,
         case when c.membre then d.fait end,
         case when c.membre then e.le end,
         case when c.membre then vs.vue_le end,
         case when c.membre then vs.par_nom end,
         case when c.membre then r.le end,
         case when c.membre then r.par_nom end,
         case when c.membre then pa.le end,
         case when c.membre then a.prenom end,
         case when c.membre then c.created_by is not distinct from auth.uid() end,
         case when c.vis = 'partage'::app.vis_t
              then greatest(coalesce(c.transmise_le, c.created_at), rv.le) end,
         case when c.vis = 'partage'::app.vis_t then vc.vue_le end,
         case when c.vis = 'partage'::app.vis_t then vc.name end,
         case when c.vis = 'partage'::app.vis_t then pc.le end,
         case when c.vis = 'partage'::app.vis_t then pr.prise_le end,
         case when c.vis = 'partage'::app.vis_t then pr.origine end,
         case when c.vis = 'partage'::app.vis_t and not c.client then pr.par_nom end
    from lisibles l
    left join cibles c on c.id = l.id
    left join lectures lu on lu.piece_id = l.id
    left join precisions_dites qk on qk.piece_id = l.id and qk.champ = 'document_kind'
    left join precisions_dites qi on qi.piece_id = l.id and qi.champ = 'issuer'
    left join dernier d on d.piece_id = c.id
    left join envois e on e.piece_id = c.id
    left join retours r on r.piece_id = c.id
    left join vue_de_la_societe vs on vs.piece_id = c.id
    left join vue_du_cabinet vc on vc.piece_id = c.id
    left join par_l_auteur pa on pa.piece_id = c.id
    left join par_le_client pc on pc.piece_id = c.id
    left join renvois rv on rv.piece_id = c.id
    left join auteurs a on a.created_by = c.created_by
    left join origines pr on pr.piece_id = c.id
$function$;

CREATE OR REPLACE FUNCTION app.suivi_de_la_piece(p_piece uuid)
 RETURNS TABLE(envoyee_le timestamp with time zone, vue_le timestamp with time zone, vue_par text, corrigee_le timestamp with time zone, prise_le timestamp with time zone, prise text, prise_par text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_client boolean;
  v_ecriture uuid;
  v_cabinet  uuid;
begin
  if not app.piece_lisible(p_piece) then
    return;
  end if;
  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = app.version_courante(p_piece);
  -- Client SEULEMENT : membre de la société sans superviser son dossier.
  v_client := v_tenant in (select app.member_orgs())
              and not app.prepare_le_dossier(v_tenant);

  if v_vis = 'partage'::app.vis_t then
    envoyee_le := app.dernier_envoi(p_piece);
  end if;

  select v.vue_le, o.name into vue_le, vue_par
    from capture.vues v
    join identity.organizations o on o.id = v.cabinet_org_id
   where v.piece_id = any(array(select app.versions_de_la_piece(p_piece)))
     -- La vue d'un propriétaire (lot 4) n'est pas celle du cabinet.
     and v.cabinet_org_id <> v.tenant_id
   order by v.vue_le desc
   limit 1;

  corrigee_le := app.corrigee_par_le_client(p_piece);

  -- La pièce est jugée lisible plus haut : pas une seconde fois.
  v_ecriture := app.ecriture_prise_en_charge_lue(p_piece);
  if v_ecriture is not null then
    select pc.tenant_id, pc.prise_le, pc.par_nom
      into v_cabinet, prise_le, prise_par
      from socle.prises_en_charge pc
     where pc.ecriture_id = v_ecriture
     order by pc.prise_le desc
     limit 1;
    select x.origine into prise from app.ecriture_prise_en_charge(v_cabinet, v_ecriture) x;
  end if;
  -- Le client lit « Prise en charge » ; le nom du comptable reste au cabinet.
  if v_client then
    prise_par := null;
  end if;

  return next;
end
$function$;

CREATE OR REPLACE FUNCTION app.les_ecritures_du_cabinet_sont_a_lui()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.nature <> 'reglement'
     and app.livres_tenus_par_le_cabinet(new.tenant_id)
     and new.tenant_id in (select app.member_orgs())
     and not app.prepare_le_dossier(new.tenant_id) then
    raise exception 'refus.inscription.reservee_au_cabinet'
      using errcode = '42501', hint = 'inscription.cabinet';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.grille_publier(p_effective_from date, p_offres jsonb, p_recharges jsonb, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_trous jsonb;
  v_id    uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'detail', t.detail)), '[]')
    into v_trous
    from plateforme.grille_trous(p_effective_from, p_offres, p_recharges) t;
  if jsonb_array_length(v_trous) > 0 then
    raise exception '%', app.refus_avec_valeurs('refus.grille.trous', 'trous', (v_trous)::text) using errcode = 'check_violation';
  end if;

  insert into ref.offres
    (code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max,
     prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max,
     prix_organisation_sup, rang, recharges_permises, places_comptable_incluses,
     effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_mensuel_ht')::numeric,
         (e ->> 'lectures_par_organisation')::int, (e ->> 'sieges_inclus')::int,
         (e ->> 'sieges_max')::int, coalesce((e ->> 'prix_siege_sup')::numeric, 0),
         coalesce((e ->> 'lectures_par_siege_sup')::int, 0),
         coalesce((e ->> 'organisations_incluses')::int, 1), (e ->> 'organisations_max')::int,
         coalesce((e ->> 'prix_organisation_sup')::numeric, 0), (e ->> 'rang')::int,
         coalesce((e ->> 'recharges_permises')::boolean, true),
         (e ->> 'places_comptable_incluses')::int, p_effective_from
    from jsonb_array_elements(p_offres) e;

  insert into ref.recharges (code, libelle, prix_ht, lectures, validite_mois, rang, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_ht')::numeric, (e ->> 'lectures')::int,
         (e ->> 'validite_mois')::int, (e ->> 'rang')::int, p_effective_from
    from jsonb_array_elements(coalesce(p_recharges, '[]'::jsonb)) e;

  insert into plateforme.grilles_publiees (effective_from, offres, recharges, motif, publie_par)
  values (p_effective_from, p_offres, coalesce(p_recharges, '[]'::jsonb), p_motif, auth.uid())
  returning id into v_id;

  return jsonb_build_object('grille_id', v_id, 'effective_from', p_effective_from,
                            'offres', jsonb_array_length(p_offres),
                            'recharges', jsonb_array_length(coalesce(p_recharges, '[]'::jsonb)));
end
$function$;

CREATE OR REPLACE FUNCTION plateforme.grille_trous(p_effective_from date, p_offres jsonb, p_recharges jsonb)
 RETURNS TABLE(code text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o       record;
  r       record;
  -- L'offre et le palier précédents, rang après rang (vides au premier).
  p_code  text;
  p_prix  numeric;
  p_lect  integer;
  p_siege integer;
  p_rech  boolean;
  p_compt integer;
  v_marge numeric := 0;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  if p_effective_from is null or p_effective_from <= current_date then
    code := 'date_passee';
    detail := 'une grille se publie pour demain ou plus tard';
    return next;
  end if;

  if jsonb_typeof(p_offres) is distinct from 'array' or jsonb_array_length(p_offres) = 0 then
    code := 'offres_absentes'; detail := 'la grille ne porte aucune offre'; return next;
    return;
  end if;

  -- Une offre connue ne disparaît pas de la grille.
  for o in
    select distinct x.code from ref.offres x
     where not exists (select 1 from jsonb_array_elements(p_offres) e where e ->> 'code' = x.code)
  loop
    code := 'offre_manquante'; detail := o.code; return next;
  end loop;

  for o in
    select e ->> 'rang' as rang, count(*) as n
      from jsonb_array_elements(p_offres) e group by 1 having count(*) > 1
  loop
    code := 'rang_double'; detail := o.rang; return next;
  end loop;

  -- Rang après rang : plus cher, plus de lectures, pas moins de personnes, et
  -- une lecture qui revient moins cher.
  p_code := null;
  for o in
    select e ->> 'code' as code,
           (e ->> 'rang')::int as rang,
           (e ->> 'prix_mensuel_ht')::numeric as prix,
           ((e ->> 'lectures_par_organisation')::int
             * coalesce((e ->> 'organisations_incluses')::int, 1)) as lectures,
           (e ->> 'sieges_inclus')::int as sieges,
           (e ->> 'sieges_max')::int as sieges_max,
           coalesce((e ->> 'recharges_permises')::boolean, true) as recharges,
           (e ->> 'places_comptable_incluses')::int as comptable
      from jsonb_array_elements(p_offres) e
     order by (e ->> 'rang')::int
  loop
    if o.prix is null or o.lectures is null or o.lectures <= 0 or o.sieges is null then
      code := 'offre_incomplete'; detail := o.code; return next;
      continue;
    end if;
    -- La place « comptable » est comprise dans chaque offre, dès la première
    -- (décision du 12 novembre 2026, 7.2) : une offre qui n'en porte pas a un
    -- trou, et une offre supérieure n'en donne jamais moins.
    if o.comptable is null or o.comptable < 1 then
      code := 'place_comptable_absente'; detail := o.code; return next;
    elsif p_code is not null and p_compt is not null and o.comptable < p_compt then
      code := 'places_comptable_decroissantes'; detail := p_code || ' -> ' || o.code;
      return next;
    end if;
    if o.sieges_max is not null and o.sieges_max < o.sieges then
      code := 'places_incoherentes'; detail := o.code; return next;
    end if;
    if p_code is not null then
      if o.prix <= p_prix then
        code := 'prix_non_croissant'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.lectures <= p_lect then
        code := 'lectures_non_croissantes'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.sieges < p_siege then
        code := 'personnes_decroissantes'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.prix / o.lectures > p_prix / p_lect then
        code := 'monter_coute_plus_a_la_lecture'; detail := p_code || ' -> ' || o.code;
        return next;
      end if;
      -- Ce que coûte une lecture de plus en montant : une recharge ne doit
      -- jamais faire mieux, sur une offre qui admet les recharges.
      if p_rech and o.lectures > p_lect then
        v_marge := greatest(v_marge, (o.prix - p_prix) / (o.lectures - p_lect));
      end if;
    end if;
    p_code := o.code; p_prix := o.prix; p_lect := o.lectures;
    p_siege := o.sieges; p_rech := o.recharges; p_compt := o.comptable;
  end loop;

  -- Les recharges : plus chères et plus grosses rang après rang, la plus
  -- grosse la plus avantageuse, et aucune moins chère que de monter.
  if jsonb_typeof(p_recharges) = 'array' then
    p_code := null;
    for r in
      select e ->> 'code' as code,
             (e ->> 'rang')::int as rang,
             (e ->> 'prix_ht')::numeric as prix,
             (e ->> 'lectures')::int as lectures
        from jsonb_array_elements(p_recharges) e
       order by (e ->> 'rang')::int
    loop
      if r.prix is null or r.prix <= 0 or r.lectures is null or r.lectures <= 0 then
        code := 'recharge_incomplete'; detail := r.code; return next;
        continue;
      end if;
      if r.prix / r.lectures < v_marge then
        code := 'recharge_brule_l_offre_suivante'; detail := r.code; return next;
      end if;
      if p_code is not null then
        if r.prix <= p_prix or r.lectures <= p_lect then
          code := 'paliers_non_croissants'; detail := p_code || ' -> ' || r.code; return next;
        end if;
        if r.prix / r.lectures > p_prix / p_lect then
          code := 'gros_palier_moins_avantageux'; detail := p_code || ' -> ' || r.code;
          return next;
        end if;
      end if;
      p_code := r.code; p_prix := r.prix; p_lect := r.lectures;
    end loop;
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION facturation.place_disponible()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence   uuid;
  v_titulaire uuid;
  v_max       smallint;
begin
  -- Un membre de cabinet (`expert`) n'est pas un siège du client : il entre
  -- par le mandat, pas par le forfait de la PME.
  if new.role = 'expert' then
    return new;
  end if;

  -- Le comptable interne occupe la place « comptable » comprise dans l'offre
  -- (7.2) : jamais une place payante, et jamais plus que l'offre n'en donne.
  if new.role = 'comptable' then
    perform facturation.place_comptable_exiger(new.tenant_id, new.user_id, null);
    return new;
  end if;

  v_licence := facturation.licence_de(new.tenant_id);

  -- Une organisation sans licence est une organisation en cours de création,
  -- ou un cabinet : son créateur y entre, la licence naît juste après
  -- (`20261022100000`).
  if v_licence is null then
    return new;
  end if;

  -- Le propriétaire principal est dans le prix de l'offre.
  select l.titulaire into v_titulaire from facturation.licences l where l.id = v_licence;
  if new.user_id = v_titulaire then
    return new;
  end if;

  -- La personne déjà présente ailleurs dans le groupe n'occupe pas une place
  -- de plus : on ne compte que les personnes nouvelles.
  if exists (
    select 1
    from facturation.licence_organisations lo
    join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = v_licence
      and m.user_id = new.user_id
      and m.role in ('dirigeant', 'collaborateur', 'assistant')
  ) then
    return new;
  end if;

  select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;

  -- `sieges_max` vide : sans plafond (20261022090000).
  if v_max is not null and facturation.places_occupees(v_licence) >= v_max then
    raise exception
      '%', app.refus_avec_valeurs('refus.place.offre_pleine', 'places', (v_max)::text)
      using errcode = 'check_violation',
            hint = 'Passer à l''offre supérieure, ou libérer une place.';
  end if;

  return new;
end
$function$;

