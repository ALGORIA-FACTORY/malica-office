-- ======================================================================
--  Les pièces qui ont vécu se lisent d'un trait (9 novembre 2026).
--
--  Recette sur téléphone : « le temps de chargement n'est pas world class,
--  la bibliothèque surtout ». Mesuré : 761 pièces réelles sur 113 sociétés,
--  10 à 14 s de serveur, 0,3 s pour les sociétés vides.
--
--  La migration 20261201090000 avait rendu rapides les pièces SANS histoire.
--  Or une vraie pièce est lue, envoyée, vue, précisée, prise en charge : elle
--  gardait `app.circuit_de_la_piece` et `app.suivi_de_la_piece`, qui relisent
--  pour chacune la lisibilité (5 fois, 2 ms) et les droits. Banc de la CI,
--  800 pièces vécues : circuit 9 s, suivi 6 s, liste 27 s.
--
--  Mesuré ensuite, plan à l'appui : la dernière lecture de la pièce, ses
--  précisions et le refus de lecture passaient par les vues à RLS, qui
--  rejouent `app.piece_lisible` (2,7 ms) sur CHAQUE ligne trouvée — quatre
--  fois par pièce lue, 8,6 s sur le même banc.
--
--  Cette fonction dit, en UNE lecture, tout cela pour les pièces de la liste.
--  Les droits se lisent une fois par société ; les faits (lecture, circuit,
--  vues, précisions, écritures) une fois pour toutes. Les fonctions pièce par
--  pièce restent — la fiche d'une pièce les lit, et elles sont l'ORACLE :
--  `la-liste-des-pieces-dit-la-meme-chose.test.ts` compare champ par champ.
--
--  La règle de lecture est celle de `app.piece_lisible`, portée en ligne comme
--  la politique de `capture.pieces` la porte déjà, pour les seules pièces que
--  la liste montre : ni archivées, ni remplacées.
-- ======================================================================

begin;

create function app.pieces_de_la_liste(p_tenants uuid[])
returns table (
  piece_id          uuid,
  a_une_histoire    boolean,
  a_une_lecture     boolean,
  payload           jsonb,
  precision_kind    text,
  emetteur_dit      text,
  circuit_recoit    boolean,
  circuit_dernier   text,
  circuit_envoyee   timestamptz,
  circuit_vue_le    timestamptz,
  circuit_vue_par   text,
  circuit_retournee timestamptz,
  circuit_retour_par text,
  circuit_corrigee  timestamptz,
  circuit_auteur    text,
  circuit_mienne    boolean,
  suivi_envoyee     timestamptz,
  suivi_vue_le      timestamptz,
  suivi_vue_par     text,
  suivi_corrigee    timestamptz,
  suivi_prise_le    timestamptz,
  suivi_prise       text,
  suivi_prise_par   text
)
language sql
stable
security definer
set search_path = ''
rows 5000
as $$
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
             and not app.supervise_le_dossier(t.tenant_id) as client
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
$$;

comment on function app.pieces_de_la_liste(uuid[]) is
  'Pour chaque pièce de la liste : sa dernière lecture, ses précisions, son circuit et son suivi, en une lecture — ce que les vues et app.circuit_de_la_piece, app.suivi_de_la_piece disent pièce par pièce. Bornée à ce que l''appelant peut lire.';

revoke all on function app.pieces_de_la_liste(uuid[]) from public, anon;
grant execute on function app.pieces_de_la_liste(uuid[]) to authenticated;

commit;
