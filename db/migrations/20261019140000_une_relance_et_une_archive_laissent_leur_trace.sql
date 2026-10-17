-- Une relance et une archive laissent leur trace.
--
-- ================================================================== POURQUOI
--
-- Quatre exécutions manquaient à la tour : le travailleur qui pousse, le PDF
-- d'une facture, le paquet d'archive d'une réquisition, et l'ordonnanceur qui
-- relance les impayés. Trois d'entre elles sont du code ; celle-ci est ce que
-- la base doit porter pour que ce code existe.
--
-- ======================================================== CE QU'ELLE AJOUTE
--
--   — la file des impayés à relancer, avec le PALIER atteint : on ne dit pas
--     la même chose à J+3 et à J+30, et on ne le dit pas deux fois ;
--   — les gabarits de ces relances, en français, comme les autres ;
--   — la trace d'une archive constituée : qui, quand, combien de fichiers,
--     et l'empreinte du paquet entier.
--
-- ================================================== POURQUOI DES PALIERS NOMMÉS
--
-- Un impayé n'est pas un état continu, c'est une suite de décisions. Les
-- nommer — `rappel`, `relance`, `avis_de_suspension`, `suspension` — évite le
-- calcul à chaque lecture, rend la file lisible par un humain, et permet
-- surtout de ne franchir chaque palier QU'UNE FOIS : la clé de dédoublonnage
-- de `notif.poster` est le palier, pas le jour.

begin;

-- --- 1. Les paliers de relance ---------------------------------------------
--
-- Les jours viennent du référentiel (R4 par analogie) : « 15 jours » est une
-- décision commerciale qui changera, et elle ne doit pas vivre dans un `if`.

insert into ref.socle_params
  (pack_version_id, code, value_num, legal_reference, valid_from)
select p.id, c.code, c.v, 'Politique de recouvrement ALGORIA', date '2026-10-01'
  from ref.jurisdiction_packs p
  cross join (values
    ('recouvrement.rappel_jours',             3::numeric),
    ('recouvrement.relance_jours',           10),
    ('recouvrement.avis_suspension_jours',   20),
    ('recouvrement.suspension_jours',        30)
  ) as c(code, v)
 where p.jurisdiction = 'TN'
   and p.effective_from <= date '2026-10-01'
   and (p.effective_to is null or p.effective_to >= date '2026-10-01')
on conflict do nothing;

-- --- 2. La file des impayés -------------------------------------------------
--
-- Une vue, pas une table : l'état d'un impayé se déduit de la facture, des
-- encaissements et du calendrier. Le stocker obligerait à le rafraîchir, et
-- un état rafraîchi par un travail de nuit est faux toute la journée qui suit
-- un règlement.

create or replace view facturation.a_relancer_v as
with seuils as (
  select
    max(value_num) filter (where code = 'recouvrement.rappel_jours')           as j_rappel,
    max(value_num) filter (where code = 'recouvrement.relance_jours')          as j_relance,
    max(value_num) filter (where code = 'recouvrement.avis_suspension_jours')  as j_avis,
    max(value_num) filter (where code = 'recouvrement.suspension_jours')       as j_susp
  from ref.socle_params
  where code like 'recouvrement.%'
    and valid_from <= current_date
    and (valid_to is null or valid_to >= current_date)
)
select
  e.facture_id, e.licence_id, e.numero, e.montant_ttc, e.reste_du,
  e.echeance_le, e.jours_de_retard,
  l.titulaire,
  l.statut                                   as statut_licence,
  case
    when e.jours_de_retard >= s.j_susp    then 'suspension'
    when e.jours_de_retard >= s.j_avis    then 'avis_de_suspension'
    when e.jours_de_retard >= s.j_relance then 'relance'
    when e.jours_de_retard >= s.j_rappel  then 'rappel'
    else null
  end                                        as palier
from facturation.encours_v e
join facturation.licences l on l.id = e.licence_id
cross join seuils s
where e.etat in ('en_retard', 'partielle')
  and e.reste_du > 0
  and e.jours_de_retard >= s.j_rappel;

comment on view facturation.a_relancer_v is
  'Les impayés et le palier atteint. Le palier sert de clé de dédoublonnage : '
  'on ne franchit chaque marche qu''une fois.';

-- --- 3. Les gabarits de relance --------------------------------------------
--
-- Le ton monte, mais il ne devient jamais comminatoire : un client en retard
-- de trente jours est le plus souvent un client débordé, pas un mauvais
-- payeur, et l'écran qu'il verra après avoir payé est le même qu'avant.

insert into notif.gabarits
  (code, canal, locale, titre, corps, action_libelle, action_route,
   sujet, corps_html, effective_from)
values
  ('impaye.rappel', 'email', 'fr',
   'Votre facture {{numero}} est échue',
   'Elle arrivait à échéance le {{echeance}} — {{reste}} TND restent dus. Rien ne change pour l''instant : je continue à lire.',
   'Régler maintenant', '/pme/reglages',
   'Facture {{numero}} — échéance passée',
   '<!-- design/emails/construire.py -->', date '2026-10-01'),

  ('impaye.relance', 'email', 'fr',
   '{{jours}} jours — facture {{numero}}',
   '{{reste}} TND restent dus. Si quelque chose bloque de votre côté, répondez à ce message : on trouve une solution, c''est plus simple que de laisser courir.',
   'Régler maintenant', '/pme/reglages',
   'Relance — facture {{numero}}',
   '<!-- design/emails/construire.py -->', date '2026-10-01'),

  ('impaye.avis_de_suspension', 'email', 'fr',
   'Je cesserai de lire le {{date_suspension}}',
   'La facture {{numero}} reste due depuis {{jours}} jours. Au {{date_suspension}}, j''arrête les lectures — mais la caméra reste ouverte et vos pièces vous attendent. Rien ne sera perdu.',
   'Régler maintenant', '/pme/reglages',
   'Facture {{numero}} — suspension le {{date_suspension}}',
   '<!-- design/emails/construire.py -->', date '2026-10-01'),

  ('impaye.suspension', 'email', 'fr',
   'Les lectures sont suspendues',
   'La facture {{numero}} reste due depuis {{jours}} jours. Continuez à photographier : {{en_attente}} pièces vous attendent déjà, et je les lirai toutes dès le règlement.',
   'Régler et reprendre', '/pme/reglages',
   'Lectures suspendues — facture {{numero}}',
   '<!-- design/emails/construire.py -->', date '2026-10-01')
on conflict do nothing;

-- --- 4. La trace d'une archive ---------------------------------------------
--
-- Ce qui a été remis, et à qui. Sans cette ligne, « vous nous aviez remis le
-- dossier en novembre » se discute ; avec elle, elle se vérifie — l'empreinte
-- du paquet se recalcule par n'importe qui, y compris contre nous.

create table if not exists plateforme.archives (
  id             uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references plateforme.requisitions(id) on delete restrict,
  tenant_id      uuid not null references identity.organizations(id) on delete restrict,

  fichiers       integer not null check (fichiers >= 0),
  octets         bigint  not null check (octets >= 0),
  -- L'empreinte du PAQUET, pas des fichiers : c'est elle qu'on inscrit au
  -- procès-verbal de remise, et elle suffit à prouver que rien n'a changé.
  empreinte      text not null check (empreinte ~ '^[0-9a-f]{64}$'),

  constituee_le  timestamptz not null default now(),
  constituee_par uuid not null default auth.uid(),
  remise_a       text,
  remise_le      timestamptz
);

create index archives_requisition_idx on plateforme.archives (requisition_id);

alter table plateforme.archives enable row level security;
alter table plateforme.archives force row level security;
revoke all on table plateforme.archives from public, anon, service_role;
grant select, insert, update on table plateforme.archives to authenticated;

-- Le client voit l'archive constituée sur son dossier, sauf secret imposé.
-- C'est le pendant de la règle des réquisitions : il a le droit de savoir ce
-- qui est sorti de chez lui.
create policy plateforme_archives_sel on plateforme.archives
  for select to authenticated
  using (app.is_platform()
         or (tenant_id in (select app.member_orgs())
             and exists (select 1 from plateforme.requisitions r
                          where r.id = requisition_id and not r.secret_impose)));
create policy plateforme_archives_ins on plateforme.archives
  for insert to authenticated with check (app.is_platform());
create policy plateforme_archives_upd on plateforme.archives
  for update to authenticated using (app.is_platform()) with check (app.is_platform());

grant select on facturation.a_relancer_v to authenticated;

commit;
