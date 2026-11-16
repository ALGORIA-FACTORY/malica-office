-- ======================================================================
--  La file rend aussi le genre et la société de chaque courriel
--  (maquettes du 13 novembre 2026, adoptées le 16 novembre).
--
--  Le cadre commun des courriels porte une étiquette — le mot de la famille
--  du genre : mandat, pièce, abonnement… — et la pastille de la société
--  concernée, et chaque maquette ses données (un montant, une frise, une
--  échéance). La file les rend avec le reste : `code` (le genre),
--  `organisation` (le nom de la société, s'il y en a une), `donnees` (ce que
--  l'événement a porté) et, pour les relances d'impayé, `calendrier` (les jours
--  de recouvrement en vigueur).
--
--  Repris de sa définition en vigueur (20261227120000) ; seules les cinq
--  colonnes s'ajoutent (et l'objet, `sujet`, que le gabarit porte). Le type de retour change : la fonction se recrée.
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

begin;

-- --- 1. La ligne du courriel garde ce que l'événement a porté ------------------
--
-- `notif.poster` rendait le titre et le corps, mais ne gardait pas les jetons :
-- la ligne `email` portait `donnees = '{}'`. Repris de sa définition en vigueur
-- (20261226140000) ; seule l'insertion garde désormais `p_jetons`.

CREATE OR REPLACE FUNCTION notif.poster(p_destinataire uuid, p_code text, p_sujet_cle text, p_jetons jsonb DEFAULT '{}'::jsonb, p_tenant uuid DEFAULT NULL::uuid, p_canal text DEFAULT 'push'::text, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  g          record;
  pref       record;
  v_locale   text;
  v_titre    text;
  v_corps    text;
  v_abandon  text := null;
  v_heure    time;
  v_id       uuid;
  k          text;
begin
  -- ─ verrou 1 : le droit. Un destinataire sans membership sur le tenant
  --   concerné n'a plus rien à recevoir de ce tenant.
  if p_tenant is not null and p_destinataire not in (select notif.candidats(p_tenant)) then
    v_abandon := 'droit_perdu';
  end if;

  select * into pref from notif.preferences where user_id = p_destinataire;
  if pref.user_id is null then
    insert into notif.preferences (user_id) values (p_destinataire)
      on conflict do nothing;
    select * into pref from notif.preferences where user_id = p_destinataire;
  end if;

  -- ─ le canal ouvert. Une personne qui a fermé le courriel ou le push ne
  --   les reçoit pas ; l'application, elle, ne se ferme pas.
  if v_abandon is null
     and ((p_canal = 'email' and not pref.email_actif)
          or (p_canal = 'push' and not pref.push_actif)) then
    v_abandon := 'canal_absent';
  end if;

  -- ─ verrou 2 : la cadence. `jamais` veut dire jamais, y compris pour une
  --   échéance fiscale — c'est son choix, et le produit le respecte.
  if v_abandon is null and pref.cadence = 'jamais' and p_canal <> 'app' then
    v_abandon := 'cadence';
  end if;

  -- ─ verrou 3 : le silence. Le calcul se fait dans le fuseau de la personne.
  --   La fenêtre traverse minuit, d'où le `or` plutôt qu'un `between`.
  if v_abandon is null and p_canal = 'push' then
    v_heure := (now() at time zone pref.fuseau)::time;
    if (pref.silence_de < pref.silence_a
        and v_heure >= pref.silence_de and v_heure < pref.silence_a)
       or (pref.silence_de > pref.silence_a
        and (v_heure >= pref.silence_de or v_heure < pref.silence_a))
    then
      v_abandon := 'silence';
    end if;
  end if;

  -- ─ verrou 4 : le doublon. La promesse « une fois, et je me tais ».
  -- Deux façons de s'être déjà exprimé, et il faut les deux :
  --
  --   REMIS        la personne l'a reçu ;
  --   À REMETTRE   c'est décidé, le travailleur ne l'a pas encore poussé.
  --
  -- Oublier le second a une conséquence mesurée : un ordonnanceur qui tourne
  -- toutes les heures repose la même relance vingt-quatre fois avant que le
  -- travailleur n'en ait poussé une seule, et le client reçoit vingt-quatre
  -- courriels d'un coup. C'est exactement la boucle que « une fois, et je me
  -- tais » existe pour empêcher.
  --
  -- Un envoi ABANDONNÉ, lui, ne compte pas : retenu par le silence de 23 h,
  -- la même chose doit pouvoir repartir à 8 h.
  if v_abandon is null and exists (
       select 1 from notif.envois_v e
        where e.destinataire = p_destinataire
          and e.code = p_code
          and e.canal = p_canal              -- la ligne de l'application n'est pas le courriel
          and e.sujet_cle = p_sujet_cle
          and e.decision = 'a_remettre'      -- décidé : remis, ou en attente
          and e.etat <> 'refuse'             -- refusé pour de bon : on peut redire
          and e.cree_le > now() - p_fenetre)
  then
    v_abandon := 'doublon';
  end if;

  -- Le canal doit exister. Un push sans appareil enregistré n'échoue pas :
  -- il s'abandonne, proprement, et la ligne le dit.
  if v_abandon is null and p_canal = 'push' and not exists (
       select 1 from collab.push_devices d
        where d.user_id = p_destinataire and d.revoked_at is null)
  then
    v_abandon := 'canal_absent';
  end if;

  -- Le gabarit, dans la langue de la personne, repli sur le français.
  select coalesce(pr.locale, 'fr') into v_locale
    from identity.profiles pr where pr.user_id = p_destinataire;
  v_locale := coalesce(v_locale, 'fr');

  select * into g from notif.gabarits
   where code = p_code and canal = p_canal
     and locale in (v_locale, 'fr')
     and effective_from <= current_date
   order by (locale = v_locale) desc, effective_from desc
   limit 1;

  if g.id is null then
    raise exception '%', app.refus_avec_valeurs('refus.referentiel.gabarit_absent', 'code', (p_code)::text, 'canal', (p_canal)::text)
      using errcode = 'no_data_found';
  end if;

  -- La substitution : {{jeton}} → valeur. Un jeton absent reste visible dans
  -- le texte rendu plutôt que de disparaître — on veut le voir en recette,
  -- pas découvrir une phrase amputée chez un client.
  v_titre := g.titre; v_corps := g.corps;
  for k in select jsonb_object_keys(p_jetons) loop
    v_titre := replace(v_titre, '{{' || k || '}}', coalesce(p_jetons ->> k, ''));
    v_corps := replace(v_corps, '{{' || k || '}}', coalesce(p_jetons ->> k, ''));
  end loop;

  insert into notif.envois
    (tenant_id, destinataire, code, canal, gabarit_id, sujet_cle,
     titre_rendu, corps_rendu, decision, motif_abandon, donnees)
  values
    (p_tenant, p_destinataire, p_code, p_canal, g.id, p_sujet_cle,
     v_titre, v_corps,
     case when v_abandon is null then 'a_remettre' else 'abandonne' end,
     v_abandon,
     -- Ce que l'événement a porté : le courriel en dessine ses données (montant,
     -- frise, échéance) et son objet (20261229090000).
     p_jetons)
  returning id into v_id;

  return jsonb_build_object('envoi_id', v_id, 'poste', v_abandon is null,
                            'motif', v_abandon, 'canal', p_canal);
end
$$;

-- --- 2. La file rend le genre, la société, l'objet et les données ------------

drop function notif.reserver_courriels(integer, interval);

create function notif.reserver_courriels(p_limite integer, p_duree interval)
returns table (envoi_id uuid, email text, locale text, titre text, corps text,
               action_libelle text, action_route text, ton text,
               code text, organisation text, donnees jsonb, calendrier jsonb,
               sujet text)
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
           n.code, n.tenant_id, n.donnees
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
         p.code, o.name, p.donnees,
         -- Les relances d'impayé dessinent leur frise (échue, relance, avis, suspension) :
         -- les jours viennent du calendrier de recouvrement en vigueur, jamais du code (R4).
         case when p.code like 'impaye.%' then (
           -- comme `facturation.a_relancer_v`, qui décide des paliers
           select jsonb_object_agg(x.code, x.jours)
             from (select sp.code, max(sp.value_num) as jours
                     from ref.socle_params sp
                    where sp.code in ('recouvrement.rappel_jours', 'recouvrement.relance_jours',
                                      'recouvrement.avis_suspension_jours',
                                      'recouvrement.suspension_jours')
                      and sp.valid_from <= current_date
                      and (sp.valid_to is null or sp.valid_to >= current_date)
                    group by sp.code) x)
         end,
         -- L'objet du message (le gabarit le porte) ; ses jetons, le travailleur les remplit.
         g.sujet
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
