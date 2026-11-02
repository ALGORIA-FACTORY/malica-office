-- ======================================================================
--  Le relecteur de nuit : une identité de service, bornée par la base
--  (passe de nuit, B.1 — conception validée par le dirigeant le 2 novembre 2026).
--
--  POURQUOI. La relecture de nuit partait au premier appel d'un MEMBRE du
--  dossier après son heure (`coureur.ts`) : jamais la nuit, et sous une
--  identité qui ne lit pas forcément la pièce (constat B.0, 20261118090000).
--  Une passe planifiée a besoin d'une identité qui ne soit pas une personne.
--
--  CE QUE CE N'EST PAS. Ni un rôle PostgreSQL privilégié, ni un secret. Le
--  relecteur se connecte comme l'API (`malica_api`), endosse `authenticated`
--  comme tout le monde, et porte des claims que seule `db.ts`
--  (`sousLeRelecteurDeNuit`) pose. La RLS reste la frontière (R6) : ce
--  fichier dit ce qu'elle lui ouvre, et c'est très peu.
--
--  CE QU'IL VOIT. `app.service()` rend `relecteur_de_nuit` seulement si le
--  claim `service` est posé, que `sub` est l'identifiant du compte, que le
--  compte est actif, et que la transaction est celle du serveur. Alors :
--    * `app.member_orgs()` rend le dossier du claim `service_tenant`, et
--      seulement s'il porte une relecture due ou en cours ;
--    * `app.engaged_orgs()` est vide, `app.is_platform()` est faux : un
--      cabinet n'ouvre pas ses PME, la plateforme n'ouvre rien ;
--    * `app.piece_lisible(p)` est vrai pour les pièces de ce dossier, et
--      d'aucun autre, tant qu'une relecture y est due ou en cours.
--  Et, sur TOUTE table de tenant hors de deux listes blanches :
--    * une politique RESTRICTIVE de lecture rend zéro ligne ;
--    * un déclencheur refuse toute écriture (`refus.service.hors_perimetre`) ;
--  dans la liste d'écriture, un déclencheur refuse toute ligne qui vise une
--  autre pièce que celle qu'il relit (`app.service_sur_sa_piece`).
--
--  ÉCART À LA CONCEPTION, ÉPROUVÉ (2 novembre 2026). La conception bornait la
--  LECTURE des pièces à la pièce relue. Exécuté, cela fausse ce que le code
--  existant juge : l'analyse d'une relecture retenue cherche le doublon
--  probable parmi les AUTRES pièces du dossier (`app.doublon_probable_de`,
--  sous l'identité de l'appelant), et la désignation par recette relit les
--  plans des pièces d'exemple. Bornée à une pièce, la relecture jugerait sur
--  un dossier tronqué — sans erreur, avec un verdict différent de celui d'un
--  membre. La lecture s'étend donc au dossier (tant qu'une relecture y est due),
--  l'écriture reste bornée à la pièce relue. `la-passe-de-nuit.test.ts` compare
--  le jugement rendu sous le relecteur à celui d'un membre qui voit tout.
--  `facturation.lectures` n'est pas dans la liste : une relecture ne se
--  décompte jamais (décision 3, ALGORIA paie). Les listes sont tenues par
--  `apps/api/src/verrous/relecteur-de-nuit.json` : une table de tenant
--  nouvelle, ni gardée ni nommée, fait échouer la CI.
--
--  RÉVOCATION SANS DÉPLOIEMENT. Le compte est déclaré une fois ; son état se
--  décide par la tour, motivé, en ajout seul (`identity.compte_de_service_regler`).
--
--  REJEU (R11) : l'identifiant et la date du compte sont des LITTÉRAUX.
-- ======================================================================

-- ------------------------------------------------------- 1. Le compte de service

create table identity.comptes_de_service (
  id         uuid primary key,
  code       text not null unique check (code ~ '^[a-z][a-z_]*$'),
  actif      boolean not null,
  motif      text not null check (length(btrim(motif)) > 0),
  decide_par uuid,
  decide_le  timestamptz not null
);

comment on table identity.comptes_de_service is
  'Les identités qui ne sont pas des personnes : un code, un identifiant fixe porté par le claim '
  '`sub`, et l''état déclaré à la création. L''état en vigueur est la dernière décision de la '
  'tour (identity.comptes_de_service_decisions), sinon celui-ci.';

alter table identity.comptes_de_service enable row level security;
alter table identity.comptes_de_service force row level security;
revoke all on table identity.comptes_de_service from public, anon;
grant select on table identity.comptes_de_service to authenticated;
create policy comptes_de_service_lire on identity.comptes_de_service
  for select to authenticated using ((select app.is_platform()));
create trigger comptes_de_service_ne_se_reecrivent_pas
  before update or delete on identity.comptes_de_service
  for each row execute function app.deny_mutation();

create table identity.comptes_de_service_decisions (
  id         uuid primary key default gen_random_uuid(),
  compte_id  uuid not null references identity.comptes_de_service (id),
  actif      boolean not null,
  motif      text not null check (length(btrim(motif)) > 0),
  decide_par uuid not null,
  decide_le  timestamptz not null default now()
);
create index comptes_de_service_decisions_compte_idx
  on identity.comptes_de_service_decisions (compte_id, decide_le desc);

comment on table identity.comptes_de_service_decisions is
  'Les décisions de la tour sur un compte de service (actif ou révoqué), motivées, en ajout seul. '
  'La plus récente vaut.';

alter table identity.comptes_de_service_decisions enable row level security;
alter table identity.comptes_de_service_decisions force row level security;
revoke all on table identity.comptes_de_service_decisions from public, anon;
grant select on table identity.comptes_de_service_decisions to authenticated;
create policy comptes_de_service_decisions_lire on identity.comptes_de_service_decisions
  for select to authenticated using ((select app.is_platform()));
create trigger comptes_de_service_decisions_ne_se_reecrivent_pas
  before update or delete on identity.comptes_de_service_decisions
  for each row execute function app.deny_mutation();

-- L'état en vigueur, en un endroit : la dernière décision, sinon la déclaration.
create view identity.comptes_de_service_v with (security_invoker = true) as
select c.id, c.code,
       coalesce(d.actif, c.actif)         as actif,
       coalesce(d.motif, c.motif)         as motif,
       coalesce(d.decide_le, c.decide_le) as decide_le
  from identity.comptes_de_service c
  left join lateral (
    select x.actif, x.motif, x.decide_le
      from identity.comptes_de_service_decisions x
     where x.compte_id = c.id
     order by x.decide_le desc, x.id desc
     limit 1
  ) d on true;

revoke all on identity.comptes_de_service_v from public, anon;
grant select on identity.comptes_de_service_v to authenticated;

-- Le relecteur de nuit : identifiant et date littéraux (R11).
insert into identity.comptes_de_service (id, code, actif, motif, decide_par, decide_le)
values ('6f1d2c3b-8a47-4e59-9b0c-7d2e4f5a6b81', 'relecteur_de_nuit', true,
        'Passe de nuit, conception validée par le dirigeant le 2 novembre 2026.', null,
        timestamptz '2026-11-02 00:00:00+00');

insert into ref.labels (ns, key, locale, value) values
  ('compte_de_service', 'relecteur_de_nuit', 'fr', 'Relecteur de nuit (service ALGORIA)'),
  ('compte_de_service', 'relecteur_de_nuit', 'en', 'Night re-reader (ALGORIA service)'),
  ('compte_de_service', 'relecteur_de_nuit', 'ar', 'القارئ الليلي (خدمة ألغوريا)');

-- ---------------------------------------------------- 2. Qui est le service, ici et maintenant

/*
 * Le code du service qui conduit cette transaction, ou nul. Les quatre
 * conditions ensemble : le claim, l'identifiant du compte en `sub`, le compte
 * actif, la marque du serveur. Un claim posé avec le `sub` d'une personne, sans
 * la marque du serveur, ou sur un compte révoqué ne vaut rien.
 */
create function app.service()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select v.code
    from identity.comptes_de_service_v v
   where v.code = nullif(current_setting('request.jwt.claim.service', true), '')
     and v.id = auth.uid()
     and v.actif
     and coalesce(current_setting('malica.origine', true), '') = 'serveur'
$$;

revoke all on function app.service() from public, anon;
grant execute on function app.service() to authenticated;

comment on function app.service() is
  'Le code du compte de service qui conduit la transaction (claim `service`, `sub` = son '
  'identifiant, compte actif, origine serveur), ou nul.';

/* Le dossier que le relecteur de nuit relit, s'il est bien le relecteur de nuit. */
create function app.dossier_du_service()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.service_tenant', true), '')::uuid
   where app.service() = 'relecteur_de_nuit'
$$;

revoke all on function app.dossier_du_service() from public, anon;
grant execute on function app.dossier_du_service() to authenticated;

/*
 * Une relecture due (prenable) ou en cours dans ce dossier — sur cette pièce
 * si elle est dite. `security definer` et hors RLS : elle est appelée par
 * `app.member_orgs()` et `app.piece_lisible()`, que la RLS des travaux appelle
 * à son tour ; sous l'identité de l'appelant, ce serait une récursion.
 * Elle ne répond qu'au relecteur, pour SON dossier : à toute autre identité,
 * faux — elle n'apprend rien de la file d'un dossier à qui la sonde.
 */
create function app.relecture_due(p_tenant uuid, p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.dossier_du_service() is not distinct from p_tenant
     and p_tenant is not null
     and exists (
       select 1 from fabrique.etat_des_travaux_v e
        where e.tenant_id = p_tenant
          and (p_piece is null or e.piece_id = p_piece)
          and e.nature = 'relecture_piece'
          and (e.prenable or e.etat = 'en_cours'))
$$;

-- Exécutable par `authenticated` : la politique des pièces la nomme, et
-- PostgreSQL vérifie ce droit même là où le `case` ne l'évalue pas.
revoke all on function app.relecture_due(uuid, uuid) from public, anon;
grant execute on function app.relecture_due(uuid, uuid) to authenticated;

/*
 * Les organisations où une PERSONNE donnée porte un droit : la règle de
 * `app.orgs_avec_droit`, écrite une fois, pour l'appelant comme pour l'auteur
 * de la pièce que relit le relecteur de nuit.
 */
create function app.orgs_avec_droit_de(p_personne uuid, p_droit text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from identity.memberships m
    join identity.organizations o on o.id = m.tenant_id
    join ref.droits_des_roles d
      on d.org_kind = o.kind and d.role = m.role and d.droit = p_droit
     and d.valid_from <= current_date
     and (d.valid_to is null or d.valid_to > current_date)
   where m.user_id = p_personne
$$;

revoke all on function app.orgs_avec_droit_de(uuid, text) from public, anon, authenticated;

create or replace function app.orgs_avec_droit(p_droit text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select x from app.orgs_avec_droit_de(auth.uid(), p_droit) x
   where app.api_tenant() is null
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
$function$;

/*
 * Une pièce de son dossier que le relecteur peut LIRE : jamais plus que
 * l'auteur de la relecture EN COURS n'en verrait (revue indépendante et Codex,
 * PR #200) — `app.piece_lisible` pour cette personne :
 *   - une pièce archivée, jamais ;
 *   - une pièce de cet auteur, oui ;
 *   - une pièce de la société d'un AUTRE auteur, seulement si cet auteur a
 *     `societe.tout_voir` dans le dossier ;
 *   - une pièce personnelle d'un autre, jamais.
 * Quand aucune relecture n'est en cours, il ne voit que les pièces qui portent
 * elles-mêmes une relecture due — ce que la file doit voir pour la prendre.
 * Sans cela, le doublon probable cherché pendant la relecture de la pièce de
 * Sami pouvait désigner une facture de Sonia que Sami ne voit pas
 * (`preuves.semblable`).
 */
create function app.piece_lisible_au_relecteur(
  p_tenant uuid, p_piece uuid, p_vis app.vis_t, p_auteur uuid, p_archivee timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auteur_en_cours uuid;
begin
  if p_tenant is null or p_archivee is not null
     or app.dossier_du_service() is distinct from p_tenant
     or not app.relecture_due(p_tenant, null) then
    return false;
  end if;
  select q.created_by into v_auteur_en_cours
    from fabrique.etat_des_travaux_v e
    join capture.pieces q on q.id = e.piece_id
   where e.tenant_id = p_tenant and e.nature = 'relecture_piece' and e.etat = 'en_cours'
   limit 1;
  if v_auteur_en_cours is null then
    return app.relecture_due(p_tenant, p_piece);
  end if;
  return p_auteur is not distinct from v_auteur_en_cours
      or (p_vis in ('entite'::app.vis_t, 'partage'::app.vis_t)
          and p_tenant in (select app.orgs_avec_droit_de(v_auteur_en_cours, 'societe.tout_voir')));
end
$$;

revoke all on function app.piece_lisible_au_relecteur(uuid, uuid, app.vis_t, uuid, timestamptz)
  from public, anon;
grant execute on function app.piece_lisible_au_relecteur(uuid, uuid, app.vis_t, uuid, timestamptz)
  to authenticated;

/* L'identifiant d'un compte de service, pour l'API seule : aucun uuid n'est écrit en TypeScript. */
create function app.compte_de_service_id(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from identity.comptes_de_service c where c.code = p_code
$$;

-- Le rôle de connexion de l'API la lit AVANT d'endosser `authenticated` : il
-- lui faut l'usage du schéma, et l'exécution de cette seule fonction.
grant usage on schema app to malica_api;
revoke all on function app.compte_de_service_id(text) from public, anon, authenticated;
grant execute on function app.compte_de_service_id(text) to malica_api;

/* Le code du compte de service derrière un acteur du journal, ou nul (une personne). */
create function app.compte_de_service_de(p_acteur uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.code from identity.comptes_de_service c where c.id = p_acteur
$$;

revoke all on function app.compte_de_service_de(uuid) from public, anon;
grant execute on function app.compte_de_service_de(uuid) to authenticated;

-- ------------------------------------------------ 3. Ce que la RLS lui ouvre, et rien d'autre

create or replace function app.member_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select m.tenant_id
    from identity.memberships m
   where app.api_tenant() is null
     and m.user_id = auth.uid()
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
  union all
  -- Le relecteur de nuit : son dossier, tant qu'il y a une relecture à faire.
  select s.dossier
    from (select app.dossier_du_service() as dossier) s
   where s.dossier is not null
     and app.relecture_due(s.dossier, null)
$function$;

create or replace function app.engaged_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select e.pme_org_id
    from identity.engagements e
   where e.cabinet_org_id in (select app.member_orgs())
     and (select app.service()) is null
     and e.status = 'actif'
     and e.starts_on <= current_date
     and (e.ends_on is null or e.ends_on >= current_date)
     and (
       app.has_org_role(e.cabinet_org_id, array['expert'])
       or exists (select 1 from collab.assignments a
                   where a.cabinet_tenant_id = e.cabinet_org_id
                     and a.client_tenant_id = e.pme_org_id
                     and a.collaborator_id = auth.uid()
                     and a.active)
     )
$function$;

create or replace function app.is_platform()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select app.api_tenant() is null
     and (select app.service()) is null
     and exists (select 1 from app.platform_operators po where po.user_id = auth.uid())
$function$;

create or replace function app.piece_lisible(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from capture.pieces p
    -- La version courante juge : une version précédente n'a pas de
    -- visibilité propre.
    where p.id = app.version_courante(p_piece)
      and (
        (p.archivee_le is null and (
             (p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
          or (p.vis in ('entite'::app.vis_t, 'partage'::app.vis_t) and (
                p.tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
                or (p.tenant_id in (select app.member_orgs()) and p.created_by = auth.uid())))
          or (p.vis = 'partage'::app.vis_t and p.tenant_id in (select app.engaged_orgs()))))
        or (p.archivee_le is not null
            and p.tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(p.id))
        -- L'exception, et elle est nommée.
        or app.plateforme_requise(p.tenant_id)
        -- Le relecteur de nuit : les pièces de son dossier, en LECTURE, tant
        -- qu'une relecture y est due ou en cours, jamais plus que l'auteur de la
        -- pièce relue n'en verrait (`app.piece_lisible_au_relecteur`). Voir
        -- l'en-tête : l'analyse juge la pièce contre son dossier (doublon
        -- probable). Il n'ÉCRIT que sur la pièce qu'il relit.
        or case when app.dossier_du_service() is null then false
                else app.piece_lisible_au_relecteur(p.tenant_id, p.id, p.vis, p.created_by,
                                                    p.archivee_le) end
      )
  )
$function$;

-- La politique de lecture des pièces porte la règle de `app.piece_lisible`
-- en ligne (20261104090000, pour la servir sans appel par ligne) : la même
-- branche du relecteur s'y ajoute, et rien d'autre ne change. Pour toute
-- autre identité, le `case` s'arrête sur un dossier de service nul.
drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    case
      when app.piece_remplacee(id) then app.piece_lisible(id)
      else (
        (archivee_le is null and (
             (vis = 'personnel'::app.vis_t and created_by = auth.uid())
          or (vis in ('entite'::app.vis_t, 'partage'::app.vis_t) and (
                tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
                or (tenant_id in (select app.member_orgs()) and created_by = auth.uid())))
          or (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))))
        or (archivee_le is not null
            and tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(id))
        or app.plateforme_requise(tenant_id)
        or case when (select app.dossier_du_service()) is null then false
                else app.piece_lisible_au_relecteur(tenant_id, id, vis, created_by,
                                                    archivee_le) end)
    end);

-- --------------------------------------------- 4. Ce qu'il n'écrit pas, ce qu'il ne lit pas

/*
 * Hors de la liste blanche d'écriture : aucune écriture d'un compte de
 * service. Le claim absent — le cas de toute personne —, on sort sans lire
 * aucune table.
 */
create function app.service_hors_perimetre()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(current_setting('request.jwt.claim.service', true), '') is not null
     and app.service() is not null then
    raise exception 'refus.service.hors_perimetre' using errcode = '42501';
  end if;
  return null;
end
$$;

comment on function app.service_hors_perimetre() is
  'Refuse toute écriture d''un compte de service sur une table de tenant hors de sa liste '
  'blanche (apps/api/src/verrous/relecteur-de-nuit.json).';

/*
 * Dans la liste blanche d'écriture : le relecteur n'écrit que sur la pièce
 * qu'il relit — une pièce de son dossier qui porte une relecture due ou en
 * cours. Il LIT le dossier ; il n'en touche rien d'autre.
 */
create function app.service_sur_sa_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_piece uuid;
begin
  if nullif(current_setting('request.jwt.claim.service', true), '') is null
     or app.service() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_piece := (to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> tg_argv[0])::uuid;
  -- Une ligne sans pièce (un coût, une exécution) n'est pas de la relecture : refusée.
  if v_piece is null
     or not app.relecture_due(app.dossier_du_service(), v_piece) then
    raise exception 'refus.service.hors_perimetre' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

comment on function app.service_sur_sa_piece() is
  'Un compte de service n''écrit que sur une pièce qu''il relit (relecture due ou en cours). '
  'L''argument nomme la colonne de la pièce.';

/*
 * Les deux listes blanches, établies par la lecture du chemin de relecture
 * (`relirePiece` : contexte, sudoku, désignation par recette, persistance,
 * analyse) et par l'épreuve bout en bout (`la-passe-de-nuit.test.ts`) : ce
 * qu'il écrit, et ce qu'il lit sous sa propre identité — ce que lisent les
 * fonctions `security definer` du propriétaire n'a pas à y être. Une table
 * lue mais gardée ne lève pas : elle rend zéro ligne, et la relecture
 * jugerait sur un dossier tronqué. C'est pourquoi la liste de lecture se tient
 * à la lecture du code, pas aux seuls échecs.
 *
 * Tout le reste est gardé — y compris ce qu'une table de tenant créée demain
 * portera, puisque le verrou de la CI exige qu'elle soit gardée ou nommée.
 */
do $$
declare
  r record;
  v_piece text;
  v_ecrit constant text[] := array[
    'agents.agent_runs', 'audit.event_log',
    'capture.analyses', 'capture.champs_lus', 'capture.citations', 'capture.extractions',
    'capture.piece_articles', 'capture.pieces', 'capture.token_plan',
    'fabrique.executions', 'fabrique.travail_faits'];
  v_lit constant text[] := v_ecrit || array[
    'capture.precisions', 'capture.remplacements',
    'fabrique.exemples', 'fabrique.promotions', 'fabrique.recette_version_exemples',
    'fabrique.recette_versions', 'fabrique.recettes', 'fabrique.travaux',
    'identity.fiches_fiscales', 'parametrage.fabrique_seuils', 'tiers.auxiliaires'];
begin
  for r in
    select n.nspname as s, c.relname as t, n.nspname || '.' || c.relname as nom
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
                         and a.attnum > 0 and not a.attisdropped
     where c.relkind = 'r'
       and n.nspname not in ('pg_catalog', 'information_schema')
  loop
    if not (r.nom = any (v_ecrit)) then
      execute format(
        'create trigger service_hors_perimetre before insert or update or delete on %I.%I '
        'for each statement execute function app.service_hors_perimetre()', r.s, r.t);
    else
      v_piece := case when r.nom = 'capture.pieces' then 'id'
                      when exists (select 1 from pg_attribute x
                                    where x.attrelid = (r.s || '.' || r.t)::regclass
                                      and x.attname = 'piece_id' and not x.attisdropped)
                        then 'piece_id' end;
      if v_piece is not null then
        execute format(
          'create trigger service_sur_sa_piece before insert or update or delete on %I.%I '
          'for each row execute function app.service_sur_sa_piece(%L)', r.s, r.t, v_piece);
      end if;
    end if;
    if not (r.nom = any (v_lit)) then
      execute format(
        'create policy service_hors_perimetre on %I.%I as restrictive for select '
        'to authenticated using ((select app.service()) is null)', r.s, r.t);
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------ 5. La révocation : par la tour

create function identity.compte_de_service_regler(p_code text, p_actif boolean, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_compte uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_actif is null or p_motif is null or length(btrim(p_motif)) = 0 then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  select c.id into v_compte from identity.comptes_de_service c where c.code = p_code;
  if v_compte is null then
    raise exception 'refus.introuvable.compte_de_service' using errcode = '42501';
  end if;
  insert into identity.comptes_de_service_decisions (compte_id, actif, motif, decide_par)
  values (v_compte, p_actif, btrim(p_motif), auth.uid());
  return (select to_jsonb(v) from identity.comptes_de_service_v v where v.id = v_compte);
end
$$;

revoke all on function identity.compte_de_service_regler(text, boolean, text) from public, anon;
grant execute on function identity.compte_de_service_regler(text, boolean, text) to authenticated;

comment on function identity.compte_de_service_regler(text, boolean, text) is
  'La tour active ou révoque un compte de service, motivé, en ajout seul : sans déploiement.';
