-- La Tour confie une organisation sans dirigeant, et archive une organisation.
--
-- Recette du 4 novembre 2026. La société réelle d'ALGORIA (ALGORIA FACTORY
-- SARL, matricule 1958330V/A/M/000) existait sur staging comme ÉMETTEUR des
-- factures Malica, sans aucun membre. Le dirigeant travaillait dans un doublon
-- d'essai (ALGORIA FACTORY SUARL, matricule fictif). Aucun geste du produit ne
-- permettait de rattacher un dirigeant à une organisation qui n'en a pas —
-- l'invitation exige un dirigeant — ni de retirer un doublon : il fallait
-- écrire en base à la main, ce que le produit refuse (« toute écriture passe
-- par une porte »).
--
-- Ce que ce fichier pose, deux portes de la plateforme, journalisées :
--
--   1. `plateforme_organisation_confier(org, email)` : une société SANS AUCUN
--      membre reçoit son premier dirigeant (un compte existant), et sa
--      licence naît à son nom (`facturation.licence_naitre`). Une société qui
--      a déjà un membre ne se confie pas : ses dirigeants invitent.
--
--   2. `plateforme_organisation_archiver(org, motif)` : la société sort du
--      produit sans rien effacer (R7) — ses pièces, écritures et factures
--      restent lisibles dans l'historique. Son mandat actif se termine, et
--      l'accès que son cabinet couvrait avec lui (« fin du mandat »). Le
--      matricule redevient libre (`un_matricule_une_societe` ignore une
--      société archivée). L'émetteur des factures en vigueur ne s'archive pas.
--
-- Les deux exigent la plateforme (`app.is_platform`) et un motif ou une
-- adresse ; rien d'autre ne change de sens.

begin;

-- --- 1. Confier une organisation sans dirigeant -------------------------------------------------

create or replace function public.plateforme_organisation_confier(p_org uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    text;
  v_archive timestamptz;
  v_user    uuid;
  v_licence uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;

  select o.kind, o.archived_at into v_kind, v_archive
    from identity.organizations o where o.id = p_org for update;
  if v_kind is null or v_archive is not null then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  if v_kind <> 'pme' then
    raise exception 'refus.organisation.pas_une_societe' using errcode = '22023';
  end if;
  if exists (select 1 from identity.memberships m where m.tenant_id = p_org) then
    raise exception 'refus.organisation.deja_dirigee' using errcode = '22023';
  end if;

  select u.id into v_user
    from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_user is null then
    raise exception 'refus.introuvable.compte' using errcode = '22023';
  end if;

  insert into identity.memberships (tenant_id, user_id, role)
  values (p_org, v_user, 'dirigeant');

  -- Sa licence, à son nom : la société ne fonctionne pas sans (le forfait,
  -- les lectures, les accès que propose un cabinet). Idempotente.
  v_licence := facturation.licence_naitre(p_org, v_user);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (p_org, auth.uid(), 'organisation.confiee', 'identity', 'organizations', p_org,
          jsonb_build_object('dirigeant', v_user, 'licence', v_licence));

  return jsonb_build_object('organisation_id', p_org, 'dirigeant', v_user, 'licence', v_licence);
end
$$;
revoke all on function public.plateforme_organisation_confier(uuid, text) from public, anon;
grant execute on function public.plateforme_organisation_confier(uuid, text) to authenticated;

comment on function public.plateforme_organisation_confier(uuid, text) is
  'La plateforme confie une société SANS AUCUN membre à son premier dirigeant (un '
  'compte existant) ; sa licence naît à son nom. Journalisé (organisation.confiee).';

-- --- 2. Archiver une organisation ---------------------------------------------------------------

create or replace function public.plateforme_organisation_archiver(p_org uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nom     text;
  v_kind    text;
  v_archive timestamptz;
  v_motif   text := btrim(coalesce(p_motif, ''));
  v_mandat  record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if v_motif = '' then
    raise exception 'refus.archivage.motif_requis' using errcode = '22023';
  end if;

  select o.name, o.kind, o.archived_at into v_nom, v_kind, v_archive
    from identity.organizations o where o.id = p_org for update;
  if v_nom is null or v_archive is not null then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  -- Une SOCIÉTÉ seulement (revue de #217). Un cabinet archivé garderait ses
  -- mandats, ses membres et l'accès de ses experts aux dossiers clients :
  -- sa sortie demande de rendre chaque mandat, ce que ce geste ne fait pas.
  if v_kind <> 'pme' then
    raise exception 'refus.organisation.pas_une_societe' using errcode = '22023';
  end if;
  -- Les factures Malica partent sous son nom : elle ne s'archive pas tant
  -- qu'elle est l'émetteur en vigueur.
  if exists (select 1 from facturation.emetteurs e
              where e.organisation_id = p_org
                and e.valide_des = (select max(x.valide_des) from facturation.emetteurs x
                                     where x.valide_des <= current_date)) then
    raise exception 'refus.organisation.emettrice' using errcode = '22023';
  end if;

  -- Le mandat actif se termine, et l'accès que son cabinet couvrait avec lui.
  for v_mandat in
    select e.id, e.cabinet_org_id from identity.engagements e
     where e.pme_org_id = p_org and e.status = 'actif' for update
  loop
    update identity.engagements set status = 'termine', ends_on = current_date
     where id = v_mandat.id;
    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_mandat.cabinet_org_id, auth.uid(), 'engagement.termine', 'identity', 'engagements',
            v_mandat.id, jsonb_build_object('pme_org_id', p_org, 'motif', v_motif,
                                            'par', 'archivage'));
  end loop;
  update facturation.acces a
     set statut = 'termine', effet_au = current_date, motif_fin = 'fin_engagement'
   where a.tenant_id = p_org and a.statut in ('actif', 'suspendu');
  -- Une proposition en attente tombe — si la société a une licence : un accès
  -- terminé en porte une (`acces_propose_sans_licence`). Sans licence, elle
  -- reste « proposée » sur une société archivée, que plus personne ne dirige
  -- ni ne voit (revue de #217) : rien ne la facture.
  update facturation.acces a
     set statut = 'termine',
         licence_id = lo.licence_id,
         effet_du = current_date, effet_au = current_date, motif_fin = 'fin_engagement'
    from facturation.licence_organisations lo
   where a.tenant_id = p_org and a.statut = 'propose' and lo.tenant_id = p_org;

  update identity.organizations
     set archived_at = now(), archived_reason = v_motif
   where id = p_org;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  values (p_org, auth.uid(), 'organisation.archivee', 'identity', 'organizations', p_org,
          jsonb_build_object('nom', v_nom, 'motif', v_motif));

  return jsonb_build_object('organisation_id', p_org, 'archivee_le', now());
end
$$;
revoke all on function public.plateforme_organisation_archiver(uuid, text) from public, anon;
grant execute on function public.plateforme_organisation_archiver(uuid, text) to authenticated;

comment on function public.plateforme_organisation_archiver(uuid, text) is
  'La plateforme archive une société (jamais un cabinet), motif à l''appui, sans rien effacer (R7) : '
  'son mandat actif et l''accès de son cabinet se terminent ; son matricule redevient '
  'libre. L''émetteur des factures en vigueur ne s''archive pas. Journalisé.';

commit;
