-- ======================================================================
--  Les notifications se lisent d'un trait (9 novembre 2026).
--
--  Mesuré sur le serveur d'essai, 113 sociétés : 846 notifications en 4,2 à
--  4,7 s, et jusqu'à 5,9 s au chargement. La politique de lecture appelle
--  `app.notification_lisible` à chaque ligne, qui rejoue le droit de la pièce
--  citée : `app.piece_lisible`, plusieurs millisecondes par notification.
--
--  Cette fonction rend la même liste (toutes les non lues et les cent
--  dernières), en une lecture : les droits une fois, chaque pièce citée une
--  fois. `app.notification_lisible` reste la règle : la politique et la
--  notification ouverte seule s'en servent, et elle est l'ORACLE de
--  `la-cloche-dit-la-meme-chose.test.ts`.
--
--  La règle de lecture d'une pièce est portée en ligne pour le cas courant
--  (ni archivée, ni remplacée, pas de dossier de service), comme la politique
--  de `capture.pieces`. Les autres cas appellent `app.piece_lisible`.
-- ======================================================================

begin;

create function app.notifications_des_societes(p_tenants uuid[])
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
           coalesce(app.is_platform(), false) as plateforme
  ),
  membres as materialized (select m as org from app.member_orgs() m),
  engagees as materialized (select e as org from app.engaged_orgs() e),
  toutes_vues as materialized (
    select o as org from app.orgs_avec_droit('societe.tout_voir') o
  ),
  brutes as materialized (
    select n.id, n.tenant_id, n.user_id, n.kind, n.payload, n.created_at, n.read_at,
           app.uuid_ou_null(n.payload ->> 'piece_id') as piece,
           n.tenant_id in (select org from membres) as membre
      from collab.notifications n, moi
     where n.tenant_id = any(p_tenants)
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
$$;

comment on function app.notifications_des_societes(uuid[]) is
  'Les notifications de ces sociétés que l''appelant peut lire — toutes les non lues et les cent dernières — en une lecture : la règle de app.notification_lisible sans la rejouer ligne par ligne.';

revoke all on function app.notifications_des_societes(uuid[]) from public, anon;
grant execute on function app.notifications_des_societes(uuid[]) to authenticated;

commit;
