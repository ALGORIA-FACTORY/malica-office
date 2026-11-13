-- Le tableau de bord du pilote — ce que le lundi mesure, et rien d'inventé.
--
-- Se lance sur le serveur, en lecture, sous le superutilisateur (aucune
-- écriture ici) :
--
--   docker compose --project-directory /srv/malica/depot/infra --env-file /srv/malica/.env \
--     exec -T postgres psql -U postgres -d malica -v semaines=6 -f - < db/pilote/tableau-de-bord.sql
--
-- Chaque bloc rend une ligne par semaine (lundi) sur les :semaines dernières
-- semaines. Les seuils sont ceux de docs/pilote/revue-go-no-go.md.
--
-- Ce que la base ne sait pas : les captures lancées mais jamais déposées
-- (elles n'atteignent pas l'API — Sentry et les signalements les disent),
-- et les sessions sans plantage (Sentry). Tout le reste est ici.

\set semaines :semaines
\set ON_ERROR_STOP on

-- ------------------------------------------------------------ activité
-- Les PME qui ont déposé au moins une pièce dans la semaine, sur celles qui
-- ont déjà déposé quelque chose depuis le début du pilote.
with semaines as (
  select date_trunc('week', now())::date - (n || ' weeks')::interval as lundi
  from generate_series(0, :semaines - 1) n
),
inscrites as (
  select tenant_id, min(created_at) as premiere from capture.pieces group by 1
)
select
  s.lundi::date                                                            as semaine,
  count(distinct i.tenant_id) filter (where i.premiere < s.lundi + interval '7 days') as pme_inscrites,
  count(distinct p.tenant_id)                                              as pme_actives,
  round(100.0 * count(distinct p.tenant_id)
        / nullif(count(distinct i.tenant_id) filter (where i.premiere < s.lundi + interval '7 days'), 0), 1)
                                                                           as pct_actives  -- cible ≥ 80
from semaines s
left join inscrites i on true
left join capture.pieces p
       on p.tenant_id = i.tenant_id
      and p.created_at >= s.lundi and p.created_at < s.lundi + interval '7 days'
group by s.lundi
order by s.lundi desc;

-- ------------------------------------------------------------ captures et lecture
-- Une pièce est « lue » quand une extraction existe ; « sans précision »
-- quand personne n'a eu à corriger un champ ; « jamais lue » quand une heure
-- a passé sans extraction.
with semaines as (
  select date_trunc('week', now())::date - (n || ' weeks')::interval as lundi
  from generate_series(0, :semaines - 1) n
),
pieces as (
  select p.id, p.tenant_id, p.created_at, p.source, p.status,
         exists (select 1 from capture.extractions e where e.piece_id = p.id)  as lue,
         exists (select 1 from capture.precisions  x where x.piece_id = p.id)  as precisee
  from capture.pieces p
)
select
  s.lundi::date                                                          as semaine,
  count(p.id)                                                            as pieces_deposees,
  count(p.id) filter (where p.source = 'photo')                          as par_photo,
  count(p.id) filter (where p.source <> 'photo')                         as par_fichier,
  count(p.id) filter (where p.lue)                                       as lues,
  round(100.0 * count(p.id) filter (where p.lue and not p.precisee)
        / nullif(count(p.id) filter (where p.lue), 0), 1)                as pct_lues_sans_precision,   -- cible ≥ 70, croissant
  round(100.0 * count(p.id) filter (where not p.lue and p.created_at < now() - interval '1 hour')
        / nullif(count(p.id) filter (where p.created_at < now() - interval '1 hour'), 0), 1)
                                                                         as pct_jamais_lues_apres_1h   -- cible < 3
from semaines s
left join pieces p on p.created_at >= s.lundi and p.created_at < s.lundi + interval '7 days'
group by s.lundi
order by s.lundi desc;

-- ------------------------------------------------------------ pièces sans proposition
-- LE BLOC D'ALERTE (G1, 13 novembre 2026). Une pièce reçue depuis plus que
-- `fabrique.seuil.travail.proposition_attente_min` (lu en base, jamais écrit
-- ici) et sans lecture : sa proposition d'écriture ne se calcule pas. Une ligne
-- par cause — l'état du dernier travail de lecture et son motif —, et
-- « aucun_travail » quand la lecture n'a jamais été demandée. Zéro ligne : rien
-- à signaler. Ce que la tour lit sans le superutilisateur est la vue
-- `plateforme.lectures_en_souffrance_v` (la file seule, jamais une pièce).
with seuil as (
  select s.value_num::integer as minutes
    from ref.socle_params s
   where s.code = 'fabrique.seuil.travail.proposition_attente_min'
     and s.valid_from <= current_date and (s.valid_to is null or s.valid_to >= current_date)
   order by s.valid_from desc limit 1
),
derniers as (
  select distinct on (t.piece_id) t.piece_id, t.etat, t.dernier_motif
    from fabrique.etat_des_travaux_v t
   where t.nature = 'lecture_piece'
   order by t.piece_id, t.demande_le desc
)
select coalesce(d.etat, 'aucun_travail')                                  as cause,
       d.dernier_motif                                                    as motif,
       count(*)                                                           as pieces,
       count(distinct p.tenant_id)                                        as dossiers,
       floor(extract(epoch from now() - min(p.created_at)) / 60)::integer as plus_ancienne_min,
       (select minutes from seuil)                                        as seuil_min
  from capture.pieces p
  left join derniers d on d.piece_id = p.id
 where p.created_at < now() - make_interval(mins => (select minutes from seuil))
   and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
   and p.archivee_le is null
   and not exists (select 1 from capture.extractions e where e.piece_id = p.id)
   -- Un document joint à sa pièce part avec elle, sans lecture.
   and p.source_piece_id is null
   and coalesce(d.etat, '') <> 'termine'
 group by 1, 2
 order by pieces desc;

-- ------------------------------------------------------------ délais
-- Photo → proposition : de la pièce à sa première écriture proposée.
-- Photo → validée : de la pièce à l'écriture comptabilisée par le cabinet.
with semaines as (
  select date_trunc('week', now())::date - (n || ' weeks')::interval as lundi
  from generate_series(0, :semaines - 1) n
),
delais as (
  select p.id, p.created_at,
         min(e.created_at) - p.created_at                                   as jusqu_a_proposition,
         min(e.booked_at) filter (where e.booked_at is not null) - p.created_at as jusqu_a_validation
  from capture.pieces p
  join socle.ecritures e on e.piece_id = p.id
  group by p.id, p.created_at
)
select
  s.lundi::date                                                                        as semaine,
  count(d.id)                                                                          as pieces_avec_ecriture,
  round(extract(epoch from percentile_cont(0.95) within group (order by d.jusqu_a_proposition)))
                                                                                       as p95_photo_proposition_s,  -- cible < 120
  round(extract(epoch from percentile_cont(0.5) within group (order by d.jusqu_a_validation)) / 3600, 1)
                                                                                       as mediane_photo_validee_h   -- cible < 48
from semaines s
left join delais d on d.created_at >= s.lundi and d.created_at < s.lundi + interval '7 days'
group by s.lundi
order by s.lundi desc;

-- ------------------------------------------------------------ le cabinet
-- Ce qui a été transmis au cabinet, et ce qu'il en a fait.
with semaines as (
  select date_trunc('week', now())::date - (n || ' weeks')::interval as lundi
  from generate_series(0, :semaines - 1) n
)
select
  s.lundi::date                                                         as semaine,
  count(p.id) filter (where p.vis::text = 'partage')                    as transmises,
  count(p.id) filter (where p.status = 'comptabilisee')                 as comptabilisees,
  count(p.id) filter (where p.status = 'retournee')                     as retournees_au_dirigeant,
  count(p.id) filter (where p.status in ('proposee', 'supervisee'))     as en_attente_du_cabinet
from semaines s
left join capture.pieces p on p.created_at >= s.lundi and p.created_at < s.lundi + interval '7 days'
group by s.lundi
order by s.lundi desc;

-- ------------------------------------------------------------ signalements
select
  date_trunc('week', cree_le)::date  as semaine,
  count(*)                           as signalements,
  count(distinct tenant_id)          as pme_concernees,
  count(distinct version_client)     as versions_vues,
  count(*) filter (where pile is not null) as avec_pile
from app.signalements
where cree_le >= date_trunc('week', now()) - (:semaines || ' weeks')::interval
group by 1
order by 1 desc;

-- ------------------------------------------------------------ versions en usage
-- Ce que les coques disent d'elles (jetons de rafraîchissement vivants).
select appareil as client, count(*) as sessions_vivantes
from auth.refresh_tokens
where revoque_le is null and expire_le > now()
group by 1
order by 2 desc;
