-- Une réclamation se ferme, une réquisition se sert sans ouvrir les pièces.
--
-- ================================================================== POURQUOI
--
-- Deux objets qui n'ont rien en commun sauf leur destinataire : la tour.
--
-- La RÉCLAMATION vient du client. Elle doit se fermer — un fil ouvert pendant
-- six semaines est un client perdu, et un fil fermé sans réponse écrite est un
-- client perdu plus lentement.
--
-- La RÉQUISITION vient d'une autorité : recette des finances, contrôle
-- fiscal, justice. Sa table a été posée par `20261019090000`, parce que
-- `app.plateforme_requise` la lit. Ici on écrit ce qu'on SERT, et le point
-- entier est qu'on peut servir presque tout sans ouvrir un seul papier.
--
-- ========================================== CE QU'UNE AUTORITÉ DEMANDE VRAIMENT
--
-- Dans l'immense majorité des cas, une administration ne veut pas lire les
-- factures : elle veut savoir qu'elles existent, quand elles sont entrées,
-- qui les a déposées, et que personne ne les a réécrites depuis. C'est de la
-- MÉTADONNÉE, et le dépôt en a déjà tout ce qu'il faut — `audit.event_log`,
-- les empreintes SHA-256, les dates de transmission.
--
-- Trois portées, donc, et elles ne coûtent pas la même chose :
--
--   `metadonnees`  l'inventaire et le journal. Aucun contenu, aucune
--                  approbation à deux, servi en une requête.
--   `archive`      les fichiers tels que le client les a déposés, remis au
--                  client lui-même ou à qui il désigne.
--   `pieces`       la lecture du contenu par un opérateur d'ALGORIA. Deux
--                  signatures, une fenêtre, et le client prévenu.
--
-- ===================================================== CE QUE ÇA NOUS ÉVITE
--
-- Pouvoir répondre « voici l'inventaire horodaté et son empreinte, nous
-- n'avons pas accès au contenu » est une position bien plus solide que « nous
-- avons tout lu et voici ce que nous avons trouvé ». La seconde fait d'ALGORIA
-- un acteur du dossier ; la première en fait un tiers de confiance.

begin;

-- --- 1. La réclamation ------------------------------------------------------

create table if not exists plateforme.reclamations (
  id          uuid primary key default gen_random_uuid(),

  -- Elle vient d'une licence, pas d'un tenant : c'est le titulaire qui paie
  -- et qui réclame. Un siège passe par lui, ou par le cabinet.
  licence_id  uuid not null references facturation.licences(id) on delete restrict,
  tenant_id   uuid references identity.organizations(id) on delete set null,

  objet       text not null check (objet in (
                'lecture_fausse', 'facturation', 'plafond', 'acces',
                'lenteur', 'donnees', 'autre')),
  sujet       text not null check (length(btrim(sujet)) > 0),
  corps       text not null,

  -- La gravité est déclarée par le client, pas déduite. Ce qu'il trouve grave
  -- l'est, et la tour peut toujours le re-trier.
  gravite     text not null default 'normale'
              check (gravite in ('basse','normale','haute','bloquante')),

  ouverte_le  timestamptz not null default now(),
  ouverte_par uuid not null default auth.uid(),

  -- La fermeture porte sa réponse. Une réclamation close sans `reponse` est
  -- impossible : la contrainte le dit, et c'est voulu.
  close_le    timestamptz,
  close_par   uuid,
  issue       text check (issue in ('resolue','sans_suite','doublon','geste_commercial')),
  reponse     text,

  constraint reclamations_fermeture_complete check (
    (close_le is null and close_par is null and issue is null and reponse is null)
    or (close_le is not null and close_par is not null
        and issue is not null and length(btrim(reponse)) > 0)
  )
);

create index if not exists reclamations_ouvertes_idx on plateforme.reclamations (ouverte_le desc)
  where close_le is null;
create index if not exists reclamations_licence_idx on plateforme.reclamations (licence_id, ouverte_le desc);

comment on table plateforme.reclamations is
  'Le fil d''une réclamation. Une fermeture sans réponse écrite est refusée '
  'par la contrainte : fermer n''est pas répondre.';

-- Les échanges du fil, en ajout seul : ce qui a été dit a été dit.
create table if not exists plateforme.reclamation_messages (
  id             uuid primary key default gen_random_uuid(),
  reclamation_id uuid not null references plateforme.reclamations(id) on delete cascade,
  auteur         uuid not null default auth.uid(),
  cote           text not null check (cote in ('client','plateforme')),
  corps          text not null check (length(btrim(corps)) > 0),
  created_at     timestamptz not null default now()
);

create index if not exists reclamation_messages_idx
  on plateforme.reclamation_messages (reclamation_id, created_at);

-- --- 2. Ce que la tour voit des réclamations -------------------------------
--
-- Le délai de première réponse, et l'âge. Ce sont les deux seuls chiffres qui
-- font changer de comportement ; tout le reste se lit dans le fil.

create or replace view plateforme.reclamations_v as
select
  r.id, r.licence_id, r.objet, r.sujet, r.gravite,
  r.ouverte_le, r.close_le, r.issue,
  (r.close_le is null)                                   as ouverte,
  (select min(m.created_at) from plateforme.reclamation_messages m
    where m.reclamation_id = r.id and m.cote = 'plateforme')
                                                         as premiere_reponse_le,
  extract(epoch from (
    coalesce((select min(m.created_at) from plateforme.reclamation_messages m
               where m.reclamation_id = r.id and m.cote = 'plateforme'),
             now()) - r.ouverte_le) / 3600)::int          as heures_avant_reponse,
  extract(epoch from (coalesce(r.close_le, now()) - r.ouverte_le) / 86400)::int
                                                         as jours_ouverte
from plateforme.reclamations r;

-- --- 3. Servir une réquisition, sans ouvrir ---------------------------------
--
-- Elle rend l'INVENTAIRE : par pièce, ce que la base sait d'elle sans la
-- lire. L'empreinte est la pièce maîtresse — elle prouve qu'un fichier n'a
-- pas bougé, et elle se vérifie sans nous.
--
-- `security definer`, et le contrôle de légitimité fait ICI : la fonction
-- contourne la RLS par construction, donc elle doit refaire elle-même ce que
-- la politique aurait refusé.

create or replace function plateforme.servir_requisition(p_requisition uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_inv    jsonb;
  v_compte integer;
begin
  select * into r from plateforme.requisitions where id = p_requisition;
  if r.id is null then
    raise exception 'requisition introuvable' using errcode = 'no_data_found';
  end if;
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if r.approuve_par is null then
    raise exception 'requisition non approuvee : il faut une seconde signature'
      using errcode = 'check_violation';
  end if;
  if now() > r.close_le then
    raise exception 'requisition expiree le %', r.close_le using errcode = 'check_violation';
  end if;

  select jsonb_agg(jsonb_build_object(
           'piece_id',      p.id,
           'empreinte',     p.sha256,            -- vérifiable sans nous
           'type',          p.document_kind,
           -- La date de la pièce ne vit pas sur la pièce : elle est portée
           -- par ses lignes (`capture.piece_articles.document_date`), parce
           -- qu'une facture à cheval sur deux périodes en a plusieurs. On
           -- rend la plus ancienne, qui est celle que l'administration
           -- utilisera pour rattacher la pièce à un exercice.
           'date_piece',    (select min(a.document_date)
                               from capture.piece_articles a
                              where a.piece_id = p.id),
           'deposee_le',    p.created_at,
           'deposee_par',   p.created_by,
           'pages',         p.page_count,
           'octets_type',   p.content_type,
           'etat',          p.status,
           'transmise_le',  p.transmise_le,
           'etablissement', p.entity_id
         ) order by p.created_at),
         count(*)
    into v_inv, v_compte
    from capture.pieces p
   where p.tenant_id = r.tenant_id
     -- L'espace privé d'une personne n'entre pas dans l'inventaire d'une
     -- société. Une réquisition visant la société ne vise pas les papiers
     -- personnels de son comptable.
     and p.vis <> 'personnel'::app.vis_t;

  -- La remise est elle-même un fait, inscrit dans le journal du CLIENT :
  -- il doit pouvoir constater, dix ans après, ce qui a été remis et à qui.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (r.tenant_id, auth.uid(), 'requisition.servie', 'plateforme',
          'requisitions', p_requisition,
          jsonb_build_object('autorite', r.autorite, 'reference', r.reference,
                             'portee', r.portee, 'pieces', v_compte));

  return jsonb_build_object(
    'requisition',  p_requisition,
    'autorite',     r.autorite,
    'reference',    r.reference,
    'portee',       r.portee,
    'servie_le',    now(),
    'pieces',       v_compte,
    'contenu_inclus', (r.portee = 'pieces'),
    'inventaire',   coalesce(v_inv, '[]'::jsonb));
end
$$;

comment on function plateforme.servir_requisition(uuid) is
  'L''inventaire horodaté et empreinté d''un dossier, sans son contenu. '
  'Servir cela et dire « nous n''accédons pas aux pièces » est une position '
  'de tiers de confiance ; tout lire n''en est pas une.';

-- --- 4. L'isolation ---------------------------------------------------------
--
-- La réclamation se voit des deux côtés — c'est un dialogue, pas un ticket
-- interne. Le titulaire voit les siennes, la plateforme les voit toutes.

alter table plateforme.reclamations enable row level security;
alter table plateforme.reclamations force row level security;
revoke all on table plateforme.reclamations from public, anon, service_role;
grant select, insert, update on table plateforme.reclamations to authenticated;

create policy plateforme_reclamations_sel on plateforme.reclamations
  for select to authenticated
  using (app.is_platform()
         or licence_id in (select id from facturation.licences where titulaire = auth.uid()));
create policy plateforme_reclamations_ins on plateforme.reclamations
  for insert to authenticated
  with check (licence_id in (select id from facturation.licences where titulaire = auth.uid())
              or app.is_platform());
-- Seule la plateforme ferme. Un client qui pourrait clore sa propre
-- réclamation la clorait par lassitude, et le chiffre deviendrait faux.
create policy plateforme_reclamations_upd on plateforme.reclamations
  for update to authenticated using (app.is_platform()) with check (app.is_platform());

alter table plateforme.reclamation_messages enable row level security;
alter table plateforme.reclamation_messages force row level security;
revoke all on table plateforme.reclamation_messages from public, anon, service_role;
grant select, insert on table plateforme.reclamation_messages to authenticated;

create policy plateforme_reclamation_messages_sel on plateforme.reclamation_messages
  for select to authenticated
  using (exists (select 1 from plateforme.reclamations r where r.id = reclamation_id));
create policy plateforme_reclamation_messages_ins on plateforme.reclamation_messages
  for insert to authenticated
  with check (exists (select 1 from plateforme.reclamations r where r.id = reclamation_id));
create trigger plateforme_reclamation_messages_no_upd
  before update or delete on plateforme.reclamation_messages
  for each row execute function app.deny_mutation();

grant select on plateforme.reclamations_v to authenticated;
revoke all on function plateforme.servir_requisition(uuid) from public, anon;
grant execute on function plateforme.servir_requisition(uuid) to authenticated;

commit;
