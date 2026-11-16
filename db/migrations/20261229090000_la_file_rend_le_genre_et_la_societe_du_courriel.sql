-- ======================================================================
--  La file rend aussi le genre et la société de chaque courriel
--  (maquettes du 13 novembre 2026, adoptées le 16 novembre).
--
--  Le cadre commun des courriels porte une étiquette — le mot de la famille
--  du genre : mandat, pièce, abonnement… — et la pastille de la société
--  concernée. La file les rend avec le reste : `code` (le genre) et
--  `organisation` (le nom de la société, s'il y en a une).
--
--  Repris de sa définition en vigueur (20261227120000) ; seules les deux
--  colonnes s'ajoutent. Le type de retour change : la fonction se recrée.
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

begin;

drop function notif.reserver_courriels(integer, interval);

create function notif.reserver_courriels(p_limite integer, p_duree interval)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text,
               code text, organisation text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reglage jsonb;
begin
  -- Une réservation à la fois (revue de #403, Codex P2). `skip locked` n'écarte que les
  -- verrous encore tenus : deux travailleurs partis sur le même instantané pouvaient,
  -- l'un ayant validé, prendre la même ligne — et le courriel partait deux fois. Le
  -- verrou consultatif tient jusqu'à la validation ; la requête qui suit prend son
  -- instantané APRÈS lui, et voit donc les réservations du précédent.
  perform pg_advisory_xact_lock(hashtext('notif.reserver_courriels'));

  -- Le réglage de l'exploitant est la seule source du plafond. Absent : on le dit.
  select plateforme.relances_reglage() into v_reglage;
  if v_reglage ->> 'tentatives_max' is null then
    raise warning 'refus.relances.reglage_absent : relances d''impayé non remises';
  end if;

  return query
  with dus as (
    select e.id
      from notif.envois_v e
     where e.canal = 'email'
       and e.etat in ('a_remettre', 'a_reessayer')
       -- Les relances d'impayé : seulement avec le réglage, actif, et dans son plafond.
       -- Les autres courriels : sans plafond d'essais.
       and (e.code not like 'impaye.%'
            or (v_reglage ->> 'tentatives_max' is not null
                and (v_reglage ->> 'actives')::boolean
                and e.tentatives < (v_reglage ->> 'tentatives_max')::integer))
       -- une réservation encore vivante : le courriel part ailleurs, ou tout à l'heure
       and not exists (
         select 1 from notif.reservations r
          where r.envoi_id = e.id and r.reserve_jusqu > now())
  ),
  pris as (
    select n.id, n.destinataire, n.gabarit_id, n.titre_rendu, n.corps_rendu, n.cree_le,
           n.code, n.tenant_id
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
         g.action_libelle, g.action_route, g.ton,
         p.code, o.name
    from pris p
    join notif.gabarits g on g.id = p.gabarit_id
    join auth.users u on u.id = p.destinataire
    left join identity.organizations o on o.id = p.tenant_id
   order by p.cree_le;
end
$$;

revoke all on function notif.reserver_courriels(integer, interval) from public, anon, authenticated;
grant execute on function notif.reserver_courriels(integer, interval) to malica_api;

commit;
