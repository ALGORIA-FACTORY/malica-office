-- La file des courriels réserve ; elle ne verrouille pas pendant l'envoi.
--
-- ================================================================== POURQUOI
--
-- 20261223130100 rendait les courriels à remettre sous `for update skip locked`,
-- et le travailleur envoyait le courriel DANS la transaction qui tenait ce
-- verrou : un appel Brevo lent gardait la ligne bloquée pendant toute sa durée.
-- Ce fichier découpe la remise en trois temps, chacun dans sa transaction :
--
--   1. `notif.reserver_courriels` pose une réservation (`notif.reservations`,
--      ajout seul) avec une échéance, et rend les lignes ; le verrou tient le
--      temps de la réservation seulement ;
--   2. le travailleur envoie HORS transaction ;
--   3. `notif.remettre` inscrit le résultat (`remis` ou `echoue`).
--
-- Une réservation expirée sans résultat repart au tour suivant : un processus
-- qui tombe ne bloque pas un courriel pour toujours.
--
-- Le plafond d'essais ne se replie plus sur le seuil de la fabrique : sans le
-- réglage de relances, la file lève une erreur explicite (`refus.relances.reglage_absent`).
-- Conséquence assumée : tant que l'exploitant n'a pas pris le réglage, aucun
-- courriel ne part (relances comprises), et la tour le dit au journal.
--
-- R7 : 20261223130100 n'est pas réécrite ; cette migration la remplace par une
-- nouvelle définition de la même fonction, et retire l'ancienne.

begin;

-- --- 1. Les réservations, ajout seul -----------------------------------------

create table notif.reservations (
  id           uuid primary key default gen_random_uuid(),
  envoi_id     uuid not null references notif.envois(id) on delete cascade,
  reserve_jusqu timestamptz not null,
  cree_le      timestamptz not null default now()
);

create index reservations_envoi_idx on notif.reservations (envoi_id, reserve_jusqu desc);

alter table notif.reservations enable row level security;
alter table notif.reservations force row level security;
revoke all on table notif.reservations from public, anon, authenticated, service_role;

create trigger notif_reservations_no_upd
  before update or delete on notif.reservations
  for each row execute function app.deny_mutation();

-- --- 2. Le message d'erreur explicite : pas de repli, pas de chiffre inventé ---

-- (la clé `refus.relances.reglage_absent` est posée dans le Socle, fr/en/ar)

-- --- 3. La réservation ---------------------------------------------------------

drop function if exists notif.courriels_a_remettre(integer);

create function notif.reserver_courriels(p_limite integer, p_duree interval)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reglage jsonb;
begin
  -- Le réglage de l'exploitant est la seule source du plafond. Absent : on le dit.
  select plateforme.relances_reglage() into v_reglage;
  if v_reglage ->> 'tentatives_max' is null then
    raise exception 'refus.relances.reglage_absent' using errcode = 'no_data_found';
  end if;

  return query
  with dus as (
    select e.id
      from notif.envois_v e
     where e.canal = 'email'
       and e.etat in ('a_remettre', 'a_reessayer')
       and (e.code not like 'impaye.%' or (v_reglage ->> 'actives')::boolean)
       and e.tentatives < (v_reglage ->> 'tentatives_max')::integer
       -- une réservation encore vivante : le courriel part ailleurs, ou tout à l'heure
       and not exists (
         select 1 from notif.reservations r
          where r.envoi_id = e.id and r.reserve_jusqu > now())
  ),
  pris as (
    select n.id, n.destinataire, n.gabarit_id, n.titre_rendu, n.corps_rendu, n.cree_le
      from notif.envois n
     where n.id in (select id from dus)
     order by n.cree_le
     limit p_limite
       for update of n skip locked
  ),
  posees as (
    insert into notif.reservations (envoi_id, reserve_jusqu)
    select p.id, now() + p_duree from pris p
    returning notif.reservations.envoi_id
  )
  select p.id, u.email::text, g.locale, p.titre_rendu, p.corps_rendu,
         g.action_libelle, g.action_route, g.ton
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
   order by p.cree_le;
end
$$;

revoke all on function notif.reserver_courriels(integer, interval) from public, anon, authenticated;
grant execute on function notif.reserver_courriels(integer, interval) to malica_api;

commit;
