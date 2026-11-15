-- L'essai d'un courriel ne dépend pas d'un réglage absent.
--
-- ================================================================== POURQUOI
--
-- La file des courriels à remettre (`notif.courriels_a_remettre`) ne rend un
-- courriel que si `tentatives < tentatives_max`. Ce plafond vient du réglage de
-- la plateforme (`plateforme.relances_reglage()`), et `coalesce(…, 0)` quand il
-- est absent. Or le réglage est une décision de l'exploitant pour les relances
-- d'impayé (`relances_regler`) : il n'existe pas tant qu'elle n'est pas prise.
-- Résultat mesuré sur la base d'essai : aucun courriel ne part, ni les relances,
-- ni les 35 types — la file est vide quelle que soit la décision.
--
-- Le plafond d'essais est une règle de l'envoi, pas de l'impayé. Il se lit donc,
-- à défaut de réglage, dans le seuil que la fabrique applique déjà aux travaux
-- (`fabrique.seuil.travail.tentatives_max`, daté dans `ref.socle_params`) : un
-- seul seuil pour « combien de fois on retente », pas une copie.
--
-- Le réglage de l'exploitant reste prioritaire quand il existe. Une absence des
-- deux est un échec explicite : la file ne rend rien, plutôt qu'un chiffre
-- inventé.
--
-- Le corps de la fonction lit `current_date` : permis (il s'exécute plus tard),
-- et aucune donnée n'est écrite ici (R11).

begin;

drop function if exists notif.courriels_a_remettre(integer);

create function notif.courriels_a_remettre(p_limite integer)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text)
language sql
volatile
security definer
set search_path = ''
as $$
  -- Le sujet du courriel est le titre rendu par `notif.poster` (ses jetons
  -- remplacés). Le ton vient du gabarit : le courriel commun s'en colore.
  --
  -- Les lignes rendues sont VERROUILLÉES jusqu'à la fin de la transaction de
  -- l'appelant, qui envoie et inscrit dans la même transaction : deux API
  -- qui tournent ne remettent jamais le même courriel (`skip locked`).
  --
  -- Les relances fermées par la tour ne partent plus, même décidées avant.
  with reglage as (select plateforme.relances_reglage() as r),
  seuil as (
    select max(s.value_num)::int as tentatives_max
      from ref.socle_params s
     where s.code = 'fabrique.seuil.travail.tentatives_max'
       and s.valid_from <= current_date
       and (s.valid_to is null or s.valid_to > current_date)
  ),
  plafond as (
    select coalesce((reglage.r ->> 'tentatives_max')::int, seuil.tentatives_max) as n
      from reglage, seuil
  ),
  dus as (
    select e.id
      from notif.envois_v e, reglage, plafond
     where e.canal = 'email'
       and e.etat in ('a_remettre', 'a_reessayer')
       and (e.code not like 'impaye.%' or (reglage.r ->> 'actives')::boolean)
       and e.tentatives < plafond.n
  ),
  pris as (
    select n.id, n.destinataire, n.gabarit_id, n.titre_rendu, n.corps_rendu, n.cree_le
      from notif.envois n
     where n.id in (select id from dus)
     order by n.cree_le
     limit p_limite
       for update of n skip locked
  )
  select p.id, u.email::text, g.locale, p.titre_rendu, p.corps_rendu,
         g.action_libelle, g.action_route, g.ton
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
   order by p.cree_le
$$;

revoke all on function notif.courriels_a_remettre(integer) from public, anon, authenticated;
grant execute on function notif.courriels_a_remettre(integer) to malica_api;

commit;
