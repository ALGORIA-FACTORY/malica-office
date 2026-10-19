-- Une licence naît avec sa société.
--
-- ================================================================== POURQUOI
--
-- Relevé le 19 octobre 2026 en cherchant qui crée une licence : PERSONNE.
-- L'inscription, l'ouverture d'une société, l'ouverture d'un dossier par le
-- cabinet, la tour, le jeu de données de recette — aucun chemin du produit
-- n'écrit dans `facturation.licences`. Seules les épreuves en insèrent, dans
-- des transactions qu'elles annulent.
--
-- Or `lecture_autorisee` refuse depuis le 18 (`20261018093000`) toute pièce
-- d'une organisation sans licence, avec `organisation_sans_licence`. C'est la
-- bonne règle — « on ne sait pas, donc on refuse, jamais vrai par défaut » —
-- mais avec elle, tout nouveau client photographie une facture et Malica n'en
-- lit rien. Le modèle d'abonnement était complet ; personne n'y entrait.
--
-- `20261018110000` l'avait écrit sans le voir : « le rattachement viendra ».
-- `20261021100000` aussi : « souscrire est un autre geste, il naît ailleurs ».
-- Il ne naissait nulle part.
--
-- ==================================================== UNE FONCTION, TROIS PORTES
--
-- `facturation.licence_naitre` est la seule à faire naître une licence. Elle
-- est idempotente — une société qui en a déjà une la rend telle quelle — et
-- elle n'en fait naître que pour une PME : un cabinet n'est pas abonné à
-- Malica Office, il ouvre des accès (section 10 de `20261020110000`).
--
-- Trois portes font entrer un dirigeant, et les trois l'appellent :
--
--   `create_organization`          le dirigeant crée sa société lui-même ;
--   `invitation_par_lien_accepter` il rejoint, par un lien, la société que
--   `invitation_repondre`           son cabinet a ouverte pour lui.
--
-- Elles sont reprises À L'IDENTIQUE, extraites des migrations d'origine par un
-- script et non recopiées, avec une seule insertion chacune.
--
-- Pas de déclencheur sur `identity.memberships` : il aurait fait naître une
-- licence dans chaque épreuve qui crée une société à la main, juste avant que
-- l'épreuve n'attache la sienne — et une société ne porte qu'une licence.
--
-- ===================================== L'OFFRE DE NAISSANCE EST UNE DONNÉE
--
-- Le dirigeant a tranché : Basic d'office, il change d'offre ensuite. Ce choix
-- vit dans `ref.offres_par_canal.par_defaut`, daté comme le reste de la
-- grille, et non dans la fonction (R4) : le jour où l'essai de quatorze jours
-- existera, c'est une ligne de grille qui changera, pas le code.
--
-- =================================================================== LA PORTE
--
-- `licence_naitre` écrit dans `facturation` en `security definer` : elle nomme
-- donc sa porte (`schema.test.ts`) — le dirigeant de la société, ou un
-- opérateur de la plateforme. Hors de toute session, `auth.uid()` est vide :
-- c'est le rattrapage ci-dessous, et c'est la migration qui décide. Elle n'est
-- de toute façon pas exécutable par `authenticated` : on y entre par une porte.
--
-- ============================================================== LE RATTRAPAGE
--
-- Les sociétés déjà ouvertes reçoivent leur licence Basic, au nom de leur
-- premier dirigeant, datée du 19 — le jour de la grille, ÉCRIT et non calculé
-- (R11). Une société sans dirigeant — dossier ouvert par un cabinet, contact
-- pas encore venu — n'en reçoit pas : sa licence naîtra quand il arrivera, par
-- l'une des deux portes d'invitation.
--
-- Une personne dirigeante de deux PME reçoit deux licences : Basic n'en porte
-- qu'une société. `mon_forfait()` lève alors `21000` sans organisation
-- précisée — l'écran doit passer la société ouverte.
--
-- =================================================== CE QUE ÇA NE FAIT PAS
--
-- L'essai de quatorze jours. L'accès payé par le cabinet pour son client
-- (`facturation.acces`, canal `cabinet`) : une société entrée par son cabinet
-- naît en direct, Basic, comme les autres — que le cabinet prenne la licence
-- à sa charge reste à brancher sur l'accès qui existe.
--
-- ============================================================== REJEU (R11)
--
-- `add column if not exists`, `on conflict do nothing`, `create or replace`.
-- Le rattrapage ne touche que les sociétés SANS licence : rejoué, il ne fait
-- rien. Sur une base neuve, il n'y a aucune société : il ne fait rien non plus.

begin;

-- ------------------------------------------- 1. L'offre de naissance, en donnée
alter table ref.offres_par_canal
  add column if not exists par_defaut boolean not null default false;

comment on column ref.offres_par_canal.par_defaut is
  'L''offre sur laquelle une licence NAIT dans ce canal. Une seule par canal et '
  'par date d''effet (offres_par_canal_un_seul_defaut).';

create unique index if not exists offres_par_canal_un_seul_defaut
  on ref.offres_par_canal (canal, effective_from) where par_defaut;

insert into ref.offres_par_canal
  (canal, offre_code, libre_service, commande_speciale, cabinet_peut_ouvrir,
   par_defaut, effective_from)
values
  ('direct', 'basic',   true, true, false, true,  date '2026-10-19'),
  ('direct', 'solo',    true, true, false, false, date '2026-10-19'),
  ('direct', 'team',    true, true, false, false, date '2026-10-19'),
  ('direct', 'premium', true, true, false, false, date '2026-10-19')
on conflict (canal, offre_code, effective_from) do nothing;

-- ---------------------------------------------- 2. La naissance, écrite une fois
create or replace function facturation.licence_naitre(
  p_tenant uuid, p_titulaire uuid, p_offre text default null,
  p_le date default current_date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_kind    text;
  v_offre   text;
begin
  -- D'ABORD la nature de la société, ENSUITE la porte. Dans l'autre ordre,
  -- un cabinet — dont le créateur est `expert`, jamais `dirigeant` — butait
  -- sur la porte au lieu d'être ignoré, et `create_organization` refusait
  -- d'ouvrir le moindre cabinet. Relevé par les épreuves, pas par la relecture.
  select o.kind into v_kind from identity.organizations o where o.id = p_tenant;
  if v_kind is distinct from 'pme' then
    return null;   -- un cabinet n'est pas abonné : il ouvre des accès.
  end if;

  -- La porte : le dirigeant de la société, ou la plateforme. Sans session
  -- (le rattrapage d'une migration), c'est la migration qui décide.
  if auth.uid() is not null
     and not (app.is_platform() or app.has_org_role(p_tenant, array['dirigeant'])) then
    raise exception 'seul le dirigeant ou la plateforme fait naitre une licence'
      using errcode = '42501';
  end if;

  -- Idempotente : une société ne porte qu'une licence, et la sienne se rend.
  select lo.licence_id into v_licence
    from facturation.licence_organisations lo where lo.tenant_id = p_tenant;
  if v_licence is not null then
    return v_licence;
  end if;

  v_offre := p_offre;
  if v_offre is null then
    select c.offre_code into v_offre
      from ref.offres_par_canal c
     where c.canal = 'direct' and c.par_defaut and c.effective_from <= p_le
     order by c.effective_from desc
     limit 1;
    -- Aucun repli : sans offre de naissance en vigueur, on ne l'invente pas.
    if v_offre is null then
      raise exception 'aucune offre de naissance en vigueur au % sur le canal direct', p_le
        using errcode = '22023';
    end if;
  end if;

  -- Le déclencheur `licences_ouvre_historique` ouvre la première période ;
  -- `rattachement_legitime` vérifie que le titulaire dirige la société.
  insert into facturation.licences (titulaire, offre_code, offre_depuis, origine)
  values (p_titulaire, v_offre, p_le, 'direct')
  returning id into v_licence;

  insert into facturation.licence_organisations (licence_id, tenant_id)
  values (v_licence, p_tenant);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, coalesce(auth.uid(), p_titulaire), 'licence.nee', 'facturation',
          'licences', v_licence, jsonb_build_object('offre', v_offre, 'depuis', p_le));

  return v_licence;
end
$$;

revoke all on function facturation.licence_naitre(uuid, uuid, text, date)
  from public, anon, authenticated;

comment on function facturation.licence_naitre(uuid, uuid, text, date) is
  'La seule naissance d''une licence. Idempotente, PME seulement, offre de '
  'naissance lue dans la grille. Appelée par les trois portes d''un dirigeant.';

-- ----------------------------------------- 3. Les trois portes l'appellent

create or replace function public.create_organization(
  p_kind text,
  p_name text,
  p_validation_mode app.validation_mode_t default 'mandate'::app.validation_mode_t,
  p_legal_id text default null,
  p_jurisdiction text default null,
  p_currency text default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_role text;
  v_refus text;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  if p_kind not in ('pme','cabinet') then
    raise exception 'kind invalide' using errcode = '22023';
  end if;

  -- Le défaut n'est pas supprimé, il est DÉPLACÉ vers le référentiel : à
  -- juridiction connue, la devise se déduit du pack. Ce qui disparaît, c'est la
  -- constante — pas la commodité.
  if p_jurisdiction is null then
    raise exception 'juridiction requise' using errcode = '22023';
  end if;
  if p_currency is null then
    select p.currency into p_currency
      from ref.jurisdiction_packs p
     where p.jurisdiction = p_jurisdiction
       and p.effective_from <= current_date
     order by p.effective_from desc
     limit 1;
    if p_currency is null then
      raise exception 'aucun pack en vigueur pour la juridiction %', p_jurisdiction
        using errcode = '22023';
    end if;
  end if;

  -- Les espaces autour viennent du copier-coller et ne changent pas la valeur :
  -- refuser pour une espace apprend que le produit est tatillon, pas qu'on
  -- s'est trompé.
  p_legal_id := nullif(btrim(coalesce(p_legal_id, '')), '');

  v_refus := public.identifiant_verifier(p_jurisdiction, 'matricule_fiscal', p_legal_id);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- On accepte large, on range net : la pièce imprime des capitales, et le
  -- contrôle du destinataire compare la fiche à ce qu'elle imprime.
  p_legal_id := upper(p_legal_id);

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by)
  values (p_kind, p_name, p_legal_id, p_jurisdiction, p_currency,
          p_validation_mode, v_uid)
  returning id into v_org;

  v_role := case when p_kind = 'cabinet' then 'expert' else 'dirigeant' end;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v_org, v_uid, v_role);

  -- Une PME naît avec sa licence (20261022100000). Un cabinet n'en a pas :
  -- `licence_naitre` rend vide pour lui, sans lever.
  perform facturation.licence_naitre(v_org, v_uid, null, current_date);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end
$function$;

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
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  select id, tenant_id, email, role, expires_at, accepted_at, revoked_at into v
    from identity.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if v.id is null or lower(v.email) <> lower(coalesce(app.mon_email(), '')) then
    raise exception 'invitation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if app.statut_invitation(v.accepted_at, v.revoked_at, v.expires_at) <> 'en_attente' then
    raise exception 'Cette invitation n''est plus valable.' using errcode = '22023';
  end if;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v.tenant_id, auth.uid(), v.role)
  on conflict (tenant_id, user_id) do nothing;
  -- Le dirigeant qui arrive est le titulaire naturel (20261022100000).
  if v.role = 'dirigeant' then
    perform facturation.licence_naitre(v.tenant_id, auth.uid(), null, current_date);
  end if;
  update identity.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v.id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'membre.rejoint', 'identity', 'memberships', v.id,
          jsonb_build_object('role', v.role, 'par', 'lien'));

  return jsonb_build_object('tenantId', v.tenant_id, 'role', v.role);
end $$;

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
    raise exception 'invitation introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v.accepted_at is not null or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'Cette invitation n''est plus valable.' using errcode = '22023';
  end if;

  if p_accepte then
    insert into identity.memberships (tenant_id, user_id, role)
    values (v.tenant_id, auth.uid(), v.role)
    on conflict (tenant_id, user_id) do nothing;
    -- Le dirigeant qui arrive est le titulaire naturel (20261022100000).
    if v.role = 'dirigeant' then
      perform facturation.licence_naitre(v.tenant_id, auth.uid(), null, current_date);
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
end $$;

-- ------------------------------------------------------ 4. Le rattrapage
do $$
declare
  r record;
begin
  for r in
    select o.id as tenant_id,
           (select m.user_id from identity.memberships m
             where m.tenant_id = o.id and m.role = 'dirigeant'
             order by m.created_at, m.id
             limit 1) as dirigeant
      from identity.organizations o
     where o.kind = 'pme'
       and not exists (select 1 from facturation.licence_organisations lo
                        where lo.tenant_id = o.id)
  loop
    continue when r.dirigeant is null;
    perform facturation.licence_naitre(r.tenant_id, r.dirigeant, null, date '2026-10-19');
  end loop;
end
$$;

commit;
