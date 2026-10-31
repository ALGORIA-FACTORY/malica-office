-- Seules les portes écrivent (lot 6, « verrous en base ») — revue indépendante
-- de #146, en SQL brut sous l'identité d'un siège.
--
-- La revue a écrit directement dans les tables, comme un client authentifié,
-- ce que les portes du circuit refusent :
--   P1 `update capture.pieces set source_piece_id = <sa pièce>, vis = 'partage'`
--      passait : l'exception « la pièce issue d'une autre suit sa source » de
--      `app.seul_qui_en_a_le_droit_transmet` ne regardait pas la source ;
--   P1 `update capture.pieces set gardee_le = now()` (Garder sans le droit),
--      `set vis = 'entite'` (une pièce reprise au comptable sans son accord) ;
--   P1 un siège insérait dans `collab.demandes_sur_piece` une demande à
--      l'étape « cabinet » : le comptable l'accordait, la pièce était défaite
--      sans que le propriétaire l'ait jamais vue ;
--   P2 `audit.event_log` acceptait un fait signé du propriétaire, et
--      `collab.notifications` un avis adressé à quelqu'un, écrit par un autre.
--
-- La cause est la même partout : des droits d'écriture larges, donnés aux
-- clients sur des tables d'état et de faits. Le principe posé ici : une table
-- d'état ou de faits ne s'écrit que par une porte (`security definer`) qui
-- contrôle les droits. Un client garde un droit d'écriture direct seulement là
-- où un chemin de l'application l'exige aujourd'hui (une fonction `security
-- invoker`, une requête de l'API), le plus étroit possible (par colonne, sous
-- une politique) ; chacun est inventorié et justifié dans
-- `apps/api/src/verrous/ecritures-des-clients.json`, que l'épreuve
-- `les-clients-n-ecrivent-que-par-les-portes.test.ts` compare à la base : un
-- droit nouveau, ou plus large, la fait échouer.
--
-- Les droits que rien n'emploie sont retirés (section 8), relevés table par
-- table : aucune fonction `security invoker`, aucune requête de l'API, aucune
-- vue écrite par l'API ne s'en sert.

begin;

-- --- 1. Une pièce : qui la modifie ----------------------------------------------------------------
--
-- La règle des politiques de mise à jour (`capture_pieces_upd`,
-- `pieces_upd_cabinet`), pour les portes qui ne passent plus par la RLS : un
-- membre, une pièce qu'il lit ; le cabinet engagé, une pièce partagée.

create or replace function app.piece_modifiable(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from capture.pieces p
     where p.id = p_piece
       and ((p.tenant_id in (select app.member_orgs()) and app.piece_lisible(p.id))
            or (p.vis = 'partage'::app.vis_t and p.tenant_id in (select app.engaged_orgs()))))
$$;

revoke all on function app.piece_modifiable(uuid) from public, anon, authenticated;

-- --- 2. Les colonnes d'une pièce que le client écrit encore -----------------------------------------
--
-- `vis`, `gardee_le`, `transmise_le`, `archivee_le`, `source_piece_id`,
-- `created_by`, `tenant_id`, `storage_path`, `content_type` : par les portes
-- seulement. Restent au client, par colonne et sous les politiques de
-- `capture.pieces`, celles qu'écrivent les fonctions `security invoker` de la
-- lecture, de l'empreinte et de l'écriture comptable (l'inventaire les nomme).
-- À l'insertion (`capture_piece_register`), jamais l'état du circuit ; l'auteur
-- est l'appelant (`auth.uid()` par défaut, et la politique refuse tout autre).

revoke insert, update on capture.pieces from authenticated;
grant insert (tenant_id, entity_id, vis, source, storage_path, sha256, page_count,
              idempotency_key, document_kind, document_kind_statut, source_piece_id, created_by)
  on capture.pieces to authenticated;
drop policy if exists capture_pieces_ins on capture.pieces;
create policy capture_pieces_ins on capture.pieces
  for insert to authenticated
  with check (tenant_id in (select app.member_orgs()) and created_by = (select auth.uid()));
grant update (status, document_kind, document_kind_statut, sha256, doublon_de, updated_at)
  on capture.pieces to authenticated;
revoke insert, update on public.pieces_v from authenticated;

-- Le chemin du fichier : l'API le réécrivait par `update pieces_v`, et un
-- membre pouvait ainsi faire pointer sa pièce vers le fichier d'une autre. Il
-- se calcule ici, de la pièce elle-même, par son auteur seul.
create or replace function public.capture_piece_poser_chemin(p_piece uuid, p_content_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chemin text;
begin
  if not app.piece_modifiable(p_piece)
     or not exists (select 1 from capture.pieces p
                     where p.id = p_piece and p.created_by is not distinct from auth.uid()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  update capture.pieces
     set storage_path = tenant_id::text || '/' || id::text,
         content_type = coalesce(p_content_type, content_type)
   where id = p_piece
  returning storage_path into v_chemin;
  return v_chemin;
end
$$;

revoke all on function public.capture_piece_poser_chemin(uuid, text) from public, anon;
grant execute on function public.capture_piece_poser_chemin(uuid, text) to authenticated;

-- --- 3. L'origine d'une pièce ne se réécrit pas ------------------------------------------------------
--
-- Son dossier jamais ; son auteur et sa source, par une porte seulement :
-- `piece_remplacer` (la nouvelle photo reste celle du siège),
-- `app.poser_la_source` (un justificatif déplacé ou remplacé). Les droits par
-- colonne le refusent déjà au client ; ce déclencheur le tient aussi contre une
-- fonction `security invoker` qui l'oublierait.

create or replace function app.une_piece_garde_son_origine()
returns trigger
language plpgsql
-- Exprès : `current_user` est le client hors d'une porte, le propriétaire
-- des portes dedans.
security invoker
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or ((new.created_by is distinct from old.created_by
          or new.source_piece_id is distinct from old.source_piece_id)
         and current_user in ('authenticated', 'anon')) then
    raise exception 'refus.piece.origine_immuable' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function app.une_piece_garde_son_origine() from public, anon, authenticated;

drop trigger if exists une_piece_garde_son_origine on capture.pieces;
create trigger une_piece_garde_son_origine
  before update of tenant_id, created_by, source_piece_id on capture.pieces
  for each row execute function app.une_piece_garde_son_origine();

-- La source d'un justificatif : la porte des deux fonctions qui la changent.
-- Appelée seule, elle n'ouvre rien de plus qu'un dépôt avec sa source : une
-- pièce qu'on modifie, une source qu'on lit, du même dossier et du même côté
-- du cabinet.
create or replace function app.poser_la_source(p_piece uuid, p_source uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_source is null or p_source = p_piece
     or not app.piece_modifiable(p_piece) or not app.piece_lisible(p_source)
     or not exists (
       select 1 from capture.pieces p, capture.pieces s
        where p.id = p_piece and s.id = p_source
          and s.tenant_id = p.tenant_id
          and (s.vis = 'partage'::app.vis_t) = (p.vis = 'partage'::app.vis_t)) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  update capture.pieces set source_piece_id = p_source where id = p_piece;
end
$$;

revoke all on function app.poser_la_source(uuid, uuid) from public, anon;
grant execute on function app.poser_la_source(uuid, uuid) to authenticated;

-- Reprises de `20261029130000`, la source posée par sa porte.
create or replace function public.justificatif_deplacer(p_piece uuid, p_paiement uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_vis       app.vis_t;
  v_kind      text;
  v_cible     public.paiements_v;
  v_vis_cible app.vis_t;
  v_quittes   uuid[];
begin
  v_tenant := app.piece_qui_accompagne_garde(p_piece, false);
  select vis, document_kind into v_vis, v_kind from capture.pieces where id = p_piece;
  if v_kind = 'recu_de_paiement' then
    raise exception 'un recu ne se rattache pas a un reglement' using errcode = '22023';
  end if;

  -- Deux déplacements simultanés vers le même règlement : le second attend
  -- et voit la preuve du premier. Pas de `for update` : la table refuse
  -- l'UPDATE (R7), et PostgreSQL le soumettrait à cette politique.
  -- La pièce aussi : deux déplacements simultanés de la même preuve vers deux
  -- règlements feraient qu'une photo en prouve deux.
  perform pg_advisory_xact_lock(hashtextextended(p_piece::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_paiement::text, 0));

  select * into v_cible from public.paiements_v where id = p_paiement;
  if v_cible.id is null or v_cible.tenant_id <> v_tenant then
    raise exception 'paiement introuvable ou non autorise' using errcode = '42501';
  end if;
  if v_cible.eteint or v_cible.annule_paiement_id is not null
     or v_cible.montant_mineur is null or v_cible.moyen_code = 'non_paye' then
    raise exception 'refus.justificatif.reglement_eteint' using errcode = 'check_violation';
  end if;
  if v_cible.justificatif_piece_id is not null then
    raise exception 'refus.justificatif.reglement_deja_prouve' using errcode = 'check_violation';
  end if;
  -- La facture du règlement, c'est sa photo courante (revue Codex de #127).
  select vis into v_vis_cible from capture.pieces
   where id = app.version_courante(v_cible.piece_id);
  if (v_vis_cible = 'partage'::app.vis_t) <> (v_vis = 'partage'::app.vis_t) then
    raise exception 'refus.justificatif.autre_cote_du_cabinet' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(r), '{}') into v_quittes from app.reglements_prouves_par(p_piece) r;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, q, null, 'detache' from unnest(v_quittes) q;

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  values (v_tenant, p_paiement, p_piece, 'rattache');

  perform app.poser_la_source(p_piece, app.version_courante(v_cible.piece_id));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_deplace', 'capture', 'pieces', p_piece,
          jsonb_build_object('vers', p_paiement, 'depuis', to_jsonb(v_quittes)));

  return jsonb_build_object('piece_id', p_piece, 'paiement_id', p_paiement);
end
$$;

create or replace function public.justificatif_remplacer(p_ancien uuid, p_nouveau uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant    uuid;
  v_source    uuid;
  v_kind      text;
  v_tenant_n  uuid;
  v_reglements uuid[];
begin
  v_tenant := app.piece_qui_accompagne_garde(p_ancien, true);
  select source_piece_id, document_kind into v_source, v_kind
    from capture.pieces where id = p_ancien;
  if v_kind = 'recu_de_paiement' then
    raise exception 'un recu se produit, il ne se photographie pas' using errcode = '22023';
  end if;

  select tenant_id into v_tenant_n from capture.pieces where id = p_nouveau;
  if v_tenant_n is null or v_tenant_n <> v_tenant or p_nouveau = p_ancien then
    raise exception 'justificatif introuvable ou non autorise dans ce dossier'
      using errcode = '42501';
  end if;
  -- La nouvelle pièce est une photo de preuve qui vient d'être prise, et rien
  -- d'autre : jamais une facture lue, une pièce d'un autre côté du cabinet,
  -- ni une preuve qui prouve déjà quelque chose.
  if not exists (
       select 1 from capture.pieces n, capture.pieces a
        where n.id = p_nouveau and a.id = p_ancien
          and n.document_kind = 'justificatif_paiement'
          and n.status = 'capturee'
          and n.vis = a.vis
          and (n.source_piece_id is null or n.source_piece_id = a.source_piece_id))
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouveau)
     or exists (select 1 from public.paiements_v v where v.justificatif_piece_id = p_nouveau)
     or exists (select 1 from capture.recu_paiements r where r.piece_id = p_nouveau) then
    raise exception 'refus.justificatif.nouvelle_photo' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(r), '{}') into v_reglements from app.reglements_prouves_par(p_ancien) r;

  -- La nouvelle photo prend la place de l'ancienne, règlement par règlement :
  -- « le rattachement au règlement est gardé ».
  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, r, p_nouveau, 'rattache' from unnest(v_reglements) r;

  -- Sa source, s'il en a une et qu'elle change : par la porte.
  if v_source is not null
     and v_source is distinct from (select source_piece_id from capture.pieces
                                     where id = p_nouveau) then
    perform app.poser_la_source(p_nouveau, v_source);
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_remplace', 'capture', 'pieces', p_nouveau,
          jsonb_build_object('remplace', p_ancien, 'reglements', to_jsonb(v_reglements)));

  -- La SEULE porte par laquelle une pièce disparaît ; ses lignes de preuve
  -- partent avec elle (cascade), et la nouvelle est déjà la dernière.
  perform public.capture_piece_supprimer(p_ancien, false);

  return jsonb_build_object('piece_id', p_nouveau, 'remplace', p_ancien);
end
$$;

-- --- 4. Une pièce issue d'une autre ne suit qu'une source déjà partie ------------------------------
--
-- Repris de `20261104090000`. L'exception « elle suit sa source » valait pour
-- toute pièce qui en nommait une : un siège nommait la sienne, non envoyée, et
-- transmettait. Elle ne vaut plus que pour une source déjà chez le comptable,
-- du même dossier. La fonction devient une porte (`security definer`) : elle
-- ne dépend que de l'identité, et lit la source sans la RLS.

create or replace function app.seul_qui_en_a_le_droit_transmet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vis = 'partage'::app.vis_t
     and (tg_op = 'INSERT' or old.vis is distinct from new.vis)
     and not app.remplacement_en_cours(new.id)
     and not (new.source_piece_id is not null
              and exists (select 1 from capture.pieces s
                           where s.id = app.version_courante(new.source_piece_id)
                             and s.tenant_id = new.tenant_id
                             and s.vis = 'partage'::app.vis_t))
     and (auth.uid() is not null or app.api_tenant() is not null)
     and not app.a_le_droit(new.tenant_id, 'envoi.cabinet') then
    raise exception 'refus.envoi.reserve_au_proprietaire'
      using errcode = '42501', hint = 'envoi.proprietaire';
  end if;
  return new;
end
$$;

revoke all on function app.seul_qui_en_a_le_droit_transmet() from public, anon, authenticated;

-- --- 5. Garder : une porte ------------------------------------------------------------------------
--
-- Repris de `20261104090000`, `security definer` : `gardee_le` ne s'écrit plus
-- que par une porte. Le contrôle que faisait la RLS est fait ici
-- (`app.piece_modifiable`), avant le droit `piece.garder`.

create or replace function public.capture_piece_garder(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_deja timestamptz;
begin
  if not app.piece_modifiable(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  select tenant_id, vis, status, app.garde_en_vigueur(id, gardee_le)
    into v_tenant, v_vis, v_status, v_deja
    from capture.pieces where id = p_piece for update;
  -- Garder, c'est décider de ne pas l'envoyer au comptable : la décision de
  -- qui l'y envoie (le siège, lui, l'envoie au propriétaire).
  if not app.a_le_droit(v_tenant, 'piece.garder') then
    raise exception 'refus.garder.reserve_au_proprietaire' using errcode = '42501';
  end if;

  if v_vis = 'partage'::app.vis_t then
    if v_status = 'retournee' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t);
      update capture.pieces set gardee_le = now(), updated_at = now() where id = p_piece;
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
              jsonb_build_object('vis', 'entite', 'retour', true));
      return jsonb_build_object('piece_id', p_piece, 'changed', true);
    end if;
    raise exception 'une piece transmise ne revient que par accord du cabinet'
      using errcode = 'check_violation';
  end if;

  if v_deja is not null then
    return jsonb_build_object('piece_id', p_piece, 'gardee_le', v_deja, 'changed', false);
  end if;

  update capture.pieces
     set gardee_le = now(),
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis));

  return jsonb_build_object('piece_id', p_piece, 'changed', true);
end
$$;

revoke all on function public.capture_piece_garder(uuid) from public, anon;
grant execute on function public.capture_piece_garder(uuid) to authenticated;

-- --- 6. Les demandes : par `piece_demander` et `piece_repondre` seulement --------------------------
--
-- Les trois portes qui y écrivent sont `security definer` ; le droit direct
-- laissait un siège demander au comptable par-dessus le propriétaire.

revoke insert on collab.demandes_sur_piece from authenticated;
drop policy if exists collab_demandes_sur_piece_ins on collab.demandes_sur_piece;

-- --- 7. Le journal et les avis : signés de qui les écrit -------------------------------------------
--
-- `audit.event_log` est un journal : il ne se modifie ni ne s'efface (un
-- déclencheur le refusait déjà ; le droit disparaît). Des fonctions `security
-- invoker` et l'API y écrivent encore directement (l'inventaire les nomme),
-- toujours au nom de l'appelant : la politique l'exige désormais. Un fait se
-- signe de son auteur, jamais d'un autre.

revoke update, delete on audit.event_log from authenticated;
drop policy if exists audit_event_log_ins on audit.event_log;
drop policy if exists event_log_ins_cabinet on audit.event_log;
create policy audit_event_log_ins on audit.event_log
  for insert to authenticated
  with check (actor = (select auth.uid())
              and (tenant_id in (select app.member_orgs())
                   or tenant_id in (select app.engaged_orgs())));

-- Un avis ADRESSÉ à quelqu'un ne s'écrit que par une porte
-- (`app.notifier_les_receveurs`, `notif.poster`…). Les quatre fonctions
-- `security invoker` qui écrivent encore un avis le font à toute la société,
-- de cinq natures : ce sont les seules qu'un client écrit
-- (`piece_corriger_apres_transmission`, la cinquième, s'en va en section 9). Ni modification ni
-- effacement (aucun chemin ne s'en sert ; la lecture d'un avis est un fait à
-- part, `collab.notification_lectures`).
revoke update, delete on collab.notifications from authenticated;
revoke insert, update on public.notifications_v from authenticated;
drop policy if exists collab_notifications_upd on collab.notifications;
drop policy if exists collab_notifications_del on collab.notifications;
drop policy if exists collab_notifications_ins on collab.notifications;
drop policy if exists notifications_ins_cabinet on collab.notifications;
create policy collab_notifications_ins on collab.notifications
  for insert to authenticated
  with check (user_id is null
              and kind in ('piece.renvoyee', 'ecriture.proposed', 'piece.validee',
                           'piece.retournee', 'pv.envoye')
              and (tenant_id in (select app.member_orgs())
                   or tenant_id in (select app.engaged_orgs())));

-- --- 8. Les droits d'écriture que rien n'emploie ---------------------------------------------------
--
-- Relevés le 31 octobre 2026 sur une base neuve : pour chacun, aucune
-- fonction `security invoker`, aucune requête de l'API, aucune vue écrite par
-- l'API ne s'en sert. Les portes (`security definer`) écrivent en leur nom
-- propre et n'en ont pas besoin.

revoke delete, insert, update on agents.budgets from authenticated;
revoke delete on agents.conversation_messages from authenticated;
revoke delete, update on audit.journal_client from authenticated;
revoke delete, update on banque.comptes from authenticated;
revoke delete on banque.lettrage_etat from authenticated;
revoke delete, update on banque.lettrages from authenticated;
revoke delete, insert, update on banque.rapprochements from authenticated;
revoke delete on banque.releve_lignes from authenticated;
revoke delete, insert, update on billing.invoice_lines from authenticated;
revoke delete, insert, update on billing.invoices from authenticated;
revoke update on capture.piece_articles from authenticated;
revoke insert on capture.piece_versions from authenticated;
revoke delete, insert, update on catalog.products from authenticated;
revoke delete, insert, update on coffre.objects from authenticated;
revoke delete, update on collab.charge_questions from authenticated;
revoke delete, update on collab.encaissements_honoraires from authenticated;
revoke delete, update on collab.exports from authenticated;
revoke delete on collab.obligations_cabinet from authenticated;
revoke delete, update on collab.obligations_propres from authenticated;
revoke delete, insert, update on collab.push_devices from authenticated;
revoke delete on collab.reglages_cabinet from authenticated;
revoke delete, insert, update on collab.reports_echeance_cabinet from authenticated;
revoke delete, insert, update on commissions.entries from authenticated;
revoke delete, insert, update on commissions.rules from authenticated;
revoke delete, insert, update on contracts.contracts from authenticated;
revoke delete, update on fabrique.evaluation_exemples from authenticated;
revoke delete, update on fabrique.evaluations from authenticated;
revoke delete, update on fabrique.promotions from authenticated;
revoke delete, update on fabrique.recette_version_exemples from authenticated;
revoke delete, update on fabrique.recette_versions from authenticated;
revoke delete, update on fabrique.recettes from authenticated;
revoke delete, insert, update on facturation.acces from authenticated;
revoke insert on facturation.emetteurs from authenticated;
revoke insert on facturation.encaissements from authenticated;
revoke insert on facturation.facture_lignes from authenticated;
revoke insert on facturation.factures from authenticated;
revoke delete, insert, update on facturation.licence_organisations from authenticated;
revoke delete on identity.api_keys from authenticated;
revoke update on identity.invitations from authenticated;
revoke delete, insert, update on identity.memberships from authenticated;
revoke insert on identity.organizations from authenticated;
revoke delete on immo.assets from authenticated;
revoke delete, update on immo.cessions from authenticated;
revoke delete, update on immo.depreciations from authenticated;
revoke delete, update on immo.dotations from authenticated;
revoke update on notif.preferences from authenticated;
revoke update on parametrage.accounts from authenticated;
revoke delete, insert, update on parametrage.fabrique_seuils from authenticated;
revoke delete, insert, update on payments.payments from authenticated;
revoke insert, update on plateforme.archives from authenticated;
revoke insert on plateforme.interventions from authenticated;
revoke insert on plateforme.reclamation_messages from authenticated;
revoke insert, update on plateforme.reclamations from authenticated;
revoke insert, update on plateforme.requisitions from authenticated;
revoke delete, insert, update on pricing.price_lists from authenticated;
revoke delete, insert, update on pricing.prices from authenticated;
revoke update on public.banque_comptes_v from authenticated;
revoke insert on public.banque_rapprochements_v from authenticated;
revoke insert, update on public.collab_assignments_v from authenticated;
revoke delete on public.engagements_v from authenticated;
revoke delete, update on public.entities_v from authenticated;
revoke insert on public.immo_depreciations_v from authenticated;
revoke insert on public.immo_dotations_v from authenticated;
revoke delete, insert, update on public.memberships_v from authenticated;
revoke delete, insert, update on public.organizations_v from authenticated;
revoke delete, insert, update on public.parametrage_role_bindings_v from authenticated;
revoke insert on public.stocks_depreciations_v from authenticated;
revoke insert on public.stocks_inventaires_v from authenticated;
revoke delete on public.tiers_v from authenticated;
revoke delete, insert, update on schedule.echeances from authenticated;
revoke delete, update on socle.ecriture_lignes from authenticated;
revoke delete, update on stocks.depreciations from authenticated;
revoke delete, update on stocks.inventaires from authenticated;
revoke delete on stocks.items from authenticated;
revoke delete, update on stocks.mouvements from authenticated;
revoke delete on tiers.auxiliaires from authenticated;

-- --- 9. Deux statuts morts ------------------------------------------------------------------------
--
-- `confirmee` (l'époque du lot 1 : la PME confirmait l'écriture) n'est posé
-- par aucune fonction ni aucune requête. `a_revalider` n'est posé que par
-- `piece_corriger_apres_transmission`, qu'aucun écran ni aucune route
-- n'appelle, et dont rien ne fait sortir une pièce : une impasse ouverte à un
-- client en SQL brut. La porte s'en va ; les lignes qui porteraient l'un de
-- ces statuts reprennent celui d'avant (le fait de la correction le dit), et
-- le fait de la régularisation s'inscrit au journal, signé de l'auteur de la
-- pièce comme le veut le précédent de `20261025200000` (`actor` est
-- obligatoire, et aucune session n'en porte pendant une migration).

drop function if exists public.piece_corriger_apres_transmission(uuid, text, text);

with regularisees as (
  update capture.pieces p
     set status = case
                    when p.status = 'confirmee' then 'proposee'
                    else coalesce((select e.payload ->> 'statut_avant'
                                     from audit.event_log e
                                    where e.object_id = p.id
                                      and e.action = 'piece.corrigee_apres_transmission'
                                      and e.payload ->> 'statut_avant' not in ('confirmee', 'a_revalider')
                                    order by e.at desc
                                    limit 1),
                                  'lue')
                  end,
         updated_at = now()
   where p.status in ('confirmee', 'a_revalider')
     -- Une version précédente ne bouge plus (`une_version_precedente_ne_bouge_plus`).
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
  returning p.id, p.tenant_id, p.created_by, p.status
)
insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                             object_id, payload)
select tenant_id, created_by, 'piece.statut_regularise', 'capture', 'pieces', id,
       jsonb_build_object('vers', status, 'regularisation', '20261104130000')
  from regularisees;

-- Une version précédente figée sur un statut mort ne se réécrit pas en
-- silence : la migration s'arrête et le dit.
do $$
begin
  if exists (select 1 from capture.pieces where status in ('confirmee', 'a_revalider')) then
    raise exception 'une version precedente porte un statut retire (confirmee, a_revalider) : a trancher avant cette migration';
  end if;
end
$$;

alter table capture.pieces drop constraint pieces_status_check;
alter table capture.pieces add constraint pieces_status_check
  check (status in ('capturee', 'lue', 'proposee', 'comptabilisee', 'supervisee', 'retournee'));

-- Repris de `20261101090000`, sans le statut retiré.
create or replace view public.pieces_qui_comptent_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.vis, p.status, p.document_kind, p.transmise_le, p.created_at,
         case when pe.lisible then 'cabinet' else 'lecture' end as source
    from capture.pieces p
    join ref.document_types t on t.code = p.document_kind
    left join app.pieces_prises_en_charge() pe on pe.piece_id = p.id
   where t.porte_ecriture
     and p.vis <> 'personnel'::app.vis_t
     and p.doublon_de is null
     and p.status in ('proposee', 'comptabilisee', 'supervisee')
     -- Une version précédente n'entre dans aucune déclaration : c'est la
     -- photo qui l'a remplacée qui compte.
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id);

commit;
