-- ======================================================================
--  Un retour, une notification, un mandat : chacun reste à la comptabilité
--  qui l'a écrit (recette du 13 novembre 2026, A5).
--
--  Une société change de comptabilité ; trois choses fuyaient de l'ancienne
--  vers la nouvelle.
--
--  1. LA CLOCHE. `collab.notifications` n'avait que `tenant_id` et `user_id` :
--     toute comptabilité mandatée lisait toutes les notifications de la
--     société, celles écrites pour sa devancière comprises. Elle porte
--     désormais son destinataire `cabinet_id`, posé à l'écriture par un
--     déclencheur (la comptabilité en vigueur, ou celle de l'engagement que
--     nomme la charge) : aucune des portes qui écrivent une notification n'est
--     touchée. Une comptabilité ne lit que ce qui lui est adressé (ou ce qui ne
--     l'est à personne), et rien d'écrit avant le début de SON mandat
--     (`app.notification_du_cabinet`). La politique et la lecture groupée
--     disent la même chose.
--
--  2. LE RETOUR. Une pièce que l'ancienne a retournée attend la réponse du
--     CLIENT ; la nouvelle ne la reprend pas comme la sienne.
--     `capture.conformite.cabinet_id` pose la comptabilité auteure du verdict,
--     et `app.retour_du_cabinet` dit si le retour de la pièce est celui de la
--     comptabilité qui regarde. La pièce reste au client, qui la renvoie ; elle
--     entre alors, comme toute pièce transmise, chez la comptabilité en vigueur.
--
--  3. LA SIGNATURE. `piece_retour` nommait la comptabilité du mandat ACTIF ;
--     elle nomme l'auteure du verdict.
--
--  REJEU (R11) : aucune donnée de référence écrite, aucune date du jour dans le
--  référentiel. Les colonnes sont nulles pour l'historique : les lignes d'avant
--  se jugent par la date (début du mandat).
-- ======================================================================

begin;

-- --- 1. Le destinataire d'une notification ------------------------------------------------------
alter table collab.notifications
  add column cabinet_id uuid references identity.organizations(id);

comment on column collab.notifications.cabinet_id is
  'La comptabilité à qui la notification est adressée, posée à l''écriture ; nulle pour une notification qui n''est adressée à aucune comptabilité.';

create function app.poser_le_destinataire_cabinet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cabinet_id is null then
    new.cabinet_id := coalesce(
      -- La charge nomme son engagement : c'est celui-là, même terminé.
      (select e.cabinet_org_id
         from identity.engagements e
        where e.id = app.uuid_ou_null(new.payload ->> 'engagement_id')
          and e.pme_org_id = new.tenant_id),
      (select e.cabinet_org_id
         from identity.engagements e
        where e.pme_org_id = new.tenant_id
          and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
        order by e.starts_on desc nulls last
        limit 1));
  end if;
  return new;
end
$$;
revoke all on function app.poser_le_destinataire_cabinet() from public, anon, authenticated;

create trigger poser_le_destinataire_cabinet before insert on collab.notifications
  for each row execute function app.poser_le_destinataire_cabinet();

-- Une notification de la société est-elle pour MA comptabilité ? Adressée à
-- elle (ou à personne), et écrite depuis le début de son mandat.
create function app.notification_du_cabinet(p_tenant uuid, p_cabinet uuid, p_cree timestamptz)
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
       and e.cabinet_org_id in (select app.member_orgs())
       and (p_cabinet is null or p_cabinet = e.cabinet_org_id)
       and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
       and (e.starts_on is null or p_cree >= e.starts_on::timestamptz))
$$;
revoke all on function app.notification_du_cabinet(uuid, uuid, timestamptz) from public, anon;
grant execute on function app.notification_du_cabinet(uuid, uuid, timestamptz) to authenticated;

drop policy collab_notifications_sel on collab.notifications;
create policy collab_notifications_sel on collab.notifications
  for select to authenticated
  using (((tenant_id in (select app.member_orgs()))
          and app.notification_lisible(tenant_id, user_id, payload))
         or (tenant_id not in (select app.member_orgs())
             and tenant_id in (select app.engaged_orgs())
             and app.notification_lisible(tenant_id, user_id, payload)
             and app.notification_du_cabinet(tenant_id, cabinet_id, created_at))
         or (select app.is_platform()));

-- La lecture groupée dit la même chose que la politique.
create or replace function app.notifications_des_societes(p_tenants uuid[])
returns table (
  id         uuid,
  tenant_id  uuid,
  kind       text,
  payload    jsonb,
  created_at timestamptz,
  read_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
rows 500
as $$
  with moi as materialized (
    select auth.uid() as uid,
           app.dossier_du_service() as service,
           coalesce(app.is_platform(), false) as plateforme,
           app.service() as compte_de_service
  ),
  membres as materialized (select m as org from app.member_orgs() m),
  engagees as materialized (select e as org from app.engaged_orgs() e),
  toutes_vues as materialized (
    select o as org from app.orgs_avec_droit('societe.tout_voir') o
  ),
  brutes as materialized (
    select n.id, n.tenant_id, n.user_id, n.cabinet_id, n.kind, n.payload, n.created_at, n.read_at,
           app.uuid_ou_null(n.payload ->> 'piece_id') as piece,
           n.tenant_id in (select org from membres) as membre
      from collab.notifications n, moi
     where n.tenant_id = any(p_tenants)
       -- Un compte de service ne lit pas la cloche : `security definer` passe
       -- outre la politique restrictive `service_hors_perimetre`, qui le dit
       -- pour la table (20261118100000).
       and moi.compte_de_service is null
       and (moi.plateforme
            or n.tenant_id in (select org from membres)
            or n.tenant_id in (select org from engagees))
  ),
  citees as materialized (
    select p.id, p.tenant_id, p.vis, p.created_by, p.archivee_le,
           exists (select 1 from capture.remplacements r where r.piece_id = p.id
                   union all
                   select 1 from capture.remplacements r where r.remplacee_par = p.id)
             as a_des_versions
      from capture.pieces p
     where p.id in (select piece from brutes where piece is not null)
  ),
  societes_citees as materialized (
    select t.tenant_id,
           t.tenant_id in (select org from membres) as membre,
           t.tenant_id in (select org from engagees) as engage,
           t.tenant_id in (select org from toutes_vues) as tout_voir,
           app.plateforme_requise(t.tenant_id) as requise
      from (select distinct c.tenant_id from citees c) t
  ),
  lisibilite as materialized (
    select c.id,
           case
             when c.archivee_le is null and not c.a_des_versions and m.service is null then
                  (c.vis = 'personnel'::app.vis_t and c.created_by = m.uid)
               or (c.vis in ('entite'::app.vis_t, 'partage'::app.vis_t)
                   and (d.tout_voir or (d.membre and c.created_by = m.uid)))
               or (c.vis = 'partage'::app.vis_t and d.engage)
               or d.requise
             else app.piece_lisible(c.id)
           end as lisible
      from citees c
      join societes_citees d on d.tenant_id = c.tenant_id
      cross join moi m
  ),
  visibles as (
    select b.*,
           row_number() over (order by b.created_at desc, b.id) as rang,
           coalesce(lu.lu_le, case when b.membre then b.read_at end) as lue_le
      from brutes b
      cross join moi m
      left join lisibilite l on l.id = b.piece
      left join collab.notification_lectures lu
             on lu.tenant_id = b.tenant_id
            and lu.notification_id = b.id
            and lu.user_id = m.uid
     where m.plateforme
        or case
             when b.user_id is not null then b.user_id = m.uid
             when not b.membre then
               coalesce(b.payload ->> 'chez', '') <> 'proprietaire'
               -- Adressée à une autre comptabilité, ou écrite avant le début de
               -- MON mandat : elle n'est pas pour moi.
               and app.notification_du_cabinet(b.tenant_id, b.cabinet_id, b.created_at)
               and case
                     when l.id is null then true
                     when l.lisible then true
                     else app.piece_connue_du_cabinet(l.id)
                   end
             when b.piece is not null then
               case when l.id is not null then l.lisible
                    else b.tenant_id in (select org from toutes_vues) end
             else true
           end
  )
  select v.id, v.tenant_id, v.kind, v.payload, v.created_at, v.lue_le
    from visibles v
   where v.lue_le is null or v.rang <= 100
$$;;

-- --- 2. La comptabilité auteure d'un verdict ------------------------------------------------------
alter table capture.conformite
  add column cabinet_id uuid references identity.organizations(id);

comment on column capture.conformite.cabinet_id is
  'La comptabilité qui a rendu le verdict, posée à la décision : celle dont l''auteur est membre et qui a le mandat en vigueur sur la société. Nulle pour un verdict du propriétaire ou d''avant cette colonne.';

create function app.poser_le_cabinet_auteur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cabinet_id is null then
    new.cabinet_id := (
      select e.cabinet_org_id
        from identity.engagements e
        join identity.memberships m on m.tenant_id = e.cabinet_org_id and m.user_id = new.decided_by
       where e.pme_org_id = new.tenant_id
         and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
       order by e.starts_on desc nulls last
       limit 1);
  end if;
  return new;
end
$$;
revoke all on function app.poser_le_cabinet_auteur() from public, anon, authenticated;

create trigger poser_le_cabinet_auteur before insert on capture.conformite
  for each row execute function app.poser_le_cabinet_auteur();

-- Le retour en cours de la pièce est-il celui de la comptabilité `p_cabinet` ?
-- Vrai sans verdict « à corriger » (rien à départager), vrai si elle l'a rendu,
-- faux s'il est d'une autre. Un verdict d'avant `cabinet_id` se juge par la
-- date : rendu avant le début du mandat de `p_cabinet`, il n'est pas le sien.
create function app.retour_du_cabinet(p_piece uuid, p_cabinet uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive versions(id) as (
    select p_piece
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  ),
  dernier as (
    select c.cabinet_id, c.decided_at
      from capture.conformite c join versions v on v.id = c.piece_id
     where c.verdict = 'a_corriger'::app.verdict_t
     order by c.decided_at desc
     limit 1
  )
  select coalesce((
    select case
             when d.cabinet_id is not null then d.cabinet_id = p_cabinet
             else coalesce((select d.decided_at >= e.starts_on::timestamptz
                              from identity.engagements e
                              join capture.pieces p on p.id = p_piece
                             where e.pme_org_id = p.tenant_id and e.cabinet_org_id = p_cabinet
                               and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
                               and e.starts_on is not null
                             limit 1), true)
           end
      from dernier d), true)
$$;
revoke all on function app.retour_du_cabinet(uuid, uuid) from public, anon;
grant execute on function app.retour_du_cabinet(uuid, uuid) to authenticated;

-- --- 3. Le retour se signe de son auteure ---------------------------------------------------------
create or replace function public.piece_retour(p_piece uuid, p_locale text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with recursive p as (
    select id, tenant_id, status, vis from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
       and app.piece_lisible(p_piece)
       and not exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
  ),
  versions(id) as (
    select id from p
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  ),
  du_proprietaire as (
    select f.le as decided_at, f.note, f.motif_id, f.par_nom as qui
      from app.dernier_fait_du_circuit(p_piece) f, p
     where p.vis = 'entite'::app.vis_t and f.fait = 'retournee'
  ),
  du_cabinet as (
    select c.decided_at, c.note, c.motif_id,
           -- Le verdict se signe de la comptabilité qui l'a rendu (`cabinet_id`,
           -- posé à la décision), jamais de celle qui est mandatée aujourd'hui.
           -- Un verdict d'avant cette colonne se signe de la comptabilité dont
           -- le mandat couvrait le jour de la décision.
           coalesce(
             (select o.name from identity.organizations o where o.id = c.cabinet_id),
             (select o.name
                from identity.engagements e
                join identity.organizations o on o.id = e.cabinet_org_id
               where e.pme_org_id = (select tenant_id from p)
                 and e.starts_on <= c.decided_at::date
                 and (e.ends_on is null or e.ends_on >= c.decided_at::date)
               order by e.starts_on desc nulls last limit 1)) as qui
      from capture.conformite c join versions v on v.id = c.piece_id
     where c.verdict = 'a_corriger'::app.verdict_t
       and (select status from p) = 'retournee'
       and (select vis from p) = 'partage'::app.vis_t
     order by c.decided_at desc limit 1
  ),
  c as (
    select *, 'proprietaire'::text as chez from du_proprietaire
    union all
    select *, 'cabinet'::text from du_cabinet
  )
  select jsonb_build_object(
      'le', c.decided_at,
      'note', c.note,
      'motif', m.code,
      'motifLibelle', coalesce(l.value, lf.value, m.code),
      'geste', m.geste,
      'chez', c.chez,
      'qui', c.qui,
      'fait', case m.preuve
        when 'aucune' then true
        when 'rattachement' then exists (
          select 1 from public.rattachements_v r join versions v
              on v.id in (r.piece_id, r.piece_liee_id)
           where r.fait = 'rattache'
             and r.created_at > c.decided_at)
          or (m.geste = 'reprendre_photo' and exists (
          select 1 from capture.remplacements r join versions v on v.id = r.remplacee_par
           where r.created_at > c.decided_at))
        when 'precision' then exists (
          select 1 from capture.precisions pr join versions v on v.id = pr.piece_id
           where pr.champ = 'document_date'
             and pr.decided_at > c.decided_at)
        when 'reponse' then exists (
          select 1 from audit.event_log ev join versions v on v.id = ev.object_id
           where ev.action = 'piece.reponse_client'
             and ev.at > c.decided_at)
        else false end)
    from c
    join ref.rejet_motifs m on m.id = c.motif_id
    left join ref.labels l on l.ns = 'rejet_motif' and l.key = m.code and l.locale = p_locale
    left join ref.labels lf on lf.ns = 'rejet_motif' and lf.key = m.code and lf.locale = 'fr'
   limit 1
$function$;

revoke all on function public.piece_retour(uuid, text) from public, anon;
grant execute on function public.piece_retour(uuid, text) to authenticated;

commit;
