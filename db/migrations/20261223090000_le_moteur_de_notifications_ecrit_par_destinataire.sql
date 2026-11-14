-- Le moteur de notifications écrit une ligne par destinataire.
--
-- ================================================================== POURQUOI
--
-- Deux systèmes disaient « notification » sans se parler. `collab.notifications`
-- portait le fil de l'application : une ligne par société, et QUI la lit était
-- décidé à chaque lecture (membre, cabinet engagé, visibilité de la pièce).
-- `notif.poster` portait la retenue (droit, cadence, silence, doublon) pour le
-- courriel et le push, et déposait au passage une copie dans l'ancien fil.
-- Vingt-huit fonctions écrivaient directement dans l'ancien fil, sans retenue.
--
-- Le moteur n'en garde qu'un : `notif.envois`, une ligne par destinataire et par
-- canal (`app`, `email`, `push`), écrite par une seule porte, `notif.emettre`.
--
-- ============================================ CE QUE CHANGE « UNE LIGNE PAR PERSONNE »
--
-- QUI reçoit est décidé UNE FOIS, à l'écriture, par la règle de lecture de
-- l'ancien fil — rejouée pour chaque personne qui pourrait la lire
-- (`notif.audience`) : on ne réécrit pas cette règle, on l'exécute en prenant
-- tour à tour l'identité de chaque candidat. Conséquence assumée : l'accès
-- acquis plus tard ne rend pas les notifications passées. L'accès PERDU, lui,
-- les cache aussitôt (`notif.centre` exige l'accès actuel à la société).
--
-- ============================================ CE QUI RESTE EN AJOUT SEUL (R7)
--
-- `notif.envois` ne se réécrit pas. Ce que l'ancien fil mutait — « lue »,
-- « tranchée : acceptée / refusée » — devient deux faits de plus dans
-- `notif.suites`, un par personne et par nature, déduits à la lecture.
--
-- Cette migration ne retire rien et ne bascule rien : l'ancien fil vit encore.
-- La suivante réécrit les producteurs et le retire.

begin;

-- --- 1. envois porte les données de l'événement ------------------------------

alter table notif.envois add column if not exists donnees jsonb not null default '{}'::jsonb;

-- Le texte d'une ligne `app` se compose à l'écran, dans la langue de la
-- personne, à partir du genre et des données : aucun texte rendu n'est figé.
alter table notif.envois alter column titre_rendu drop not null;
alter table notif.envois alter column corps_rendu drop not null;
alter table notif.envois drop constraint if exists envois_texte_rendu;
alter table notif.envois add constraint envois_texte_rendu
  check (canal = 'app' or (titre_rendu is not null and corps_rendu is not null));

create index if not exists envois_centre_idx
  on notif.envois (destinataire, tenant_id, cree_le desc) where canal = 'app';

-- --- 2. Ce qu'il advient d'une notification, par personne --------------------

create table notif.suites (
  id           uuid primary key default gen_random_uuid(),
  envoi_id     uuid not null references notif.envois(id),
  tenant_id    uuid not null references identity.organizations(id),
  destinataire uuid not null,
  nature       text not null check (nature in ('lue','tranchee')),
  issue        text,
  cree_le      timestamptz not null default now(),
  unique (envoi_id, nature),
  constraint suites_issue_si_tranchee check ((nature = 'tranchee') = (issue is not null))
);

create index suites_tenant_idx on notif.suites (tenant_id, cree_le desc);
create index suites_destinataire_idx on notif.suites (destinataire, envoi_id);

create trigger notif_suites_no_upd before update or delete on notif.suites
  for each row execute function app.deny_mutation();
create trigger service_hors_perimetre before insert or update or delete on notif.suites
  for each statement execute function app.service_hors_perimetre();

alter table notif.suites enable row level security;
alter table notif.suites force row level security;

create policy notif_suites_sel on notif.suites for select to authenticated
  using (destinataire = (select auth.uid()));
create policy notif_suites_ins on notif.suites for insert to authenticated
  with check (destinataire = (select auth.uid()));
create policy service_hors_perimetre on notif.suites as restrictive for select to authenticated
  using ((select app.service()) is null);

-- Aucun client n'écrit : seule la porte qui marque « lue » (le portier) insère,
-- pour la personne qui l'appelle et pour elle seule.
revoke all on notif.suites from public, anon;
grant select on notif.suites to authenticated;
grant insert on notif.suites to portier;

-- --- 2bis. Ce qui part au-delà de l'application ------------------------------
--
-- L'application reçoit TOUT ce que la porte écrit. Le courriel et le push, non :
-- un genre ne part sur un canal que si cette table le dit, avec le gabarit à
-- employer. Ce n'est pas déduit de « un gabarit existe » : `facture.emise` a un
-- modèle de courriel, et l'événement du même nom ne doit pas pour autant partir
-- par courriel. Ajouter un canal à un genre est une ligne, datée, pas un
-- déploiement. Livrés : les quatre paliers de relance d'impayé, par courriel.

create table notif.diffusions (
  code       text not null,
  canal      text not null check (canal in ('email','push')),
  gabarit    text not null,
  valid_from date not null,
  valid_to   date,
  primary key (code, canal, valid_from),
  check (valid_to is null or valid_to > valid_from)
);

alter table notif.diffusions enable row level security;
create policy notif_diffusions_sel on notif.diffusions for select to authenticated using (true);
revoke all on notif.diffusions from public, anon;
grant select on notif.diffusions to authenticated;

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('impaye.relance',            'email', 'impaye.relance',            date '2026-10-01'),
  ('impaye.rappel',             'email', 'impaye.rappel',             date '2026-10-01'),
  ('impaye.suspension',         'email', 'impaye.suspension',         date '2026-10-01'),
  ('impaye.avis_de_suspension', 'email', 'impaye.avis_de_suspension', date '2026-10-01');

-- --- 3. Qui peut avoir un lien avec la société -------------------------------
--
-- Les candidats : les membres de la société, les experts des cabinets qui y sont
-- engagés, les collaborateurs affectés. C'est un ensemble LARGE, volontairement :
-- c'est `notif.audience` qui tranche, avec la règle de lecture. Le même ensemble
-- sert au verrou « droit » de `notif.poster`, pour que le cabinet reçoive ce
-- que l'application lui montre.

create or replace function notif.candidats(p_tenant uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from identity.memberships m where m.tenant_id = p_tenant
  union
  select m.user_id
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id
   where e.pme_org_id = p_tenant
     and app.engagement_en_vigueur(e.status, e.starts_on, e.ends_on)
     -- La règle d'engagement ne retient d'un cabinet que ses experts et les
     -- collaborateurs affectés (ci-dessous) : les autres membres ne sont pas
     -- des candidats, et chaque candidat coûte une évaluation.
     and m.role = 'expert'
  union
  select a.collaborator_id
    from collab.assignments a
   where a.client_tenant_id = p_tenant and a.active
$$;

-- --- 4. Qui reçoit : la règle de lecture, jouée pour chaque candidat ---------
--
-- Pour une notification adressée à une personne (`p_personne`), elle seule. Pour
-- une notification de société, chaque candidat qui aurait pu la lire dans
-- l'ancien fil, selon les mêmes règles :
--   - il a accès à la société (membre, ou cabinet engagé) ;
--   - hors membre : jamais ce qui est « chez le propriétaire », et une pièce
--     citée doit lui être lisible ou connue du cabinet ;
--   - membre : une pièce citée doit lui être lisible, sinon il faut le droit de
--     tout voir dans la société.
-- L'identité est prise le temps de l'évaluation, puis rendue : `auth.uid()` lit
-- le réglage de la transaction, et c'est lui que toute la règle interroge.

create or replace function notif.audience(p_tenant uuid, p_donnees jsonb, p_personne uuid default null)
returns setof uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_rendu   text := coalesce((select auth.uid())::text, '');
  v_piece   uuid := app.uuid_ou_null(p_donnees ->> 'piece_id');
  v_connue  boolean := false;
  v_cand    uuid;
  v_membre  boolean;
  v_ok      boolean;
begin
  if p_personne is not null then
    return next p_personne;
    return;
  end if;

  if v_piece is not null then
    v_connue := exists (select 1 from capture.pieces p where p.id = v_piece);
  end if;

  begin
    for v_cand in select c from notif.candidats(p_tenant) c loop
      perform set_config('request.jwt.claim.sub', v_cand::text, true);
      v_membre := p_tenant in (select app.member_orgs());
      if not (v_membre or p_tenant in (select app.engaged_orgs())) then
        continue;
      end if;
      if not v_membre then
        v_ok := coalesce(p_donnees ->> 'chez', '') <> 'proprietaire'
                and (not v_connue
                     or app.piece_lisible(v_piece)
                     or app.piece_connue_du_cabinet(v_piece));
      elsif v_piece is not null then
        v_ok := case when v_connue then app.piece_lisible(v_piece)
                     else p_tenant in (select app.orgs_avec_droit('societe.tout_voir')) end;
      else
        v_ok := true;
      end if;
      if v_ok then
        return next v_cand;
      end if;
    end loop;
  exception when others then
    perform set_config('request.jwt.claim.sub', v_rendu, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
end
$$;

-- --- 5. La porte : tout ce qui notifie passe ici -----------------------------
--
-- Une ligne `app` pour chaque personne de l'audience, remise sur-le-champ (le
-- centre de notifications est l'application même). Si le genre a un gabarit
-- `app`, son texte est rendu dans la ligne (`titre`, `corps`), comme le faisait
-- l'ancien dépôt. Puis, pour chaque diffusion en vigueur du genre,
-- `notif.poster` — les quatre verrous — avec le gabarit que la table nomme.
-- `p_sujet_cle` nomme ce dont on parle, pour le doublon : à défaut, la pièce, à
-- défaut la société. Rend le nombre de destinataires de l'application.

create or replace function notif.emettre(
  p_tenant    uuid,
  p_code      text,
  p_donnees   jsonb default '{}'::jsonb,
  p_personne  uuid default null,
  p_sujet_cle text default null,
  p_fenetre   interval default interval '24 hours')
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_dest   uuid;
  v_envoi  uuid;
  v_cle    text := coalesce(p_sujet_cle, p_donnees ->> 'piece_id', p_tenant::text);
  v_gab    record;
  v_texte  jsonb;
  k        text;
  v_titre  text;
  v_corps  text;
  d        record;
  v_n      integer := 0;
begin
  for v_dest in select a from notif.audience(p_tenant, p_donnees, p_personne) a loop
    v_texte := '{}'::jsonb;
    select g.titre, g.corps into v_gab
      from notif.gabarits g
      left join identity.profiles pr on pr.user_id = v_dest
     where g.code = p_code and g.canal = 'app'
       and g.locale in (coalesce(pr.locale, 'fr'), 'fr')
       and g.effective_from <= current_date
     order by (g.locale = coalesce(pr.locale, 'fr')) desc, g.effective_from desc
     limit 1;
    if v_gab.titre is not null then
      v_titre := v_gab.titre; v_corps := v_gab.corps;
      for k in select jsonb_object_keys(p_donnees) loop
        v_titre := replace(v_titre, '{{' || k || '}}', coalesce(p_donnees ->> k, ''));
        v_corps := replace(v_corps, '{{' || k || '}}', coalesce(p_donnees ->> k, ''));
      end loop;
      v_texte := jsonb_build_object('titre', v_titre, 'corps', v_corps);
    end if;

    -- Une ligne `app` appartient à une société : sans elle, rien à montrer.
    if p_tenant is not null then
      insert into notif.envois (tenant_id, destinataire, code, canal, sujet_cle, decision, donnees)
      values (p_tenant, v_dest, p_code, 'app', v_cle, 'a_remettre', p_donnees || v_texte)
      returning id into v_envoi;
      insert into notif.remises (envoi_id, resultat) values (v_envoi, 'remis');
    end if;

    -- Un canal qui échoue (gabarit absent, par exemple) ne défait jamais
    -- l'opération qui notifie : il se dit au journal du serveur, et rien d'autre.
    for d in select x.canal, x.gabarit from notif.diffusions x
              where x.code = p_code
                and x.valid_from <= current_date
                and (x.valid_to is null or x.valid_to > current_date) loop
      begin
        perform notif.poster(v_dest, d.gabarit, v_cle, p_donnees, p_tenant, d.canal, p_fenetre);
      exception when others then
        raise warning 'notif.emettre : % par % non posté (%)', p_code, d.canal, sqlerrm;
      end;
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- --- 6. La lecture : le centre de la personne --------------------------------
--
-- Ses lignes `app`, pour les sociétés demandées, à condition qu'elle y ait
-- ACCÈS aujourd'hui ; les non lues et les cent plus récentes. Même forme que
-- l'ancien lecteur, pour que l'écran ne change pas : `read_at` est la date de
-- lecture, ou de décision ; `payload` reçoit `tranchee` quand la demande l'est.
-- `security invoker` : la politique de `notif.envois` borne déjà à la personne.

create or replace function notif.centre(p_tenants uuid[])
returns table (id uuid, tenant_id uuid, kind text, payload jsonb,
               created_at timestamptz, read_at timestamptz)
language sql stable set search_path = ''
as $$
  with moi as materialized (select (select auth.uid()) as uid),
  acces as materialized (
    select m as org from app.member_orgs() m
    union
    select e as org from app.engaged_orgs() e
  ),
  visibles as (
    select e.id, e.tenant_id, e.code, e.donnees, e.cree_le,
           l.cree_le as lue_le, t.issue, t.cree_le as tranchee_le,
           row_number() over (order by e.cree_le desc, e.id) as rang
      from notif.envois e
      join moi on e.destinataire = moi.uid
      left join notif.suites l on l.envoi_id = e.id and l.nature = 'lue'
      left join notif.suites t on t.envoi_id = e.id and t.nature = 'tranchee'
     where e.canal = 'app'
       and e.tenant_id = any(p_tenants)
       and e.tenant_id in (select org from acces)
  )
  select v.id, v.tenant_id, v.code,
         case when v.issue is null then v.donnees
              else v.donnees || jsonb_build_object('tranchee', v.issue) end,
         v.cree_le,
         coalesce(v.lue_le, v.tranchee_le)
    from visibles v
   where coalesce(v.lue_le, v.tranchee_le) is null or v.rang <= 100
$$;

-- --- 7. Les droits -----------------------------------------------------------
--
-- Aucun client n'écrit ni n'appelle la porte : seuls les propriétaires des
-- producteurs. La lecture, elle, est le centre de la personne.

revoke all on function notif.candidats(uuid) from public, anon, authenticated;
revoke all on function notif.audience(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function notif.emettre(uuid, text, jsonb, uuid, text, interval) from public, anon, authenticated;
grant execute on function notif.emettre(uuid, text, jsonb, uuid, text, interval) to portier;

revoke all on function notif.centre(uuid[]) from public, anon;
grant execute on function notif.centre(uuid[]) to authenticated;

-- --- 8. `notif.poster` ne dépose plus de copie, et le cabinet a le droit -----
--
-- Il décidait seul d'écrire dans l'ancien fil : c'est désormais `notif.emettre`.
-- Le verrou « droit » reprend l'ensemble des candidats, pour que le cabinet
-- engagé reçoive ce que l'application lui montre. Et il n'est plus appelable par
-- un client : n'importe quel connecté pouvait poster à n'importe qui.

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
     titre_rendu, corps_rendu, decision, motif_abandon)
  values
    (p_tenant, p_destinataire, p_code, p_canal, g.id, p_sujet_cle,
     v_titre, v_corps,
     case when v_abandon is null then 'a_remettre' else 'abandonne' end,
     v_abandon)
  returning id into v_id;

  return jsonb_build_object('envoi_id', v_id, 'poste', v_abandon is null,
                            'motif', v_abandon, 'canal', p_canal);
end
$$;

revoke all on function notif.poster(uuid, text, text, jsonb, uuid, text, interval) from public, anon, authenticated;
grant execute on function notif.poster(uuid, text, text, jsonb, uuid, text, interval) to portier;

commit;
