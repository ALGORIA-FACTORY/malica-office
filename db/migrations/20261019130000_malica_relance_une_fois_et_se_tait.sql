-- Malica relance une fois, et se tait.
--
-- ================================================================== POURQUOI
--
-- Le dépôt sait notifier : `collab.notifications` reçoit des lignes, et
-- `collab.push_devices` connaît les téléphones. Ce qu'il n'a pas, c'est la
-- RETENUE — et la retenue est tout le sujet.
--
-- L'écran de fin de capture promet, mot pour mot :
--
--   « Je ne compte pas vos jours de retard et je ne vous mets pas de pastille
--     rouge. Je dis ce que ça coûte, une fois, et je me tais. »
--
-- « Une fois » est une règle technique, pas une intention. Sans elle, le
-- premier incident de production sera une boucle qui envoie quatorze fois la
-- même relance à un dirigeant en déplacement, et ce dirigeant coupera les
-- notifications — définitivement, et pour tout le produit.
--
-- ====================================================== LES QUATRE VERROUS
--
-- Rien ne part sans passer les quatre, dans cet ordre, et chacun dit non pour
-- une raison différente :
--
--   1. LE DROIT      ce destinataire a-t-il encore cette fonction ? Un siège
--                    révoqué ne reçoit plus les relances de la société.
--   2. LA CADENCE    ce qu'il a demandé : à l'échéance seulement, chaque
--                    matin, ou jamais. « Jamais » veut dire jamais.
--   3. LE SILENCE    on ne réveille personne. Par défaut 21 h → 7 h, heure de
--                    Tunis, et le fuseau vient du profil, pas du serveur.
--   4. LE DOUBLON    la même chose, au même sujet, n'est dite qu'une fois par
--                    fenêtre. C'est la promesse ci-dessus, en une clause.
--
-- ============================================ POURQUOI LES GABARITS EN BASE
--
-- R8, par analogie : le texte d'une relance est une donnée, versionnée par
-- date d'effet. Trois raisons concrètes — on corrige une faute sans
-- déploiement, on traduit en arabe sans toucher au code, et une relance
-- envoyée en octobre reste explicable avec le texte d'octobre.

begin;

create schema if not exists notif;

-- --- 1. Les gabarits --------------------------------------------------------

create table if not exists notif.gabarits (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  canal          text not null check (canal in ('push','email','app')),
  locale         text not null default 'fr' check (locale in ('fr','ar','en')),

  sujet          text,                 -- email seulement
  titre          text not null,        -- push et app
  corps          text not null,        -- texte brut, avec {{jetons}}
  corps_html     text,                 -- email seulement

  -- L'action proposée. Une notification sans suite est une interruption.
  action_libelle text,
  action_route   text,

  effective_from date not null,
  created_at     timestamptz not null default now(),
  unique (code, canal, locale, effective_from),
  constraint gabarits_email_a_un_sujet
    check (canal <> 'email' or (sujet is not null and corps_html is not null))
);

comment on table notif.gabarits is
  'Le texte est une donnée, versionnée. Corriger une faute ou traduire en '
  'arabe ne demande pas un déploiement.';

-- --- 2. Ce que la personne a demandé ----------------------------------------

create table if not exists notif.preferences (
  user_id      uuid primary key,

  -- Les trois choix de l'écran de fin de capture, mot pour mot.
  cadence      text not null default 'echeance'
               check (cadence in ('echeance','matin','jamais')),

  push_actif   boolean not null default true,
  email_actif  boolean not null default true,

  -- Le silence. En heures locales de la personne, et son fuseau avec — un
  -- serveur en UTC qui pousse « à 8 h » réveille Tunis à 9 h et Dakar à 8 h.
  silence_de   time not null default time '21:00',
  silence_a    time not null default time '07:00',
  fuseau       text not null default 'Africa/Tunis',

  updated_at   timestamptz not null default now()
);

drop trigger if exists notif_preferences_touch on notif.preferences;
create trigger notif_preferences_touch before update on notif.preferences
  for each row execute function app.touch_updated_at();

-- --- 3. Ce qui est parti, et pourquoi -------------------------------------
--
-- Ajout seul. C'est le registre qui rend le dédoublonnage possible, et c'est
-- aussi la seule façon de répondre à « je n'ai rien reçu » autrement que par
-- une opinion.

create table if not exists notif.envois (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references identity.organizations(id) on delete cascade,
  destinataire uuid not null,

  code         text not null,
  canal        text not null check (canal in ('push','email','app')),
  gabarit_id   uuid references notif.gabarits(id),

  -- La clé de dédoublonnage : ce dont on parle, pas le message. « le plafond
  -- de la licence X en octobre » ne se dit qu'une fois, quel que soit le
  -- nombre de fois où le code s'en aperçoit.
  sujet_cle    text not null,

  -- Ce qui a été réellement rendu, après substitution. Figé : le gabarit
  -- changera, pas ce que la personne a lu.
  titre_rendu  text not null,
  corps_rendu  text not null,

  -- LA DÉCISION, et elle seule : poster, ou renoncer et dire pourquoi. Ce
  -- qu'il advient ensuite de l'envoi ne s'écrit PAS ici.
  decision     text not null check (decision in ('a_remettre','abandonne')),
  motif_abandon text check (motif_abandon in (
                  'cadence','silence','doublon','droit_perdu','canal_absent')),

  cree_le      timestamptz not null default now(),

  constraint envois_abandon_motive
    check ((decision = 'abandonne') = (motif_abandon is not null))
);

-- --- 3bis. Ce qu'il est advenu de l'envoi ----------------------------------
--
-- ═══ POURQUOI UNE SECONDE TABLE, ET NON DEUX COLONNES ═══
--
-- Première écriture de cette migration : `notif.envois` portait `etat` et
-- `envoye_le`, et le travailleur qui pousse vers APNs ou FCM devait les
-- mettre à jour. Le déclencheur R7 l'a refusé au premier essai, et il avait
-- raison : un registre en ajout seul ne peut pas noter sa propre remise.
--
-- La correction n'est pas de lever R7 sur deux colonnes — ce serait rouvrir
-- la porte pour la commodité d'un travailleur. C'est de séparer les deux
-- faits, qui sont vraiment deux :
--
--   la DÉCISION de poster      prise une fois, par `notif.poster`
--   la REMISE                  tentée une fois, deux fois, dix fois, et
--                              chaque tentative est un fait de plus
--
-- C'est exactement le motif de `facturation.encours_v` : l'état se DÉDUIT
-- des faits, il ne se stocke pas. Un push qui échoue trois fois puis passe
-- laisse quatre lignes et une vérité ; un `etat` réécrit quatre fois n'en
-- laisse aucune.

create table if not exists notif.remises (
  id         uuid primary key default gen_random_uuid(),
  envoi_id   uuid not null references notif.envois(id) on delete cascade,
  resultat   text not null check (resultat in ('remis','echoue','refuse')),
  -- `refuse` : le service de push a rejeté le jeton — appareil désinstallé,
  -- jeton périmé. Ce n'est pas une panne, c'est une information : le jeton
  -- doit être révoqué, et réessayer ne servirait à rien.
  erreur     text,
  tente_le   timestamptz not null default now(),
  constraint remises_echec_motive check (resultat = 'remis' or erreur is not null)
);

create index if not exists remises_envoi_idx on notif.remises (envoi_id, tente_le desc);

-- L'état réel, déduit. C'est ce que lisent le dédoublonnage et la tour.
create or replace view notif.envois_v as
select
  e.*,
  r.resultat                                      as dernier_resultat,
  r.tente_le                                      as derniere_tentative_le,
  coalesce(n.tentatives, 0)::int                  as tentatives,
  (r.resultat = 'remis')                          as remis,
  case
    when e.decision = 'abandonne'   then 'abandonne'
    when r.resultat = 'remis'       then 'remis'
    when r.resultat = 'refuse'      then 'refuse'
    when r.resultat = 'echoue'      then 'a_reessayer'
    else 'a_remettre'
  end                                             as etat
from notif.envois e
left join lateral (
  select resultat, tente_le from notif.remises
   where envoi_id = e.id order by tente_le desc limit 1
) r on true
left join lateral (
  select count(*) as tentatives from notif.remises where envoi_id = e.id
) n on true;

create index if not exists envois_dedup_idx on notif.envois (destinataire, code, sujet_cle, cree_le desc);
create index if not exists envois_a_remettre_idx on notif.envois (cree_le) where decision = 'a_remettre';
create index if not exists envois_tenant_idx on notif.envois (tenant_id, cree_le desc);

-- --- 4. La porte ------------------------------------------------------------
--
-- Une seule fonction poste, et elle applique les quatre verrous. Un appelant
-- qui voudrait contourner l'un d'eux devrait écrire dans `notif.envois`
-- directement — ce que la politique d'insertion refuse.
--
-- Elle rend TOUJOURS une ligne, même quand elle n'envoie pas : un abandon
-- motivé se compte, et « pourquoi n'a-t-il rien reçu » est la question qu'on
-- posera le plus souvent.

create or replace function notif.poster(
  p_destinataire uuid,
  p_code         text,
  p_sujet_cle    text,
  p_jetons       jsonb default '{}'::jsonb,
  p_tenant       uuid default null,
  p_canal        text default 'push',
  p_fenetre      interval default interval '24 hours')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if p_tenant is not null and not exists (
       select 1 from identity.memberships m
        where m.tenant_id = p_tenant and m.user_id = p_destinataire)
  then
    v_abandon := 'droit_perdu';
  end if;

  select * into pref from notif.preferences where user_id = p_destinataire;
  if pref.user_id is null then
    insert into notif.preferences (user_id) values (p_destinataire)
      on conflict do nothing;
    select * into pref from notif.preferences where user_id = p_destinataire;
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
    raise exception 'aucun gabarit % pour le canal %', p_code, p_canal
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
     titre_rendu, corps_rendu, decision, motif_abandon)
  values
    (p_tenant, p_destinataire, p_code, p_canal, g.id, p_sujet_cle,
     v_titre, v_corps,
     case when v_abandon is null then 'a_remettre' else 'abandonne' end,
     v_abandon)
  returning id into v_id;

  -- Le centre de notifications de l'application reçoit tout, même ce qui n'a
  -- pas été poussé : le silence de 23 h ne doit pas faire disparaître
  -- l'information, seulement différer le bruit.
  if p_tenant is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (p_tenant, p_destinataire, p_code,
            jsonb_build_object('titre', v_titre, 'corps', v_corps,
                               'envoi_id', v_id) || p_jetons);
  end if;

  return jsonb_build_object('envoi_id', v_id, 'poste', v_abandon is null,
                            'motif', v_abandon, 'canal', p_canal);
end
$$;

-- --- 4bis. Le travailleur inscrit sa tentative -----------------------------
--
-- La seule porte par laquelle une remise s'inscrit. `refuse` révoque le
-- jeton dans la foulée : un appareil désinstallé qu'on continue d'appeler
-- fait grimper le taux d'échec chez APNs, et finit par faire refuser tout
-- le domaine.

create or replace function notif.remettre(
  p_envoi uuid, p_resultat text, p_erreur text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_dest uuid;
begin
  select destinataire into v_dest from notif.envois where id = p_envoi;
  if v_dest is null then
    raise exception 'envoi introuvable' using errcode = 'no_data_found';
  end if;

  insert into notif.remises (envoi_id, resultat, erreur)
  values (p_envoi, p_resultat, p_erreur);

  if p_resultat = 'refuse' then
    update collab.push_devices set revoked_at = now(), updated_at = now()
     where user_id = v_dest and revoked_at is null;
  end if;

  return jsonb_build_object('envoi_id', p_envoi, 'resultat', p_resultat);
end
$$;

-- --- 5. Les gabarits du premier jour ---------------------------------------
--
-- R11 : date écrite, jamais `current_date`. Et elle est au PREMIER DU MOIS,
-- pas au jour de la migration — une version datée du jour où le fichier est
-- écrit n'est pas encore en vigueur le jour où il est joué sur le poste d'un
-- développeur, et `notif.poster` lève alors « aucun gabarit ». Le piège s'est
-- refermé une fois pendant l'écriture de cette migration ; il est noté ici
-- pour qu'il ne se referme pas sur la prochaine.
--
-- Les jetons sont nommés en français parce que ce sont des gens qui relisent
-- ces textes, pas des machines.

insert into notif.gabarits
  (code, canal, locale, titre, corps, action_libelle, action_route,
   sujet, corps_html, effective_from)
values
  ('echeance.approche', 'push', 'fr',
   'TVA du mois — dépôt le {{date}}',
   'Il reste {{pieces}} pièces non lues. Je peux les lire maintenant si vous voulez.',
   'Voir mes pièces', '/pme', null, null, date '2026-10-01'),

  ('plafond.atteint', 'push', 'fr',
   'Vos {{droit}} lectures sont prises',
   'Continuez à photographier — rien n''est perdu. Je les lirai le 1er, ou plus tôt si vous passez à {{offre_suivante}}.',
   'Voir mon forfait', '/pme/reglages', null, null, date '2026-10-01'),

  ('cabinet.a_repondu', 'push', 'fr',
   '{{cabinet}} a répondu',
   '{{resume}}',
   'Lire sa réponse', '/pme/cabinet', null, null, date '2026-10-01'),

  ('piece.a_valider', 'push', 'fr',
   '{{auteur}} attend votre validation',
   '{{pieces}} pièces sont prêtes à partir au cabinet.',
   'Les valider', '/pme', null, null, date '2026-10-01'),

  ('facture.emise', 'email', 'fr',
   'Votre facture {{numero}}',
   'Votre abonnement {{offre}} pour {{periode}} : {{ttc}} TND TTC, à régler avant le {{echeance}}.',
   'Télécharger la facture', '/pme/reglages',
   'Malica Office — facture {{numero}}',
   '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-01'),

  ('invitation.recue', 'email', 'fr',
   '{{invitant}} vous invite sur {{societe}}',
   'Vous aurez accès aux pièces de {{societe}}. Votre espace personnel, lui, ne regardera personne.',
   'Accepter l''invitation', '/invitation',
   '{{invitant}} vous invite à rejoindre {{societe}}',
   '<!-- posé par le gabarit e-mail, voir design/emails/ -->', date '2026-10-01')
on conflict do nothing;

-- --- 6. L'isolation ---------------------------------------------------------

alter table notif.envois enable row level security;
alter table notif.envois force row level security;
revoke all on table notif.envois from public, anon, service_role;
grant select on table notif.envois to authenticated;
-- Personne n'insère à la main : la porte est `notif.poster`, qui est
-- `security definer`. C'est ce qui rend les quatre verrous incontournables.
drop policy if exists notif_envois_sel on notif.envois;
create policy notif_envois_sel on notif.envois
  for select to authenticated
  using (destinataire = auth.uid() or app.is_platform());
drop trigger if exists notif_envois_no_upd on notif.envois;
create trigger notif_envois_no_upd
  before update or delete on notif.envois
  for each row execute function app.deny_mutation();

alter table notif.remises enable row level security;
alter table notif.remises force row level security;
revoke all on table notif.remises from public, anon, service_role;
grant select on table notif.remises to authenticated;
drop policy if exists notif_remises_sel on notif.remises;
create policy notif_remises_sel on notif.remises
  for select to authenticated
  using (exists (select 1 from notif.envois e where e.id = envoi_id
                  and (e.destinataire = auth.uid() or app.is_platform())));
drop trigger if exists notif_remises_no_upd on notif.remises;
create trigger notif_remises_no_upd
  before update or delete on notif.remises
  for each row execute function app.deny_mutation();

grant select on notif.envois_v to authenticated;
revoke all on function notif.remettre(uuid, text, text) from public, anon;
grant execute on function notif.remettre(uuid, text, text) to authenticated;

alter table notif.preferences enable row level security;
alter table notif.preferences force row level security;
revoke all on table notif.preferences from public, anon, service_role;
grant select, insert, update on table notif.preferences to authenticated;
drop policy if exists notif_preferences_own on notif.preferences;
create policy notif_preferences_own on notif.preferences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notif.gabarits enable row level security;
revoke all on table notif.gabarits from public, anon, service_role;
grant select on table notif.gabarits to authenticated;
drop policy if exists notif_gabarits_sel on notif.gabarits;
create policy notif_gabarits_sel on notif.gabarits
  for select to authenticated using (true);

grant usage on schema notif to authenticated;
revoke all on function notif.poster(uuid, text, text, jsonb, uuid, text, interval)
  from public, anon;
grant execute on function notif.poster(uuid, text, text, jsonb, uuid, text, interval)
  to authenticated;

commit;
