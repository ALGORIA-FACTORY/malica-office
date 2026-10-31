-- Toute écriture passe par une porte (lot 6, « verrous en base », suite et fin).
--
-- `20261104130000` a posé le principe — une table d'état ou de faits ne
-- s'écrit que par une porte (`security definer`) qui contrôle les droits — et
-- retiré 145 droits d'écriture des clients. Il en restait 108, inventoriés
-- dans `apps/api/src/verrous/ecritures-des-clients.json` avec les chemins qui
-- les exigeaient : 49 fonctions `security invoker` et une quarantaine de
-- requêtes de l'API. Avec eux, un membre authentifié écrivait en SQL brut une
-- écriture comptable, une ligne de relevé, un mouvement de stock, une
-- analyse, un fait du journal signé de lui-même, et réécrivait le statut
-- d'une pièce colonne par colonne.
--
-- Ici, il n'en reste aucun.
--
-- 1. LE PORTIER. Les portes qui reprennent ces chemins appartiennent à un rôle
--    sans connexion, `portier`, membre d'`authenticated` : il n'est ni
--    superutilisateur, ni propriétaire d'aucune table, ni `bypassrls`. Une
--    porte s'exécute donc sous les MÊMES politiques RLS que le client qui
--    l'appelle (appartenance, mandat, affectation, `auth.uid()`) : la RLS reste
--    le contrôle d'appartenance, comme elle l'était quand ces fonctions
--    tournaient en `security invoker`. Ce que le portier a de plus que le
--    client, ce sont exactement les droits d'écriture que le client perd ici
--    — rien d'autre. Aucune porte ne peut donc faire plus que ce que son
--    chemin faisait hier ; le client, lui, ne peut plus rien écrire sans elle.
--    Personne n'est membre de `portier` : aucune session ne l'endosse.
--
-- 2. LES 48 FONCTIONS `security invoker` qu'appelle un client deviennent des
--    portes (section 2), sans changer une ligne de leur corps ; la 49e n'est
--    appelée que par des portes de la base, et le client perd le droit de
--    l'appeler.
--
-- 3. LES REQUÊTES DE L'API deviennent des portes (sections 5 à 15) : chacune
--    fixe ce que le client écrit (colonnes, dossier tiré de l'objet, jamais de
--    la parole de l'appelant), valide la saisie avec un refus lisible (4xx),
--    et refuse en 42501 ce qu'elle ne trouve pas — là où l'API se taisait
--    (zéro ligne modifiée, aucun mot).
--
-- 4. LE JOURNAL D'AUDIT ne s'écrit plus par le client : les portes y
--    inscrivent leurs faits elles-mêmes. Les trois faits que l'API écrivait
--    seule passent par une porte unique, `public.fait_consigner`, qui signe de
--    l'appelant et ne connaît que les natures du référentiel
--    `ref.faits_consignables`, chacune avec sa garde.
--
-- 5. Puis tous les droits d'écriture des clients sur les tables et les vues
--    sont retirés (section 16). L'épreuve
--    `les-clients-n-ecrivent-que-par-les-portes.test.ts` vérifie qu'il n'en
--    reste aucun, et que les droits du portier sont ceux que l'inventaire
--    nomme, avec les portes qui les exigent.
--
-- REJEU (R11) : rôle créé s'il manque, `create or replace`, `on conflict do
-- nothing` ; aucune date du jour dans le référentiel.

begin;

-- --- 1. Le portier ----------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'portier') then
    create role portier nologin inherit;
  end if;
end
$$;

-- Membre d'`authenticated` : les politiques `to authenticated` s'appliquent à
-- lui, ses lectures sont les siennes. Jamais l'inverse.
grant authenticated to portier;

-- --- 2. Les fonctions `security invoker` qui écrivaient deviennent des portes ---------------------
--
-- Le corps ne change pas. Le droit d'exécution reste ce qu'il était pour
-- `authenticated`, et se retire à `public` et `anon` (un appel anonyme n'a
-- aucune identité à faire valoir).

do $$
declare
  f regprocedure;
  v_client boolean;
begin
  foreach f in array array[
    'app.annulation_contre_passe_le_reglement()',
    'fabrique.generation_proposer(uuid, text)',
    'fabrique.travail_prendre(uuid, fabrique.travail_nature_t[])',
    'public.agents_run_log(uuid, text, text, text, text, integer, integer, integer, uuid, text)',
    'public.api_key_creer(uuid, text, text[])',
    'public.api_key_revoquer(uuid)',
    'public.banque_delettrer(uuid, uuid, text)',
    'public.banque_lettrer(uuid, uuid, smallint, numeric, smallint, boolean, uuid)',
    'public.cabinet_inviter(uuid, text, text)',
    'public.cabinet_mise_en_route_terminer(uuid)',
    'public.cabinet_obligation_definir(uuid, text, integer, text, boolean, integer)',
    'public.cabinet_obligation_propre_creer(uuid, text, text, integer, integer, text, text)',
    'public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text, numeric)',
    'public.capture_articles_persist(uuid, uuid, date, text, jsonb)',
    'public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text, uuid)',
    'public.capture_precision_persist(uuid, text, text)',
    'public.capture_read_persist(uuid, jsonb, text, jsonb, jsonb, jsonb, text, jsonb)',
    'public.capture_sceller_empreinte(uuid, text)',
    'public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text)',
    'public.collab_assign(uuid, uuid, uuid, text)',
    'public.etablissement_archiver(uuid, text)',
    'public.export_journaliser(uuid, uuid, text, date, date, integer, bigint, text, uuid)',
    'public.forfait_changer(text, uuid, date)',
    'public.immo_depreciation_constater(uuid, date, numeric, numeric, numeric, numeric, uuid, text, text)',
    'public.immo_dotation_constater(uuid, smallint, smallint, numeric, numeric, numeric, uuid, date, text)',
    'public.journal_client_consigner(uuid, text, text, text, text, text)',
    'public.journal_export_journaliser(uuid, uuid, date, text, integer, integer, bigint, text, uuid, uuid[], uuid[], jsonb, text, text, text)',
    'public.justificatif_deplacer(uuid, uuid)',
    'public.justificatif_remplacer(uuid, uuid)',
    'public.notification_marquer_lue(uuid)',
    'public.organisation_definir(uuid, text, text, text)',
    'public.paiement_annuler(uuid, uuid)',
    'public.paiement_corriger(uuid, uuid, text, bigint, date, text)',
    'public.paiement_rattacher_justificatif(uuid, uuid)',
    'public.piece_detacher(uuid, uuid, text)',
    'public.piece_qui_accompagne_supprimer(uuid)',
    'public.piece_rattacher(uuid, uuid)',
    'public.piece_renvoyer(uuid)',
    'public.pv_accuser_reception(uuid)',
    'public.pv_envoyer(uuid)',
    'public.recu_attester_paiements(uuid, uuid[])',
    'public.set_engagement_status(uuid, text)',
    'public.socle_ecriture_book(uuid)',
    'public.socle_ecriture_contre_passer(uuid, uuid)',
    'public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text, uuid)',
    'public.socle_ecriture_review(uuid, app.review_outcome_t, uuid, text)',
    'public.stocks_depreciation_constater(uuid, date, numeric, numeric, numeric, numeric, uuid, text, text)',
    'public.stocks_inventaire_constater(uuid, text, numeric, numeric, numeric, uuid, date, text)'
  ]::regprocedure[] loop
    v_client := has_function_privilege('authenticated', f, 'execute');
    execute format('alter function %s security definer', f);
    execute format('alter function %s owner to portier', f);
    execute format('revoke all on function %s from public, anon', f);
    if v_client then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end
$$;

-- Une exception, et elle n'ouvre rien : `app.piece_oublie_ses_propositions`
-- n'est appelée que par des portes — trois de la base (`capture_piece_set_vis`,
-- `capture_piece_supprimer`, `piece_remplacer`), qui l'exécutent en leur nom,
-- et `piece_renvoyer`, sous le portier. Devenue elle-même porte du portier,
-- elle aurait effacé sous la RLS de l'appelant même dans les trois premières :
-- un siège qui ne lit pas une proposition l'aurait laissée derrière une pièce
-- retirée, sans un mot. Elle reste `security invoker` — chacune de ses portes
-- la joue avec ses propres droits, comme avant —, et le client perd le droit
-- de l'appeler : aucun chemin de l'application ne le fait.
revoke all on function app.piece_oublie_ses_propositions(uuid) from public, anon, authenticated;
grant execute on function app.piece_oublie_ses_propositions(uuid) to portier;

-- --- 3. L'origine d'une pièce : le portier n'y touche pas plus que le client -----------------------
--
-- Repris de `20261104130000` : « hors d'une porte » se disait `current_user`
-- client. Les portes du portier n'ont aucune raison de réécrire l'auteur ou
-- la source d'une pièce (`piece_remplacer` et `app.poser_la_source` le font,
-- au nom de la base) : le déclencheur les tient comme le client.

create or replace function app.une_piece_garde_son_origine()
returns trigger
language plpgsql
-- Exprès : `current_user` est le client hors d'une porte, le portier dans
-- les portes reprises des chemins du client, la base dans les autres.
security invoker
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or ((new.created_by is distinct from old.created_by
          or new.source_piece_id is distinct from old.source_piece_id)
         and current_user in ('authenticated', 'anon', 'portier')) then
    raise exception 'refus.piece.origine_immuable' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function app.une_piece_garde_son_origine() from public, anon, authenticated;

-- --- 4. Les faits que l'API consigne : une porte, un référentiel -----------------------------------
--
-- Trois faits s'écrivaient par une requête de l'API, après une porte : la
-- marque « forcée » d'une écriture (le journal du jour la lit), la clôture
-- d'un retour par la prise en charge, la qualification d'un règlement. Ils
-- passent par `public.fait_consigner`, qui ne connaît que les natures de ce
-- référentiel, tire le dossier de l'objet (jamais de l'appelant) et signe de
-- l'appelant. Chaque nature dit sa garde :
--   superviseur — `app.peut_superviser` du dossier (le cabinet qui le tient,
--                 ou la société qui tient ses livres) ;
--   redacteur   — qui peut proposer une écriture dans ce dossier : un membre,
--                 ou le cabinet qui le supervise (`app.supervise_le_dossier`).

create table if not exists ref.faits_consignables (
  action        text primary key,
  object_schema text not null,
  object_table  text not null,
  garde         text not null check (garde in ('superviseur', 'redacteur')),
  sort_order    smallint not null,
  check ((object_schema, object_table) in (('socle', 'ecritures'), ('capture', 'pieces')))
);

alter table ref.faits_consignables enable row level security;
alter table ref.faits_consignables force row level security;
revoke all on ref.faits_consignables from public, anon, authenticated;
grant select on ref.faits_consignables to authenticated;
drop policy if exists ref_faits_consignables_sel on ref.faits_consignables;
create policy ref_faits_consignables_sel on ref.faits_consignables
  for select to authenticated using (true);

insert into ref.faits_consignables (action, object_schema, object_table, garde, sort_order) values
  ('ecriture.forcee',    'socle',   'ecritures', 'superviseur', 10),
  ('piece.retour_clos',  'capture', 'pieces',    'superviseur', 20),
  ('reglement.qualifie', 'socle',   'ecritures', 'redacteur',   30)
on conflict (action) do nothing;

create or replace function public.fait_consigner(p_action text, p_objet uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref     ref.faits_consignables%rowtype;
  v_tenant  uuid;
  v_pack    uuid;
  v_id      uuid;
begin
  select * into v_ref from ref.faits_consignables where action = p_action;
  if not found then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  -- L'objet se lit sous la RLS de l'appelant : ce qu'il ne voit pas
  -- n'existe pas pour lui.
  if (v_ref.object_schema, v_ref.object_table) = ('socle', 'ecritures') then
    select e.tenant_id, e.pack_version_id into v_tenant, v_pack
      from public.ecritures_v e where e.id = p_objet;
  else
    select p.tenant_id into v_tenant from public.pieces_v p where p.id = p_objet;
  end if;
  if v_tenant is null then
    raise exception 'objet introuvable ou non autorise' using errcode = '42501';
  end if;

  if (v_ref.garde = 'superviseur' and not app.peut_superviser(v_tenant))
     or (v_ref.garde = 'redacteur'
         and v_tenant not in (select app.member_orgs())
         and not app.supervise_le_dossier(v_tenant)) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), p_action, v_ref.object_schema, v_ref.object_table,
          p_objet, v_pack, p_payload)
  returning id into v_id;
  return v_id;
end
$$;

-- --- 5. Les tiers -----------------------------------------------------------------------------------

create or replace function public.tiers_ouvrir(
  p_tenant uuid, p_nature text, p_code text, p_raison_sociale text, p_compte_collectif text,
  p_identifiant_fiscal text, p_note text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_raison_sociale), '') is null
     or nullif(btrim(p_compte_collectif), '') is null or nullif(btrim(p_nature), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  insert into tiers.auxiliaires (tenant_id, nature, code, raison_sociale, compte_collectif,
                                 identifiant_fiscal, note)
  values (p_tenant, p_nature, upper(btrim(p_code)), btrim(p_raison_sociale),
          btrim(p_compte_collectif), nullif(btrim(p_identifiant_fiscal), ''),
          nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.tiers_modifier(
  p_id uuid, p_raison_sociale text, p_compte_collectif text, p_identifiant_fiscal text, p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_raison_sociale), '') is null or nullif(btrim(p_compte_collectif), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update tiers.auxiliaires
     set raison_sociale = btrim(p_raison_sociale), compte_collectif = btrim(p_compte_collectif),
         identifiant_fiscal = nullif(btrim(p_identifiant_fiscal), ''),
         note = nullif(btrim(p_note), '')
   where id = p_id;
  if not found then
    raise exception 'tiers introuvable ou non autorise' using errcode = '42501';
  end if;
end
$$;

create or replace function public.tiers_activer(p_id uuid, p_actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actif is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update tiers.auxiliaires set actif = p_actif where id = p_id;
  if not found then
    raise exception 'tiers introuvable ou non autorise' using errcode = '42501';
  end if;
end
$$;

-- --- 6. Les stocks ----------------------------------------------------------------------------------

-- Un établissement de cette société ? Les portes qui en reçoivent un le
-- vérifient : une clé étrangère seule laisse pointer vers celui d'une autre
-- (revue de #149).
create or replace function app.entite_de(p_tenant uuid, p_entity uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from identity.entities e
                  where e.id = p_entity and e.tenant_id = p_tenant)
$$;

revoke all on function app.entite_de(uuid, uuid) from public, anon;
grant execute on function app.entite_de(uuid, uuid) to authenticated;

create or replace function public.stocks_article_creer(
  p_tenant uuid, p_entity uuid, p_category uuid, p_reference text, p_designation text,
  p_unite text, p_methode app.stock_methode_t, p_account_stock text, p_account_variation text,
  p_devise text, p_pack uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_reference), '') is null or nullif(btrim(p_designation), '') is null
     or nullif(btrim(p_unite), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- L'établissement est celui de la société, jamais d'une autre (revue de #149).
  if p_entity is not null and not app.entite_de(p_tenant, p_entity) then
    raise exception 'refus.saisie.etablissement' using errcode = '42501';
  end if;
  insert into stocks.items (tenant_id, entity_id, category_id, reference, designation, unite,
                            methode, account_stock, account_variation, devise, pack_version_id,
                            created_by)
  values (p_tenant, p_entity, p_category, p_reference, p_designation, p_unite, p_methode,
          p_account_stock, p_account_variation, p_devise, p_pack, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.stocks_article_modifier(
  p_id uuid, p_designation text, p_unite text, p_methode app.stock_methode_t, p_active boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_designation), '') is null or nullif(btrim(p_unite), '') is null
     or p_active is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update stocks.items
     set designation = p_designation, unite = p_unite, methode = p_methode, active = p_active
   where id = p_id;
  if not found then
    raise exception 'article introuvable ou non autorise' using errcode = '42501';
  end if;
end
$$;

create or replace function public.stocks_mouvement_inscrire(
  p_tenant uuid, p_item uuid, p_sens app.stock_sens_t, p_at date, p_quantite numeric,
  p_cout_unitaire numeric, p_reference text, p_piece uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- L'article est celui du dossier, et l'appelant le voit.
  if not exists (select 1 from public.stocks_items_v i where i.id = p_item and i.tenant_id = p_tenant) then
    raise exception 'article introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into stocks.mouvements (tenant_id, item_id, sens, at, quantite, cout_unitaire,
                                 reference, piece_id, created_by)
  values (p_tenant, p_item, p_sens, p_at, p_quantite, p_cout_unitaire,
          nullif(btrim(p_reference), ''), p_piece, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- --- 7. Les immobilisations -------------------------------------------------------------------------

create or replace function public.immo_bien_creer(
  p_tenant uuid, p_entity uuid, p_vis app.vis_t, p_piece uuid, p_category uuid, p_label text,
  p_mise_en_service date, p_valeur_brute numeric, p_valeur_residuelle numeric,
  p_method app.amort_method_t, p_duree_annees smallint, p_coefficient numeric, p_devise text,
  p_pack uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_label), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- L'établissement est celui de la société, jamais d'une autre (revue de #149).
  if p_entity is not null and not app.entite_de(p_tenant, p_entity) then
    raise exception 'refus.saisie.etablissement' using errcode = '42501';
  end if;
  insert into immo.assets (tenant_id, entity_id, vis, piece_id, category_id, label,
                           mise_en_service, valeur_brute, valeur_residuelle, method,
                           duree_annees, coefficient, devise, pack_version_id, created_by)
  values (p_tenant, p_entity, p_vis, p_piece, p_category, p_label, p_mise_en_service,
          p_valeur_brute, p_valeur_residuelle, p_method, p_duree_annees, p_coefficient,
          p_devise, p_pack, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.immo_bien_modifier(
  p_id uuid, p_label text, p_mise_en_service date, p_valeur_brute numeric,
  p_valeur_residuelle numeric, p_method app.amort_method_t, p_duree_annees smallint,
  p_coefficient numeric, p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_label), '') is null or nullif(btrim(p_status), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update immo.assets
     set label = p_label, mise_en_service = p_mise_en_service, valeur_brute = p_valeur_brute,
         valeur_residuelle = p_valeur_residuelle, method = p_method,
         duree_annees = p_duree_annees, coefficient = p_coefficient, status = p_status
   where id = p_id;
  if not found then
    raise exception 'immobilisation introuvable ou non autorisee' using errcode = '42501';
  end if;
end
$$;

create or replace function public.immo_cession_inscrire(
  p_tenant uuid, p_asset uuid, p_at date, p_prix numeric, p_vnc numeric, p_resultat numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.immo_assets_v a where a.id = p_asset and a.tenant_id = p_tenant) then
    raise exception 'immobilisation introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into immo.cessions (tenant_id, asset_id, at, prix, vnc, resultat, created_by)
  values (p_tenant, p_asset, p_at, p_prix, p_vnc, p_resultat, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- --- 8. La banque -----------------------------------------------------------------------------------

create or replace function public.banque_compte_ouvrir(
  p_tenant uuid, p_entity uuid, p_label text, p_iban text, p_devise text, p_account_code text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_label), '') is null or nullif(btrim(p_account_code), '') is null
     or nullif(btrim(p_devise), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- L'établissement est celui de la société, jamais d'une autre (revue de #149).
  if p_entity is not null and not app.entite_de(p_tenant, p_entity) then
    raise exception 'refus.saisie.etablissement' using errcode = '42501';
  end if;
  insert into banque.comptes (tenant_id, entity_id, label, iban, devise, account_code, created_by)
  values (p_tenant, p_entity, p_label, nullif(btrim(p_iban), ''), p_devise, p_account_code,
          auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- Un relevé importé : la clé d'idempotence écarte les lignes déjà là,
-- réimporter le même relevé n'en duplique aucune. Rend le nombre ajouté.
create or replace function public.banque_lignes_importer(
  p_tenant uuid, p_compte uuid, p_lot uuid, p_dates date[], p_libelles text[],
  p_montants numeric[], p_references text[], p_cles text[]
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.banque_comptes_v c where c.id = p_compte and c.tenant_id = p_tenant) then
    raise exception 'compte bancaire introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_lot is null
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_libelles), 0)
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_montants), 0)
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_references), 0)
     or coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_cles), 0) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into banque.releve_lignes (tenant_id, compte_id, at, label, montant, reference,
                                    import_batch, idempotency_key, created_by)
  select p_tenant, p_compte, u.at, u.label, u.montant, u.reference, p_lot, u.cle, auth.uid()
    from unnest(p_dates, p_libelles, p_montants, p_references, p_cles)
         as u(at, label, montant, reference, cle)
  on conflict (tenant_id, idempotency_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Le statut d'une ligne se pose à la main entre « ouverte » et « ignorée » ;
-- « rapprochée », c'est le lettrage qui le dit (`banque_lettrer`), jamais un
-- clic.
create or replace function public.banque_ligne_classer(p_ligne uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('ouverte', 'ignoree') then
    raise exception 'refus.banque.statut_par_le_lettrage' using errcode = '22023';
  end if;
  update banque.releve_lignes set status = p_status where id = p_ligne;
  if not found then
    raise exception 'ligne de releve introuvable ou non autorisee' using errcode = '42501';
  end if;
end
$$;

-- --- 9. L'identité du dossier -----------------------------------------------------------------------

-- La fiche fiscale : la précédente se clôt à la date d'effet de la nouvelle
-- (`fiches_seule_cloture` refuse tout autre geste), puis la nouvelle
-- s'inscrit. La base arbitre le chevauchement.
create or replace function public.fiche_fiscale_etablir(
  p_tenant uuid, p_regime_imposition text, p_regime_tva text, p_prorata_tva numeric,
  p_secteur text, p_debut_activite date, p_cloture_exercice text, p_forme_juridique text,
  p_mode_depot text, p_source text, p_piece uuid, p_valid_from date
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_valid_from is null or nullif(btrim(p_source), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- La pièce qui la prouve est une pièce de la société (revue de #149).
  if p_piece is not null
     and not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  update identity.fiches_fiscales
     set valid_to = p_valid_from
   where tenant_id = p_tenant and valid_to is null and valid_from < p_valid_from;
  insert into identity.fiches_fiscales (tenant_id, regime_imposition, regime_tva, prorata_tva,
                                        secteur, debut_activite, cloture_exercice,
                                        forme_juridique, mode_depot, source, piece_id, valid_from)
  values (p_tenant, p_regime_imposition, p_regime_tva, p_prorata_tva, p_secteur,
          p_debut_activite, p_cloture_exercice, p_forme_juridique, p_mode_depot, p_source,
          p_piece, p_valid_from)
  returning id into v_id;
  return v_id;
end
$$;

-- Le mandat posé d'un geste (les politiques d'`identity.engagements` disent
-- qui : le dirigeant de la PME, ou l'expert du cabinet sans l'activer).
create or replace function public.mandat_creer(p_pme uuid, p_cabinet uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_pme is null or p_cabinet is null or nullif(btrim(p_status), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
  values (p_pme, p_cabinet, p_status, auth.uid())
  on conflict (pme_org_id, cabinet_org_id) do update set status = excluded.status
  returning id into v_id;
  return v_id;
end
$$;

-- L'établissement principal d'une organisation qui vient de naître.
create or replace function public.etablissement_principal_ouvrir(p_org uuid, p_nom text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_nom), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if exists (select 1 from public.entities_v e where e.tenant_id = p_org and e.is_default) then
    raise exception 'refus.etablissement.principal_deja_ouvert' using errcode = 'check_violation';
  end if;
  insert into identity.entities (tenant_id, code, name, is_default)
  values (p_org, 'PRINCIPAL', btrim(p_nom), true)
  returning id into v_id;
  return v_id;
end
$$;

-- Son prénom et son nom, à soi seul. Un champ vide s'efface.
create or replace function public.mon_profil_ecrire(p_prenom text, p_nom text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profil jsonb;
begin
  if auth.uid() is null then
    raise exception 'identite requise' using errcode = '42501';
  end if;
  insert into identity.profiles (user_id, prenom, nom)
  values (auth.uid(), nullif(btrim(p_prenom), ''), nullif(btrim(p_nom), ''))
  on conflict (user_id) do update set prenom = excluded.prenom, nom = excluded.nom
  returning jsonb_build_object('prenom', prenom, 'nom', nom, 'display_name', display_name)
    into v_profil;
  return v_profil;
end
$$;

-- --- 10. Les PV de réunion --------------------------------------------------------------------------

-- Un PV du cabinet, pour un client qu'il suit (mandat actif) — jamais pour
-- une organisation qu'il ne voit pas : le PV y serait lu.
create or replace function public.pv_creer(
  p_cabinet uuid, p_client uuid, p_at date, p_titre text, p_participants text,
  p_ordre_du_jour text, p_decisions text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_titre), '') is null or p_at is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  if p_client is not null
     and (p_client not in (select app.engaged_orgs())
          or not exists (select 1 from identity.engagements g
                          where g.pme_org_id = p_client and g.cabinet_org_id = p_cabinet
                            and g.status = 'actif')) then
    raise exception 'client introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into collab.pv_reunions (cabinet_tenant_id, client_tenant_id, at, titre, participants,
                                  ordre_du_jour, decisions, created_by)
  values (p_cabinet, p_client, p_at, p_titre, p_participants, p_ordre_du_jour, p_decisions,
          auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- Reprendre un brouillon : ce qu'on ne passe pas reste tel quel. Un PV envoyé
-- est refusé par son déclencheur (R7).
create or replace function public.pv_modifier(
  p_id uuid, p_titre text, p_avec_participants boolean, p_participants text,
  p_avec_decisions boolean, p_decisions text, p_sections jsonb, p_chiffres jsonb,
  p_avec_ton boolean, p_ton text, p_redige_par_malica boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (p_sections is not null and jsonb_typeof(p_sections) <> 'array')
     or (p_chiffres is not null and jsonb_typeof(p_chiffres) <> 'array')
     or (p_titre is not null and btrim(p_titre) = '') then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update collab.pv_reunions
     set titre             = coalesce(p_titre, titre),
         participants      = case when p_avec_participants then p_participants else participants end,
         decisions         = case when p_avec_decisions then p_decisions else decisions end,
         sections          = coalesce(p_sections, sections),
         chiffres          = coalesce(p_chiffres, chiffres),
         ton               = case when p_avec_ton then p_ton else ton end,
         redige_par_malica = coalesce(p_redige_par_malica, redige_par_malica)
   where id = p_id;
  if not found then
    raise exception 'pv introuvable ou non autorise' using errcode = '42501';
  end if;
end
$$;

-- --- 11. Les conversations avec Malica --------------------------------------------------------------

create or replace function public.conversation_ouvrir(p_tenant uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into agents.conversations (tenant_id, created_by) values (p_tenant, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- La question du client, seule : la sienne, dans son fil.
create or replace function public.conversation_poser(p_conversation uuid, p_question text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_question), '') is null then
    raise exception 'une question ne peut pas être vide' using errcode = '22023';
  end if;
  if not exists (select 1 from agents.conversations c
                  where c.id = p_conversation and c.created_by = auth.uid()) then
    raise exception 'conversation.introuvable_ou_non_autorisee' using errcode = '42501';
  end if;
  insert into agents.conversation_messages (conversation_id, role, contenu)
  values (p_conversation, 'user', btrim(p_question));
end
$$;

-- La question et la réponse de Malica, ensemble. La réponse n'est écrite que
-- par le serveur : `app.exiger_origine_serveur_sauf_question` le tient.
create or replace function public.conversation_repondre(
  p_conversation uuid, p_question text, p_reponse text, p_raisonnement text, p_model text,
  p_tokens_in integer, p_tokens_out integer, p_latency_ms integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from agents.conversations c
                  where c.id = p_conversation and c.created_by = auth.uid()) then
    raise exception 'conversation.introuvable_ou_non_autorisee' using errcode = '42501';
  end if;
  insert into agents.conversation_messages (conversation_id, role, contenu)
  values (p_conversation, 'user', p_question);
  insert into agents.conversation_messages (conversation_id, role, contenu, raisonnement, model,
                                            tokens_in, tokens_out, latency_ms)
  values (p_conversation, 'assistant', p_reponse, p_raisonnement, p_model, p_tokens_in,
          p_tokens_out, p_latency_ms);
end
$$;

-- Ce que les contrôles ont trouvé sur une réponse : le dossier est celui du
-- fil du message, jamais celui que l'appelant dit.
create or replace function public.conversation_controles_journaliser(
  p_tenant uuid, p_message uuid, p_controles text[], p_suites text[], p_details text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_controles), 0) <> coalesce(cardinality(p_suites), 0)
     or coalesce(cardinality(p_controles), 0) <> coalesce(cardinality(p_details), 0) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  if p_message is not null
     and not exists (select 1 from agents.conversation_messages m
                       join agents.conversations c on c.id = m.conversation_id
                      where m.id = p_message and c.tenant_id = p_tenant) then
    raise exception 'message introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into agents.reponse_controles (tenant_id, message_id, controle, suite, detail)
  select p_tenant, p_message, c.controle, c.suite, left(c.detail, 500)
    from unnest(p_controles, p_suites, p_details) as c(controle, suite, detail);
end
$$;

-- Le geste du comptable : juste, ou faux, une fois par personne et par message.
create or replace function public.conversation_juger(
  p_tenant uuid, p_message uuid, p_verdict text, p_attendu text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from agents.conversation_messages m
                   join agents.conversations c on c.id = m.conversation_id
                  where m.id = p_message and c.tenant_id = p_tenant and m.role = 'assistant') then
    raise exception 'message introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into agents.reponse_verdicts (tenant_id, message_id, verdict, attendu, created_by)
  values (p_tenant, p_message, p_verdict, nullif(btrim(p_attendu), ''), auth.uid())
  on conflict (message_id, created_by) do nothing;
end
$$;

create or replace function public.conversation_renommer(p_conversation uuid, p_titre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_titre), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  update agents.conversations set titre = left(btrim(p_titre), 120)
   where id = p_conversation and created_by = auth.uid();
  if not found then
    raise exception 'conversation.introuvable_ou_non_autorisee' using errcode = '42501';
  end if;
end
$$;

-- Effacer un fil, et ses messages avec lui. Le journal des appels
-- (`agents.agent_runs`) reste : il ne porte aucun texte.
create or replace function public.conversation_supprimer(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from agents.conversations where id = p_conversation and created_by = auth.uid();
  if not found then
    raise exception 'conversation.introuvable_ou_non_autorisee' using errcode = '42501';
  end if;
end
$$;

-- --- 12. Le paramétrage du plan ---------------------------------------------------------------------

-- La classe est laissée vide : le déclencheur la déduit du parent.
create or replace function public.compte_cabinet_ouvrir(
  p_tenant uuid, p_code text, p_libelle text, p_parent text, p_sens_usuel text, p_motif text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_libelle), '') is null
     or nullif(btrim(p_parent), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  insert into parametrage.accounts (tenant_id, account_code, label, parent_code, account_class,
                                    normal_side, motif)
  values (p_tenant, btrim(p_code), btrim(p_libelle), btrim(p_parent), '', p_sens_usuel, p_motif)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.compte_cabinet_fermer(p_tenant uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from parametrage.accounts where tenant_id = p_tenant and account_code = p_code;
  if not found then
    raise exception 'compte introuvable ou non autorise' using errcode = '42501';
  end if;
end
$$;

-- Qui arrête un paramétrage (R10) : UNE règle pour la déclaration de TVA, la
-- règle de change et les comptes des rôles (revue de #149 : la porte des
-- comptes ne vérifiait rien, et un assistant d'une société pouvait relier un
-- compte pour le cabinet d'un autre). Pour tout le cabinet : son
-- expert-comptable, et la portée est le cabinet lui-même. Pour un dossier :
-- quiconque, au cabinet qui le tient aujourd'hui, le supervise.
create or replace function app.peut_arreter_le_parametrage(
  p_cabinet uuid, p_portee text, p_portee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case p_portee
    when 'cabinet' then p_portee_id = p_cabinet and app.has_org_role(p_cabinet, array['expert'])
    when 'dossier' then
      p_cabinet in (select app.member_orgs())
      and app.supervise_le_dossier(p_portee_id)
      and exists (select 1 from identity.engagements g
                   where g.cabinet_org_id = p_cabinet and g.pme_org_id = p_portee_id
                     and g.status = 'actif')
    else false
  end, false)
$$;

revoke all on function app.peut_arreter_le_parametrage(uuid, text, uuid) from public, anon;
grant execute on function app.peut_arreter_le_parametrage(uuid, text, uuid) to authenticated;

-- La déclaration de TVA et la règle de change s'y rangent : leurs corps sont
-- repris tels quels, la vérification des droits en moins (elle est ici).
create or replace function app.tva_affecter(
  p_cabinet      uuid,
  p_portee       text,
  p_portee_id    uuid,
  p_pack         uuid,
  p_valid_from   date,
  p_affectations jsonb,
  p_motif        text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_portee is null or p_portee not in ('cabinet', 'dossier') then
    raise exception 'refus.tva.affectation.saisie' using errcode = '22023';
  end if;
  if not app.peut_arreter_le_parametrage(p_cabinet, p_portee, p_portee_id) then
    raise exception 'refus.tva.affectation.droits' using errcode = '42501';
  end if;

  if p_affectations is null or jsonb_typeof(p_affectations) <> 'array'
     or jsonb_array_length(p_affectations) = 0
     or exists (
       select 1 from jsonb_array_elements(p_affectations) e
        where e ->> 'sens' is null or e ->> 'nature' is null
           or not exists (select 1 from ref.tva_natures n where n.code = e ->> 'nature')
           or (e ->> 'ligne' is not null and not exists (
                 select 1 from ref.tva_declaration_lignes l
                  where l.pack_version_id = p_pack and l.code = e ->> 'ligne'
                    and l.sens = e ->> 'sens'
                    and l.valid_from <= p_valid_from
                    and (l.valid_to is null or l.valid_to >= p_valid_from)))) then
    raise exception 'refus.tva.affectation.saisie' using errcode = '22023';
  end if;

  insert into parametrage.tva_affectations
    (tenant_id, portee, portee_id, pack_version_id, sens, nature, ligne_code, valid_from, motif)
  select p_cabinet, p_portee, p_portee_id, p_pack, e ->> 'sens', e ->> 'nature', e ->> 'ligne',
         p_valid_from, nullif(btrim(coalesce(p_motif, '')), '')
    from jsonb_array_elements(p_affectations) e;
  get diagnostics v_n = row_count;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'tva.affectation', 'parametrage', 'tva_affectations',
          p_portee_id, p_pack,
          jsonb_build_object('portee', p_portee, 'valid_from', p_valid_from,
                             'affectations', p_affectations));
  return v_n;
end
$$;

create or replace function app.regle_de_change_arreter(
  p_cabinet uuid, p_portee text, p_portee_id uuid, p_pack uuid, p_valid_from date,
  p_valeurs jsonb, p_motif text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_portee is null or p_portee not in ('cabinet', 'dossier') then
    raise exception 'refus.change.regle.saisie' using errcode = '22023';
  end if;
  if not app.peut_arreter_le_parametrage(p_cabinet, p_portee, p_portee_id) then
    raise exception 'refus.change.regle.droits' using errcode = '42501';
  end if;
  if p_valeurs is null or jsonb_typeof(p_valeurs) <> 'array'
     or jsonb_array_length(p_valeurs) = 0
     or p_valid_from is null
     -- Le pack de la juridiction de la portée, jamais celui d'une autre.
     or not exists (select 1 from ref.jurisdiction_packs j
                      join identity.organizations o on o.id = p_portee_id
                     where j.id = p_pack and j.jurisdiction = o.jurisdiction)
     or exists (
       select 1 from jsonb_array_elements(p_valeurs) e
        where e ->> 'code' is null
           or (e ->> 'valeur' is not null
               and not app.valeur_de_change_valide(e ->> 'code', e ->> 'valeur'))) then
    raise exception 'refus.change.regle.saisie' using errcode = '22023';
  end if;

  insert into parametrage.regles_de_change
    (tenant_id, portee, portee_id, pack_version_id, code, valeur, valid_from, motif)
  select p_cabinet, p_portee, p_portee_id, p_pack, e ->> 'code', e ->> 'valeur', p_valid_from,
         nullif(btrim(coalesce(p_motif, '')), '')
    from jsonb_array_elements(p_valeurs) e;
  get diagnostics v_n = row_count;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'change.regle_arretee', 'parametrage', 'regles_de_change',
          p_portee_id, p_pack,
          jsonb_build_object('portee', p_portee, 'valid_from', p_valid_from,
                             'valeurs', p_valeurs, 'motif', p_motif));
  return v_n;
end
$$;

-- Une liaison posée par la porte d'avant pour une portée qui n'était pas la
-- sienne ne décide rien : un cabinet ne relie que pour lui-même, un dossier
-- ne l'est que par un cabinet qui l'a tenu. Ce sont des réglages (R10), pas
-- des faits : ils partent, et leur nombre se dit.
do $$
declare v_n integer;
begin
  delete from parametrage.role_bindings b
   where (b.portee = 'cabinet' and b.portee_id <> b.tenant_id)
      or (b.portee = 'dossier'
          and not exists (select 1 from identity.engagements g
                           where g.cabinet_org_id = b.tenant_id and g.pme_org_id = b.portee_id));
  get diagnostics v_n = row_count;
  raise notice 'liaisons de comptes hors de leur portée retirées : %', v_n;
end $$;

-- Une décision remplace la précédente : c'est un paramétrage (R10), pas un
-- journal ; l'écriture qu'elle produira reste immuable.
create or replace function public.role_compte_definir(
  p_tenant uuid, p_portee text, p_portee_id uuid, p_role text, p_compte text, p_motif text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.peut_arreter_le_parametrage(p_tenant, p_portee, p_portee_id) then
    raise exception 'refus.role_compte.droits' using errcode = '42501';
  end if;
  if nullif(btrim(p_role), '') is null or nullif(btrim(p_compte), '') is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  insert into parametrage.role_bindings (tenant_id, portee, portee_id, role_code, account_code, motif)
  values (p_tenant, p_portee, p_portee_id, p_role, p_compte, p_motif)
  on conflict (portee, portee_id, role_code) do update
    set account_code = excluded.account_code,
        motif        = excluded.motif,
        decide_par   = auth.uid(),
        decide_le    = now()
  -- Une liaison d'un autre dossier ne se reprend pas sous ce nom.
  where parametrage.role_bindings.tenant_id = p_tenant;
  if not found then
    raise exception 'liaison introuvable ou non autorisee' using errcode = '42501';
  end if;
end
$$;

-- Rendre au défaut du pack : la surcharge disparaît, le livré reprend. Rendre
-- ce qui est déjà au défaut ne fait rien, et c'est juste.
create or replace function public.role_compte_rendre_au_pack(
  p_tenant uuid, p_portee text, p_portee_id uuid, p_role text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.peut_arreter_le_parametrage(p_tenant, p_portee, p_portee_id) then
    raise exception 'refus.role_compte.droits' using errcode = '42501';
  end if;
  delete from parametrage.role_bindings
   where tenant_id = p_tenant and portee = p_portee and portee_id = p_portee_id
     and role_code = p_role;
end
$$;

-- --- 13. Ce que le client signale, ses préférences --------------------------------------------------

-- L'identifiant et l'instant sont décidés ici et rendus : la politique de
-- lecture des signalements ne laisse lire que l'opérateur, pas l'auteur.
create or replace function public.signalement_deposer(
  p_tenant uuid, p_version_client text, p_appareil text, p_ou text, p_message text, p_pile text,
  p_piece uuid, p_origine text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_le timestamptz := now();
begin
  if p_tenant is not null and p_tenant not in (select app.member_orgs())
     and p_tenant not in (select app.engaged_orgs()) then
    raise exception 'organisation introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into app.signalements (id, cree_le, user_id, tenant_id, version_client, appareil, ou,
                                message, pile, piece_id, origine)
  values (v_id, v_le, app.current_uid(), p_tenant, p_version_client, p_appareil, p_ou,
          p_message, p_pile, p_piece, p_origine);
  return jsonb_build_object('id', v_id, 'cree_le', v_le);
end
$$;

-- Les préférences de la personne, posées à leur défaut livré si elles manquent.
create or replace function public.mes_preferences_ouvrir()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'identite requise' using errcode = '42501';
  end if;
  insert into notif.preferences (user_id) values (auth.uid()) on conflict (user_id) do nothing;
end
$$;

-- --- 14. Le règlement d'une pièce, son jugement -----------------------------------------------------

-- Le règlement que la personne dit : la pièce le porte (dossier, établissement,
-- visibilité viennent d'elle) ; le moyen doit exister au paramétrage du pack,
-- à la date du règlement (ou du jour, s'il n'est pas daté).
create or replace function public.paiement_inscrire(
  p_piece uuid, p_moyen text, p_pack uuid, p_montant_mineur bigint, p_devise text,
  p_paye_le date, p_justificatif uuid, p_reference text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.ref_payment_means_v m
                  where m.pack_version_id = p_pack and m.code = p_moyen
                    and m.valid_from <= coalesce(p_paye_le, current_date)
                    and (m.valid_to is null or m.valid_to >= coalesce(p_paye_le, current_date))) then
    raise exception 'Ce moyen de paiement n''existe pas au paramétrage : %', p_moyen
      using errcode = '22023';
  end if;
  insert into capture.paiements (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
                                 montant_mineur, devise, paye_le, justificatif_piece_id, reference)
  select p.tenant_id, p.entity_id, p.vis, p.id, p_moyen, p_pack, p_montant_mineur, p_devise,
         p_paye_le, p_justificatif, p_reference
    from public.pieces_v p
   where p.id = p_piece
     -- Le justificatif est une pièce de la même société (revue de #149).
     and (p_justificatif is null
          or exists (select 1 from public.pieces_v j
                      where j.id = p_justificatif and j.tenant_id = p.tenant_id))
  returning id into v_id;
  if v_id is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  return v_id;
end
$$;

-- Le jugement d'une pièce, calculé par le moteur déterministe du serveur
-- (`scan/analyse.ts`) : la porte en fixe le dossier (celui de la pièce) et
-- refuse une lecture qui n'est pas celle de la pièce. R7 : il s'ajoute.
create or replace function public.analyse_poser(
  p_piece uuid, p_extraction uuid, p_pack uuid, p_normalisation jsonb, p_controles jsonb,
  p_verdict text, p_motifs jsonb, p_doublon_numero text, p_doublon_mf text, p_doublon_lu text,
  p_regles text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id     uuid;
begin
  select p.tenant_id into v_tenant from public.pieces_v p where p.id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not exists (select 1 from capture.extractions x
                  where x.id = p_extraction and x.piece_id = p_piece) then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into capture.analyses (tenant_id, piece_id, extraction_id, pack_version_id,
                                normalisation, controles, verdict, motifs,
                                doublon_numero, doublon_mf, doublon_lu, regles)
  values (v_tenant, p_piece, p_extraction, p_pack, p_normalisation, p_controles, p_verdict,
          p_motifs, p_doublon_numero, p_doublon_mf, p_doublon_lu, p_regles)
  returning id into v_id;
  return v_id;
end
$$;

-- Un jugement inchangé, revérifié sous des règles plus récentes : un fait,
-- une fois par analyse et par règles. Rend vrai s'il s'est inscrit.
create or replace function public.analyse_verifier(p_analyse uuid, p_regles text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if nullif(btrim(p_regles), '') is null then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;
  insert into capture.analyses_verifiees (tenant_id, piece_id, analyse_id, regles)
  select a.tenant_id, a.piece_id, a.id, p_regles
    from capture.analyses a where a.id = p_analyse
  on conflict (tenant_id, analyse_id, regles) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from capture.analyses a where a.id = p_analyse) then
    raise exception 'analyse introuvable ou non autorisee' using errcode = '42501';
  end if;
  return v_n > 0;
end
$$;

-- Le verrou que l'API prend sur des pièces avant d'inscrire (une écriture, un
-- règlement) : `select … for update` exige le droit de modifier, que le
-- client n'a plus. La porte verrouille, dans l'ordre des identifiants, ce que
-- l'appelant pourrait modifier — rien d'autre, et n'écrit rien.
create or replace function public.pieces_verrouiller(p_pieces uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from capture.pieces pi where pi.id = any (p_pieces) order by pi.id for update;
end
$$;

-- --- 15. La fabrique de recettes --------------------------------------------------------------------
--
-- Les transitions, l'évaluation exigée, les seuils et le droit de promouvoir
-- restent dans `fabrique.verifier_promotion()` et les politiques : les portes
-- n'en redoublent rien. Elles fixent le dossier — celui de l'objet nommé —
-- et refusent un objet d'un autre dossier.

create or replace function fabrique.candidate_inscrire(
  p_tenant uuid, p_libelle text, p_signature_cle text, p_portee fabrique.portee_t,
  p_definition jsonb, p_empreinte text, p_provenance jsonb, p_exemples uuid[], p_motif text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recette uuid;
  v_version uuid;
  v_rang    smallint;
begin
  if exists (select 1 from unnest(coalesce(p_exemples, '{}')) e(id)
              where not exists (select 1 from fabrique.exemples x
                                 where x.id = e.id and x.tenant_id = p_tenant)) then
    raise exception 'exemple introuvable ou non autorise' using errcode = '42501';
  end if;
  select r.id into v_recette from fabrique.recettes r
   where r.tenant_id = p_tenant and r.signature_cle = p_signature_cle;
  if v_recette is null then
    insert into fabrique.recettes (tenant_id, libelle, signature_cle, portee)
    values (p_tenant, p_libelle, p_signature_cle, p_portee)
    returning id into v_recette;
  end if;
  -- Le rang se calcule ici : deux naissances simultanées se départagent par
  -- la contrainte d'unicité, l'une échoue au lieu d'écraser l'autre.
  insert into fabrique.recette_versions (tenant_id, recette_id, rang, definition, empreinte,
                                         provenance)
  select p_tenant, v_recette, coalesce(max(v.rang), 0) + 1, p_definition, p_empreinte,
         p_provenance
    from fabrique.recette_versions v
   where v.recette_id = v_recette
  returning id, rang into v_version, v_rang;
  insert into fabrique.recette_version_exemples (tenant_id, recette_version_id, exemple_id,
                                                 nourrit_une_recette, usage)
  select p_tenant, v_version, e.id, true, 'apprentissage'
    from unnest(coalesce(p_exemples, '{}')) with ordinality e(id, n)
   order by e.n;
  insert into fabrique.promotions (tenant_id, recette_version_id, etat, motif)
  values (p_tenant, v_version, 'candidate', p_motif);
  return jsonb_build_object('recette_id', v_recette, 'version_id', v_version, 'rang', v_rang);
end
$$;

create or replace function fabrique.exemple_qualifier(
  p_tenant uuid, p_piece uuid, p_signature_cle text, p_provenance fabrique.provenance_t,
  p_qualification fabrique.qualification_t, p_usage fabrique.usage_t, p_attendu jsonb,
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into fabrique.exemples (tenant_id, piece_id, signature_cle, provenance, qualification,
                                 usage, attendu, note)
  values (p_tenant, p_piece, p_signature_cle, p_provenance, p_qualification, p_usage, p_attendu,
          p_note)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function fabrique.evaluation_inscrire(
  p_tenant uuid, p_version uuid, p_mesures jsonb, p_exemples_comptes integer, p_exemples uuid[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from fabrique.recette_versions v
                  where v.id = p_version and v.tenant_id = p_tenant) then
    raise exception 'version de recette introuvable ou non autorisee' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_exemples, '{}')) e(id)
              where not exists (select 1 from fabrique.exemples x
                                 where x.id = e.id and x.tenant_id = p_tenant)) then
    raise exception 'exemple introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into fabrique.evaluations (tenant_id, recette_version_id, mesures, exemples_comptes)
  values (p_tenant, p_version, p_mesures, p_exemples_comptes)
  returning id into v_id;
  insert into fabrique.evaluation_exemples (tenant_id, evaluation_id, exemple_id, usage)
  select p_tenant, v_id, e.id, 'evaluation'
    from unnest(coalesce(p_exemples, '{}')) with ordinality e(id, n)
   order by e.n;
  return v_id;
end
$$;

create or replace function fabrique.promotion_inscrire(
  p_tenant uuid, p_version uuid, p_etat fabrique.etat_t, p_evaluation uuid, p_motif text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from fabrique.recette_versions v
                  where v.id = p_version and v.tenant_id = p_tenant) then
    raise exception 'version de recette introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into fabrique.promotions (tenant_id, recette_version_id, etat, evaluation_id, motif)
  values (p_tenant, p_version, p_etat, p_evaluation, p_motif);
end
$$;

create or replace function fabrique.derive_inscrire(
  p_tenant uuid, p_version uuid, p_nature fabrique.derive_t, p_mesure jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from fabrique.recette_versions v
                  where v.id = p_version and v.tenant_id = p_tenant) then
    raise exception 'version de recette introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into fabrique.derives (tenant_id, recette_version_id, nature, mesure)
  values (p_tenant, p_version, p_nature, p_mesure);
end
$$;

-- Ce qu'une exécution de recette a donné, sur une pièce du dossier. Réservé
-- au serveur : `app.exiger_origine_serveur` le tient.
create or replace function fabrique.execution_inscrire(
  p_tenant uuid, p_version uuid, p_piece uuid, p_issue fabrique.issue_t, p_motif text,
  p_champs_designes smallint, p_duree_ms integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  insert into fabrique.executions (tenant_id, recette_version_id, piece_id, issue, motif,
                                   champs_designes, duree_ms)
  values (p_tenant, p_version, p_piece, p_issue, p_motif, p_champs_designes, p_duree_ms);
end
$$;

-- Le travail de lecture (ou de génération) d'une pièce, durable et
-- idempotent : rend l'identifiant, et si le travail existait déjà. Une
-- priorité non dite prend le défaut du schéma (R4 : aucun nombre ici).
create or replace function fabrique.travail_inscrire(
  p_tenant uuid, p_piece uuid, p_nature fabrique.travail_nature_t, p_cle text, p_priorite smallint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.pieces_v p where p.id = p_piece and p.tenant_id = p_tenant) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if p_priorite is null then
    insert into fabrique.travaux (tenant_id, piece_id, nature, cle_idempotence)
    values (p_tenant, p_piece, p_nature, p_cle)
    on conflict (tenant_id, cle_idempotence) do nothing
    returning id into v_id;
  else
    insert into fabrique.travaux (tenant_id, piece_id, nature, cle_idempotence, priorite)
    values (p_tenant, p_piece, p_nature, p_cle, p_priorite)
    on conflict (tenant_id, cle_idempotence) do nothing
    returning id into v_id;
  end if;
  if v_id is not null then
    return jsonb_build_object('travail_id', v_id, 'deja', false);
  end if;
  select t.id into v_id from fabrique.travaux t
   where t.tenant_id = p_tenant and t.cle_idempotence = p_cle;
  if v_id is null then
    raise exception 'travail introuvable ou non autorise' using errcode = '42501';
  end if;
  return jsonb_build_object('travail_id', v_id, 'deja', true);
end
$$;

-- L'issue d'une tentative sur un travail du dossier (ajout seul).
create or replace function fabrique.issue_inscrire(
  p_tenant uuid, p_travail uuid, p_tentative smallint, p_nature fabrique.fait_t, p_motif text,
  p_detail jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from fabrique.travaux t where t.id = p_travail and t.tenant_id = p_tenant) then
    raise exception 'travail introuvable ou non autorise' using errcode = '42501';
  end if;
  insert into fabrique.travail_faits (tenant_id, travail_id, tentative, nature, motif, detail)
  values (p_tenant, p_travail, p_tentative, p_nature, p_motif, p_detail);
end
$$;

-- --- 16. Les portes appartiennent au portier --------------------------------------------------------

do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'public.fait_consigner(text, uuid, jsonb)',
    'public.tiers_ouvrir(uuid, text, text, text, text, text, text)',
    'public.tiers_modifier(uuid, text, text, text, text)',
    'public.tiers_activer(uuid, boolean)',
    'public.stocks_article_creer(uuid, uuid, uuid, text, text, text, app.stock_methode_t, text, text, text, uuid)',
    'public.stocks_article_modifier(uuid, text, text, app.stock_methode_t, boolean)',
    'public.stocks_mouvement_inscrire(uuid, uuid, app.stock_sens_t, date, numeric, numeric, text, uuid)',
    'public.immo_bien_creer(uuid, uuid, app.vis_t, uuid, uuid, text, date, numeric, numeric, app.amort_method_t, smallint, numeric, text, uuid)',
    'public.immo_bien_modifier(uuid, text, date, numeric, numeric, app.amort_method_t, smallint, numeric, text)',
    'public.immo_cession_inscrire(uuid, uuid, date, numeric, numeric, numeric)',
    'public.banque_compte_ouvrir(uuid, uuid, text, text, text, text)',
    'public.banque_lignes_importer(uuid, uuid, uuid, date[], text[], numeric[], text[], text[])',
    'public.banque_ligne_classer(uuid, text)',
    'public.fiche_fiscale_etablir(uuid, text, text, numeric, text, date, text, text, text, text, uuid, date)',
    'public.mandat_creer(uuid, uuid, text)',
    'public.etablissement_principal_ouvrir(uuid, text)',
    'public.mon_profil_ecrire(text, text)',
    'public.pv_creer(uuid, uuid, date, text, text, text, text)',
    'public.pv_modifier(uuid, text, boolean, text, boolean, text, jsonb, jsonb, boolean, text, boolean)',
    'public.conversation_ouvrir(uuid)',
    'public.conversation_poser(uuid, text)',
    'public.conversation_repondre(uuid, text, text, text, text, integer, integer, integer)',
    'public.conversation_controles_journaliser(uuid, uuid, text[], text[], text[])',
    'public.conversation_juger(uuid, uuid, text, text)',
    'public.conversation_renommer(uuid, text)',
    'public.conversation_supprimer(uuid)',
    'public.compte_cabinet_ouvrir(uuid, text, text, text, text, text)',
    'public.compte_cabinet_fermer(uuid, text)',
    'public.role_compte_definir(uuid, text, uuid, text, text, text)',
    'public.role_compte_rendre_au_pack(uuid, text, uuid, text)',
    'public.signalement_deposer(uuid, text, text, text, text, text, uuid, text)',
    'public.mes_preferences_ouvrir()',
    'public.paiement_inscrire(uuid, text, uuid, bigint, text, date, uuid, text)',
    'public.analyse_poser(uuid, uuid, uuid, jsonb, jsonb, text, jsonb, text, text, text, text)',
    'public.analyse_verifier(uuid, text)',
    'public.pieces_verrouiller(uuid[])',
    'fabrique.candidate_inscrire(uuid, text, text, fabrique.portee_t, jsonb, text, jsonb, uuid[], text)',
    'fabrique.exemple_qualifier(uuid, uuid, text, fabrique.provenance_t, fabrique.qualification_t, fabrique.usage_t, jsonb, text)',
    'fabrique.evaluation_inscrire(uuid, uuid, jsonb, integer, uuid[])',
    'fabrique.promotion_inscrire(uuid, uuid, fabrique.etat_t, uuid, text)',
    'fabrique.derive_inscrire(uuid, uuid, fabrique.derive_t, jsonb)',
    'fabrique.execution_inscrire(uuid, uuid, uuid, fabrique.issue_t, text, smallint, integer)',
    'fabrique.travail_inscrire(uuid, uuid, fabrique.travail_nature_t, text, smallint)',
    'fabrique.issue_inscrire(uuid, uuid, smallint, fabrique.fait_t, text, jsonb)'
  ]::regprocedure[] loop
    execute format('alter function %s owner to portier', f);
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

-- --- 17. Les droits : au portier ce que ses portes écrivent, aux clients rien ---------------------
--
-- Exactement les droits que les chemins de 20261104130000 exigeaient des
-- clients, sur les tables ; les vues, que l'API écrivait, n'en reçoivent
-- aucun : les portes écrivent les tables.

grant insert on agents.agent_runs to portier;
grant insert on agents.conversation_messages to portier;
grant delete, insert, update on agents.conversations to portier;
grant insert on agents.reponse_controles to portier;
grant insert on agents.reponse_verdicts to portier;
grant insert on app.signalements to portier;
grant insert on audit.event_log to portier;
grant insert on audit.journal_client to portier;
grant insert on banque.comptes to portier;
grant insert, update on banque.lettrage_etat to portier;
grant insert on banque.lettrages to portier;
grant insert, update on banque.releve_lignes to portier;
grant insert on capture.analyses to portier;
grant insert on capture.analyses_verifiees to portier;
grant insert on capture.citations to portier;
grant insert on capture.conformite to portier;
grant insert on capture.extractions to portier;
grant insert on capture.paiement_justificatifs to portier;
grant insert on capture.paiements to portier;
grant delete, insert on capture.piece_articles to portier;
grant insert (created_by, document_kind, document_kind_statut, entity_id, idempotency_key,
              page_count, sha256, source, source_piece_id, storage_path, tenant_id, vis)
  on capture.pieces to portier;
grant update (document_kind, document_kind_statut, doublon_de, sha256, status, updated_at)
  on capture.pieces to portier;
grant insert on capture.precisions to portier;
grant insert on capture.rattachements to portier;
grant insert on capture.recu_paiements to portier;
grant insert on capture.token_plan to portier;
grant insert, update on collab.assignments to portier;
grant insert on collab.charge_questions to portier;
grant insert on collab.exports to portier;
grant insert on collab.notification_lectures to portier;
grant insert on collab.notifications to portier;
grant insert, update on collab.obligations_cabinet to portier;
grant insert on collab.obligations_propres to portier;
grant insert on collab.pv_receptions to portier;
grant insert, update on collab.pv_reunions to portier;
grant insert, update on collab.reglages_cabinet to portier;
grant insert on fabrique.derives to portier;
grant insert on fabrique.evaluation_exemples to portier;
grant insert on fabrique.evaluations to portier;
grant insert on fabrique.executions to portier;
grant insert on fabrique.exemples to portier;
grant insert on fabrique.promotions to portier;
grant insert on fabrique.recette_version_exemples to portier;
grant insert on fabrique.recette_versions to portier;
grant insert on fabrique.recettes to portier;
grant insert on fabrique.travail_faits to portier;
grant insert on fabrique.travaux to portier;
grant insert, update on facturation.forfait_historique to portier;
grant insert, update on identity.api_keys to portier;
grant insert, update on identity.engagements to portier;
grant insert, update on identity.entities to portier;
grant insert, update on identity.fiches_fiscales to portier;
grant insert on identity.invitations to portier;
grant update on identity.organizations to portier;
grant insert, update on identity.profiles to portier;
grant insert, update on immo.assets to portier;
grant insert on immo.cessions to portier;
grant insert on immo.depreciations to portier;
grant insert on immo.dotations to portier;
grant insert on notif.preferences to portier;
grant delete, insert on parametrage.accounts to portier;
grant delete, insert, update on parametrage.role_bindings to portier;
grant insert on socle.ecriture_lignes to portier;
grant delete, insert, update on socle.ecritures to portier;
grant insert on stocks.depreciations to portier;
grant insert on stocks.inventaires to portier;
grant insert, update on stocks.items to portier;
grant insert on stocks.mouvements to portier;
grant insert, update on tiers.auxiliaires to portier;

-- Aux clients : aucun droit d'écriture, sur aucune table ni aucune vue. Le
-- retrait d'un droit de table retire aussi ses droits par colonne.
do $$
declare
  r record;
begin
  for r in
    select distinct c.oid::regclass as objet
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm', 'f')
       and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and (exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                     where a.grantee in (0, 'authenticated'::regrole, 'anon'::regrole)
                       and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
            or exists (select 1 from pg_attribute att, aclexplode(att.attacl) a
                        where att.attrelid = c.oid and att.attacl is not null
                          and a.grantee in (0, 'authenticated'::regrole, 'anon'::regrole)
                          and a.privilege_type in ('INSERT', 'UPDATE')))
  loop
    execute format('revoke insert, update, delete, truncate on %s from public, anon, authenticated',
                   r.objet);
  end loop;
end
$$;

commit;
