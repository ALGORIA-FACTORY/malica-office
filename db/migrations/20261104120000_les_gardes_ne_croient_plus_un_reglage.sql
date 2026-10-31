-- Les gardes ne croient plus un réglage de session (revue de #146, suite).
--
-- Deux réglages de session portaient des décisions de la base, et toute
-- session peut poser un réglage de session :
--   1. `malica.remplacement`, que `piece_remplacer` posait pour dire « ce
--      n'est pas un envoi » : `20261104090000` le remplace par le fait inscrit
--      dans `capture.remplacements`. Plus personne ne le lisait ; la porte ne
--      le pose plus.
--   2. `malica.piece_effacable` et `malica.paiements_effacables`, par lesquels
--      `capture_piece_supprimer` laissait passer l'effacement des faits d'une
--      pièce (R7). Même classe : ils deviennent un fait de la transaction.
-- Et `piece_remplacer` clôt désormais une demande en attente à son étape
-- (au propriétaire ou au comptable), lue par `app.etat_des_demandes`.

begin;

-- --- 1. La reprise de la photo : repris de `20261029190000`, sans le réglage --------------------------

create or replace function public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  a record;
  n record;
begin
  -- Les deux lignes, dans un ordre fixe : deux remplacements croisés ne
  -- s'attendent pas l'un l'autre.
  perform 1 from capture.pieces where id in (p_ancienne, p_nouvelle) order by id for update;
  select * into a from capture.pieces where id = p_ancienne;
  select * into n from capture.pieces where id = p_nouvelle;

  -- L'ancienne n'est plus là pour celui qui la reprend — retirée, archivée,
  -- jamais vue : la reprise le dit par son code (la file hors ligne propose
  -- alors de garder la photo comme une pièce à part).
  if a.id is null or not app.piece_lisible(p_ancienne) then
    raise exception 'refus.remplacement.introuvable' using errcode = 'P0002';
  end if;

  -- `security definer` court-circuite la RLS : le contrôle est refait ici.
  if n.id is null or p_ancienne = p_nouvelle
     or a.tenant_id <> n.tenant_id
     or a.tenant_id not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if exists (select 1 from capture.remplacements r
              where r.piece_id = p_ancienne and r.remplacee_par = p_nouvelle) then
    return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', true);
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_ancienne) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Un reçu, un justificatif : ils ont leur propre reprise (`justificatif_remplacer`).
  if a.source_piece_id is not null or app.piece_accompagne(p_ancienne) then
    raise exception 'refus.remplacement.accompagne' using errcode = 'check_violation';
  end if;

  -- Une pièce prise en charge porte une écriture : le cabinet la retourne
  -- d'abord (contre-passation), puis la photo se reprend.
  if a.status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_ancienne))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.remplacement.inscrite' using errcode = 'check_violation';
  end if;

  -- La nouvelle est une photo qui vient d'être prise, par celui qui remplace,
  -- et rien d'autre : jamais une pièce lue, issue d'une autre, ou déjà liée.
  if n.status <> 'capturee'
     or n.created_by is distinct from auth.uid()
     or n.source_piece_id is not null
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouvelle)
     or exists (select 1 from capture.remplacements r
                 where r.remplacee_par = p_nouvelle or r.piece_id = p_nouvelle) then
    raise exception 'refus.remplacement.nouvelle_photo' using errcode = 'check_violation';
  end if;

  -- Qui reprend la photo est inscrit ici (`auteur`) ; la pièce, elle, reste
  -- à l'auteur de l'ancienne.
  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  -- La nouvelle hérite du partage de l'ancienne : ce n'est pas une nouvelle
  -- transmission, et un impayé ne doit pas empêcher de corriger une pièce
  -- déjà envoyée. Les déclencheurs le lisent au fait inscrit juste au-dessus
  -- (`app.remplacement_en_cours`), jamais à un réglage de session.
  update capture.pieces
     set vis = a.vis,
         entity_id = coalesce(n.entity_id, a.entity_id),
         transmise_le = a.transmise_le,
         gardee_le = a.gardee_le,
         -- La pièce d'un siège reprise par le dirigeant reste celle du siège.
         created_by = a.created_by,
         -- Le retour en cours suit la photo ; sinon, elle part en lecture.
         status = case when a.status = 'retournee' then 'retournee' else 'capturee' end,
         -- Le type déclaré suit, à confirmer : la lecture aura le dernier mot.
         document_kind = coalesce(n.document_kind, a.document_kind),
         document_kind_statut = case
           when n.document_kind is not null then n.document_kind_statut
           when a.document_kind is not null then 'a_confirmer'
           else n.document_kind_statut end,
         updated_at = now()
   where id = p_nouvelle;

  -- Les documents rattachés à l'ancienne ne se recopient pas : `rattachements_v`
  -- les lit à travers la version courante.

  -- Une demande en attente sur l'ancienne n'a plus d'objet : on inscrit le
  -- fait qui la clôt, À SON ÉTAPE (au propriétaire, au comptable) — la ligne
  -- « demandee » reste, R7. L'état se lit par étape (`app.etat_des_demandes`).
  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  select a.tenant_id, p_ancienne, e.objet, 'retiree', null, auth.uid(), e.etape
    from app.etat_des_demandes(p_ancienne) e
   where e.fait = 'demandee';

  perform app.piece_oublie_ses_propositions(p_ancienne);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (a.tenant_id, auth.uid(), 'piece.remplacee', 'capture', 'pieces', p_nouvelle,
          jsonb_build_object('remplace', p_ancienne, 'vis', a.vis, 'status', a.status));

  if a.vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (a.tenant_id, 'piece.remplacee',
            jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne));
  end if;

  return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', false);
end
$function$;

-- --- 2. Un effacement se prouve par un fait --------------------------------------------------------
--
-- Les faits d'une pièce (lectures, citations, vues, circuit, paiements…) ne
-- s'effacent qu'avec elle, quand `capture_piece_supprimer` l'a jugée
-- effaçable. Les gardes (`app.deny_mutation_hors_effacement_de_piece` et
-- `…_de_travail`) le reconnaissaient à `malica.piece_effacable` et
-- `malica.paiements_effacables`, des réglages que toute session peut poser :
-- R7 tenait parce qu'aucun client n'a le droit d'écrire ces tables, pas parce
-- que la garde le vérifiait. Elle le vérifie désormais : la porte inscrit,
-- dans sa transaction, les pièces et les paiements qu'elle efface, dans une
-- table que seuls ses `security definer` écrivent ; elle les en retire avant
-- de rendre la main.

create table if not exists capture.effacements_en_cours (
  id          bigint generated always as identity primary key,
  -- La transaction qui efface : une autre ne s'en prévaut jamais.
  xact        xid8 not null default pg_current_xact_id(),
  piece_id    uuid,
  paiement_id uuid,
  constraint effacements_en_cours_un_objet check (num_nonnulls(piece_id, paiement_id) = 1)
);

create index if not exists effacements_en_cours_piece_idx
  on capture.effacements_en_cours (xact, piece_id);
create index if not exists effacements_en_cours_paiement_idx
  on capture.effacements_en_cours (xact, paiement_id);

comment on table capture.effacements_en_cours is
  'Les pièces et paiements que capture_piece_supprimer efface, le temps de SA transaction. Écrite par ses seuls security definer ; vide hors d''une suppression.';

alter table capture.effacements_en_cours enable row level security;
alter table capture.effacements_en_cours force row level security;
revoke all on table capture.effacements_en_cours from public, anon, authenticated;

create or replace function app.effacement_en_cours(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from capture.effacements_en_cours e
                  where e.xact = pg_current_xact_id() and e.piece_id = p_piece)
$$;

create or replace function app.paiement_en_effacement(p_paiement uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from capture.effacements_en_cours e
                  where e.xact = pg_current_xact_id() and e.paiement_id = p_paiement)
$$;

create or replace function app.un_effacement_en_cours()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from capture.effacements_en_cours e
                  where e.xact = pg_current_xact_id() and e.piece_id is not null)
$$;

-- Un paiement part avec la pièce qu'on efface : on le note, pour que ses
-- justificatifs, effacés ensuite par cascade, s'y reconnaissent. Rien n'est
-- noté hors de l'effacement de SA pièce.
create or replace function app.noter_paiement_efface(p_paiement uuid, p_piece uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into capture.effacements_en_cours (paiement_id)
  select p_paiement where app.effacement_en_cours(p_piece)
$$;

revoke all on function app.effacement_en_cours(uuid) from public, anon;
grant execute on function app.effacement_en_cours(uuid) to authenticated;
revoke all on function app.paiement_en_effacement(uuid) from public, anon;
grant execute on function app.paiement_en_effacement(uuid) to authenticated;
revoke all on function app.un_effacement_en_cours() from public, anon;
grant execute on function app.un_effacement_en_cours() to authenticated;
revoke all on function app.noter_paiement_efface(uuid, uuid) from public, anon, authenticated;

-- Inscrire, effacer, retirer : la porte de `capture_piece_supprimer`.
create or replace function app.effacer_la_piece(p_piece uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into capture.effacements_en_cours (piece_id) values (p_piece);
  delete from capture.pieces where id = p_piece;
end
$$;

create or replace function app.effacements_clos()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from capture.effacements_en_cours where xact = pg_current_xact_id()
$$;

revoke all on function app.effacer_la_piece(uuid) from public, anon, authenticated;
revoke all on function app.effacements_clos() from public, anon, authenticated;

-- Repris de `20261029100000`, le fait au lieu du réglage, passage par passage.
create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Premier passage : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE' and app.effacement_en_cours(old.piece_id) then
    -- Un paiement qui part avec la pièce est noté : ses justificatifs,
    -- supprimés ensuite par cascade, s'y reconnaîtront.
    if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
      perform app.noter_paiement_efface(old.id, old.piece_id);
    end if;
    return old;
  end if;

  if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
    -- Second passage : le SET NULL d'un justificatif qui disparaît. La pièce
    -- effacée est celle que le paiement citait, la colonne part vers NULL, et
    -- AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and old.justificatif_piece_id is not null
       and app.effacement_en_cours(old.justificatif_piece_id)
       and new.justificatif_piece_id is null
       and to_jsonb(new) - 'justificatif_piece_id'
         = to_jsonb(old) - 'justificatif_piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture'
        and tg_table_name in ('paiement_justificatifs', 'recu_paiements') then
    -- Troisième et cinquième passages : la ligne de preuve d'un paiement qui
    -- part avec sa facture, le lien d'un reçu vers lui. Le reçu, lui, reste.
    if tg_op = 'DELETE' and app.paiement_en_effacement(old.paiement_id) then
      return old;
    end if;
  elsif (tg_table_schema, tg_table_name) in (('agents', 'agent_runs'), ('fabrique', 'derives')) then
    -- Sixième passage : le SET NULL d'une trace qui survit à la pièce.
    if tg_op = 'UPDATE'
       and old.piece_id is not null
       and app.effacement_en_cours(old.piece_id)
       and new.piece_id is null
       and to_jsonb(new) - 'piece_id' = to_jsonb(old) - 'piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'rattachements' then
    -- Quatrième passage : le registre des rattachements a DEUX bouts.
    if tg_op = 'DELETE' and app.effacement_en_cours(old.piece_liee_id) then
      return old;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'remplacements' then
    -- Septième passage : la nouvelle photo effacée emporte le fait qui la liait.
    if tg_op = 'DELETE' and app.effacement_en_cours(old.remplacee_par) then
      return old;
    end if;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- Repris de `20261020200000` : l'effacement en cours, ET la disparition du
-- travail dont ce fait dépend.
create or replace function app.deny_mutation_hors_effacement_de_travail()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and app.un_effacement_en_cours()
     and not exists (
       select 1 from fabrique.travaux t
        where t.tenant_id = old.tenant_id and t.id = old.travail_id)
  then
    return old;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

commit;
