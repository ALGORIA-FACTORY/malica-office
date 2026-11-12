-- Une alerte tranchée n'est plus « à traiter » (décision du 8 novembre 2026 ;
-- recette du 11 novembre, point 2.3).
--
-- Relevé : « Mes sociétés · 2 choses à traiter » alors que rien n'attendait.
-- L'alerte d'une pièce retournée restait non lue après le renvoi et la
-- validation ; celle d'un mandat proposé, après son acceptation. Et l'alerte
-- d'une prise en charge démarrée d'elle-même à l'arrivée du dirigeant lisait
-- encore « propose de prendre votre abonnement en charge », avec « Voir la
-- proposition ».
--
-- La règle existe depuis `20261208093000` pour l'abonnement
-- (`collab.question_tranchee`) : une question qui a reçu sa réponse passe lue
-- pour tout le dossier. Elle s'étend ici :
--
--   1. au RETOUR d'une pièce : dès que la pièce n'est plus retournée chez la
--      comptabilité (renvoyée, gardée, retirée), l'alerte du retour est lue.
--      L'alerte cite parfois une version précédente (photo reprise) : on
--      remonte la chaîne des remplacements ;
--   2. au MANDAT proposé : accepté, refusé ou retiré, son alerte est lue ;
--   3. à ce que l'alerte DIT : la notification porte l'issue (`tranchee`, le
--      statut atteint), et l'écran ne dit plus « propose » d'une offre qui a
--      démarré, ni « Accepter le mandat » d'un mandat accepté.
--
-- Rien d'autre ne change : ni la facturation, ni le mandat. Une notification
-- n'est pas un fait comptable ; `read_at` s'y pose déjà.
-- REJEU (R11) : `create or replace`, `drop trigger if exists`, reprise
-- idempotente. Aucune donnée de référence n'est écrite.

begin;

-- --- 1 et 3. L'abonnement et le mandat : la question tranchée dit son issue ---------------

create or replace function collab.question_tranchee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avant text;
  v_apres text;
  v_tenant uuid;
  v_kind text;
  v_cle text;
begin
  if tg_table_name = 'engagements' then
    v_avant := old.status; v_apres := new.status; v_tenant := new.pme_org_id;
    v_kind := 'mandat.propose'; v_cle := 'engagement_id';
  elsif tg_table_name = 'acces' then
    v_avant := old.statut; v_apres := new.statut; v_tenant := new.tenant_id;
    v_kind := 'acces.propose'; v_cle := 'acces_id';
  else
    v_avant := old.statut; v_apres := new.statut; v_tenant := new.tenant_id;
    v_kind := 'acces.descente_demandee'; v_cle := 'descente_id';
  end if;

  if v_avant = 'propose' and v_apres <> 'propose' then
    update collab.notifications n
       set read_at = coalesce(n.read_at, now()),
           payload = n.payload || jsonb_build_object('tranchee', v_apres)
     where n.tenant_id = v_tenant
       and n.kind = v_kind
       and n.payload ->> v_cle = new.id::text
       and not n.payload ? 'tranchee';
  end if;
  return new;
end
$$;

revoke all on function collab.question_tranchee() from public;

comment on function collab.question_tranchee() is
  'Une question qui a reçu sa réponse (abonnement proposé, descente demandée, mandat proposé) '
  'n''est plus à traiter : son alerte passe lue pour tout le dossier et porte l''issue.';

drop trigger if exists question_tranchee on identity.engagements;
create trigger question_tranchee after update of status on identity.engagements
  for each row execute function collab.question_tranchee();

-- --- 2. Le retour d'une pièce -------------------------------------------------------------

create or replace function collab.retour_tranche()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with recursive versions(id) as (
    select old.id
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  )
  update collab.notifications n
     set read_at = now()
   where n.tenant_id = old.tenant_id
     and n.kind = 'piece.retournee'
     and n.read_at is null
     and n.payload ->> 'piece_id' in (select v.id::text from versions v);
  return null;
end
$$;

revoke all on function collab.retour_tranche() from public;

comment on function collab.retour_tranche() is
  'Une pièce qui n''est plus retournée chez la comptabilité (renvoyée, gardée, retirée, '
  'supprimée) n''attend plus de geste : l''alerte de son retour passe lue pour tout le dossier.';

drop trigger if exists retour_tranche on capture.pieces;
create trigger retour_tranche after update of status, vis, archivee_le on capture.pieces
  for each row
  when (old.status = 'retournee'
        and (new.status <> 'retournee'
             or new.vis <> 'partage'::app.vis_t
             or (old.archivee_le is null and new.archivee_le is not null)))
  execute function collab.retour_tranche();

drop trigger if exists retour_tranche_a_la_suppression on capture.pieces;
create trigger retour_tranche_a_la_suppression after delete on capture.pieces
  for each row when (old.status = 'retournee')
  execute function collab.retour_tranche();

-- --- La reprise : ce qui est déjà tranché le dit ------------------------------------------

update collab.notifications n
   set read_at = coalesce(n.read_at, now()),
       payload = n.payload || jsonb_build_object('tranchee', a.statut)
  from facturation.acces a
 where n.kind = 'acces.propose'
   and n.tenant_id = a.tenant_id
   and n.payload ->> 'acces_id' = a.id::text
   and a.statut <> 'propose'
   and not n.payload ? 'tranchee';

update collab.notifications n
   set read_at = coalesce(n.read_at, now()),
       payload = n.payload || jsonb_build_object('tranchee', d.statut)
  from facturation.acces_descentes d
 where n.kind = 'acces.descente_demandee'
   and n.tenant_id = d.tenant_id
   and n.payload ->> 'descente_id' = d.id::text
   and d.statut <> 'propose'
   and not n.payload ? 'tranchee';

update collab.notifications n
   set read_at = coalesce(n.read_at, now()),
       payload = n.payload || jsonb_build_object('tranchee', e.status)
  from identity.engagements e
 where n.kind = 'mandat.propose'
   and n.tenant_id = e.pme_org_id
   and n.payload ->> 'engagement_id' = e.id::text
   and e.status <> 'propose'
   and not n.payload ? 'tranchee';

-- Le retour : l'alerte attend seulement si la version courante de sa pièce
-- est encore retournée chez la comptabilité.
update collab.notifications n
   set read_at = now()
 where n.kind = 'piece.retournee'
   and n.read_at is null
   and not exists (
     select 1 from capture.pieces p
      where p.id = app.version_courante(app.uuid_ou_null(n.payload ->> 'piece_id'))
        and p.status = 'retournee'
        and p.vis = 'partage'::app.vis_t
        and p.archivee_le is null);

commit;
