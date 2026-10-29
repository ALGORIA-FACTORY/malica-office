-- Une pièce retournée ne bloque jamais, et « Renvoyer » n'inscrit jamais une
-- lecture fausse (« Malica sans blocage », maquette validée le 28 octobre 2026,
-- docs/sans-blocage.md).
--
-- Relevé sur la base de test le 28 octobre, sur une pièce transmise que le
-- cabinet a retournée — avant toute écriture, et après prise en charge puis
-- contre-passation :
--   * la PME ne pouvait ni la supprimer (« demande son accord »), ni la garder ;
--   * une suppression ACCORDÉE par le cabinet échouait (« engagée »), même sans
--     aucune écriture ;
--   * un rappel accordé la mettait dans l'espace privé de son auteur, d'où
--     plus rien ne la sortait ;
--   * « Reprendre la photo » créait une pièce sans lien avec la première, et
--     « Renvoyer » réinscrivait l'ANCIENNE lecture — après contre-passation,
--     avec ses montants faux.
--
-- Ce que ce fichier pose :
--   1. `capture.pieces.archivee_le` : une pièce qu'une écriture contre-passée
--      retient ne s'efface pas, elle s'archive — invisible pour le client,
--      gardée par le cabinet ;
--   2. `capture.remplacements` : reprendre la photo est un FAIT (R7) — la
--      nouvelle prend la place de l'ancienne, qui reste comme version
--      précédente, jamais effacée ;
--   3. `pieces_v` dit l'archive et le remplacement ; la RLS cache au client
--      ce qu'il a archivé ;
--   4. une pièce remplacée ou archivée ne s'inscrit plus, par personne ;
--   5. `piece_remplacer`, `piece_renvoyer` ; `capture_piece_supprimer`,
--      `capture_piece_set_vis`, `capture_piece_garder`, `piece_repondre`,
--      `piece_demander`, `piece_retour` reprises ;
--   6. la lecture d'une pièce retournée ne clôt pas son retour : seul
--      « Renvoyer » le fait.

begin;

-- --- 1. L'archive -----------------------------------------------------------------------------

alter table capture.pieces add column if not exists archivee_le timestamptz;

-- --- 2. Le remplacement, un fait ---------------------------------------------------------------

create table if not exists capture.remplacements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  -- L'ancienne photo : remplacée une fois, et pour toujours.
  piece_id      uuid not null unique references capture.pieces(id) on delete cascade,
  -- La nouvelle : elle ne remplace qu'une pièce.
  remplacee_par uuid not null unique references capture.pieces(id) on delete cascade,
  auteur        uuid,
  created_at    timestamptz not null default now(),
  constraint remplacements_deux_pieces check (piece_id <> remplacee_par)
);

create index if not exists remplacements_tenant_piece_idx
  on capture.remplacements (tenant_id, piece_id);
create index if not exists remplacements_tenant_par_idx
  on capture.remplacements (tenant_id, remplacee_par);

select app.enable_tenant_rls('capture', 'remplacements', false, true);

-- Personne n'écrit ce registre à la main : `piece_remplacer` est sa seule porte.
revoke insert, update, delete on table capture.remplacements from authenticated;

-- Le garde d'effacement apprend le second bout du remplacement : la nouvelle
-- photo effacée emporte le fait qui la liait à l'ancienne.
--
-- Repris À L'IDENTIQUE de sa dernière version (`20261027090000`, six
-- passages) ; seul le septième est nouveau.
create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effacable text := coalesce(current_setting('malica.piece_effacable', true), '');
  v_paiements text;
begin
  -- Premier passage : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE' and v_effacable = old.piece_id::text then
    -- Un paiement qui part avec la pièce note son identifiant : ses
    -- justificatifs, supprimés ensuite par cascade, s'y reconnaîtront.
    if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
      perform set_config(
        'malica.paiements_effacables',
        coalesce(current_setting('malica.paiements_effacables', true), '')
          || ',' || old.id::text,
        true);
    end if;
    return old;
  end if;

  if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
    -- Second passage : le SET NULL d'un justificatif qui disparaît. La pièce
    -- effacée est celle que le paiement citait, la colonne part vers NULL, et
    -- AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and old.justificatif_piece_id is not null
       and v_effacable = old.justificatif_piece_id::text
       and new.justificatif_piece_id is null
       and to_jsonb(new) - 'justificatif_piece_id'
         = to_jsonb(old) - 'justificatif_piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture'
        and tg_table_name in ('paiement_justificatifs', 'recu_paiements') then
    -- Troisième passage : la ligne de preuve d'un paiement qui part avec sa
    -- facture. Son `piece_id` est le talon, pas la pièce effacée.
    -- Cinquième passage (25 octobre 2026), même règle : le lien d'un reçu
    -- vers un paiement qui part avec sa facture. Le reçu, lui, reste.
    v_paiements := coalesce(current_setting('malica.paiements_effacables', true), '');
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and (',' || v_paiements || ',') like ('%,' || old.paiement_id::text || ',%')
    then
      return old;
    end if;
  elsif (tg_table_schema, tg_table_name) in (('agents', 'agent_runs'), ('fabrique', 'derives')) then
    -- Sixième passage (27 octobre 2026) : le SET NULL d'une trace qui survit
    -- à la pièce — l'appel au modèle qui l'a lue, le dérivé d'une recette.
    -- La pièce effacée est celle que la ligne citait, la colonne part vers
    -- NULL, et AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and v_effacable <> ''
       and old.piece_id is not null
       and v_effacable = old.piece_id::text
       and new.piece_id is null
       and to_jsonb(new) - 'piece_id' = to_jsonb(old) - 'piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'rattachements' then
    -- Quatrième passage : le registre des rattachements a DEUX bouts. La pièce
    -- effacée peut être la pièce liée ; le premier passage n'a lu que l'autre.
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and v_effacable = old.piece_liee_id::text
    then
      return old;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'remplacements' then
    -- Septième passage (28 octobre 2026) : le remplacement a deux bouts, lui
    -- aussi. La nouvelle photo effacée emporte le fait qui la liait.
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and v_effacable = old.remplacee_par::text
    then
      return old;
    end if;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists capture_remplacements_no_upd on capture.remplacements;
create trigger capture_remplacements_no_upd
  before delete or update on capture.remplacements
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- --- 3. Ce que la vue dit, ce que la RLS cache ------------------------------------------------

-- Les colonnes d'avant, dans le même ordre ; trois à la fin.
create or replace view public.pieces_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.entity_id, p.vis, p.source, p.storage_path, p.sha256,
         p.page_count, p.status, p.idempotency_key, p.created_by, p.created_at,
         p.updated_at, p.content_type, p.document_kind, p.document_kind_statut,
         p.transmise_le, p.gardee_le, p.source_piece_id,
         p.archivee_le,
         -- La photo qui a pris sa place : la pièce quitte les listes.
         (select r.remplacee_par from capture.remplacements r where r.piece_id = p.id)
           as remplacee_par,
         -- La photo qu'elle remplace : sa version précédente.
         (select r.piece_id from capture.remplacements r where r.remplacee_par = p.id)
           as remplace
    from capture.pieces p;

-- Une pièce archivée n'est plus au client : elle reste au cabinet sous mandat,
-- et à l'opérateur dans le cas nommé. Le reste de la politique est inchangé
-- (`20261019090000`).
drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    (archivee_le is null and (
         (vis = 'personnel'::app.vis_t and created_by = auth.uid())
      or (vis = 'entite'::app.vis_t  and tenant_id in (select app.member_orgs()))
      or (vis = 'partage'::app.vis_t and (
            tenant_id in (select app.member_orgs())
            or tenant_id in (select app.engaged_orgs())))))
    or (archivee_le is not null and tenant_id in (select app.engaged_orgs()))
    or app.plateforme_requise(tenant_id)
  );

-- La même règle, pour les fonctions qui la refont hors RLS.
create or replace function app.piece_lisible(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from capture.pieces p
    where p.id = p_piece
      and (
        (p.archivee_le is null and (
             (p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
          or (p.vis = 'entite'::app.vis_t  and p.tenant_id in (select app.member_orgs()))
          or (p.vis = 'partage'::app.vis_t and (
                p.tenant_id in (select app.member_orgs())
                or p.tenant_id in (select app.engaged_orgs())))))
        or (p.archivee_le is not null and p.tenant_id in (select app.engaged_orgs()))
        -- L'exception, et elle est nommée.
        or app.plateforme_requise(p.tenant_id)
      )
  )
$$;

-- --- 4. Ce qui est remplacé ou archivé ne s'inscrit plus ---------------------------------------
--
-- « Renvoyer » réinscrivait l'ancienne lecture. La règle est ici et pas dans un
-- écran : une écriture de pièce ne naît ni ne s'inscrit sur une pièce qu'une
-- autre photo remplace, ou que le client a retirée. Une contre-passation, elle,
-- passe toujours.

create or replace function app.une_piece_retiree_ne_s_inscrit_plus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.piece_id is not null
     and new.nature = 'piece'
     and new.reverses_id is null
     and (tg_op = 'INSERT' or (old.status = 'proposee' and new.status = 'booked')) then
    if exists (select 1 from capture.remplacements r where r.piece_id = new.piece_id) then
      raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.pieces p
                where p.id = new.piece_id and p.archivee_le is not null) then
      raise exception 'refus.piece.archivee' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function app.une_piece_retiree_ne_s_inscrit_plus() from public, anon;

drop trigger if exists une_piece_retiree_ne_s_inscrit_plus on socle.ecritures;
create trigger une_piece_retiree_ne_s_inscrit_plus
  before insert or update of status on socle.ecritures
  for each row execute function app.une_piece_retiree_ne_s_inscrit_plus();

-- Une proposition calculée sur une lecture qui ne vaut plus ne reste pas
-- derrière elle : le cabinet recalcule sur la lecture courante. Seules les
-- propositions de la PIÈCE (pas d'un règlement), jamais une écriture inscrite.
create or replace function app.piece_oublie_ses_propositions(p_piece uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from socle.ecritures e
   where e.piece_id = p_piece
     and e.status = 'proposee'
     and e.reverses_id is null
     and e.nature = 'piece'
$$;

revoke all on function app.piece_oublie_ses_propositions(uuid) from public, anon;
grant execute on function app.piece_oublie_ses_propositions(uuid) to authenticated;

-- Où en est une pièce que le retour rend au client : lue si elle l'a été,
-- capturée sinon. Une seule règle, pour « Renvoyer » et pour la reprendre.
create or replace function app.statut_hors_retour(p_piece uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when exists (select 1 from capture.extractions x where x.piece_id = p_piece)
              then 'lue' else 'capturee' end
$$;

revoke all on function app.statut_hors_retour(uuid) from public, anon;
grant execute on function app.statut_hors_retour(uuid) to authenticated;

-- --- 5a. La lecture ne clôt pas un retour ------------------------------------------------------
--
-- Corps repris de `20261005120000` à l'identique, sauf le statut : une pièce
-- retournée qu'on lit — la photo qui remplace celle que le cabinet a
-- retournée — le RESTE. Son retour attend « Renvoyer » ; le passer à « lue »
-- l'aurait renvoyée au cabinet sans que le client l'ait décidé.

create or replace function public.capture_read_persist(
  p_piece uuid,
  p_tokens jsonb,
  p_contract text,
  p_extract jsonb,
  p_citations jsonb,
  p_flags jsonb default '[]'::jsonb,
  p_mode text default null,
  p_confiance jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_tok jsonb;
  v_cit jsonb;
  v_token_id uuid;
  v_count int := 0;
  v_kind text;
  v_extraction uuid;
  v_page smallint;
  v_ordinal int;
  v_fin int;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- R7 : une lecture est un fait. On ne la remplace pas.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    raise exception 'R7 : cette piece a deja ete lue — rephotographiez-la pour en creer une nouvelle'
      using errcode = 'restrict_violation';
  end if;
  for v_tok in select * from jsonb_array_elements(p_tokens)
  loop
    insert into capture.token_plan (tenant_id, piece_id, page, ordinal, text,
                                    x0, y0, x1, y1, confidence)
    values (v_tenant, p_piece,
            (v_tok->>'page')::smallint, (v_tok->>'ordinal')::int, v_tok->>'text',
            (v_tok->>'x0')::numeric, (v_tok->>'y0')::numeric,
            (v_tok->>'x1')::numeric, (v_tok->>'y1')::numeric,
            nullif(v_tok->>'confidence','')::numeric);
  end loop;
  for v_cit in select * from jsonb_array_elements(p_citations)
  loop
    v_page := (v_cit->>'page')::smallint;
    v_ordinal := (v_cit->>'ordinal')::int;
    -- La clé arrive en camelCase : c'est le nom du champ TypeScript
    -- (`TokenRef.ordinalEnd`), sérialisé tel quel, comme l'est déjà `bbox`.
    v_fin := nullif(v_cit->>'ordinalEnd', '')::int;
    if v_fin is not null and v_fin <= v_ordinal then
      v_fin := null;
    end if;

    select t.id into v_token_id
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = v_page
       and t.ordinal = v_ordinal;
    if v_token_id is null then
      raise exception 'R2 : citation orpheline pour le champ % — aucun token lu a cet emplacement',
        v_cit->>'field' using errcode = 'check_violation';
    end if;

    -- Une fin de plage qui ne désigne aucun jeton élargirait le cadre cité
    -- sans rien derrière : c'est le même défaut que la citation orpheline.
    if v_fin is not null and not exists (
      select 1 from capture.token_plan t
       where t.piece_id = p_piece and t.page = v_page and t.ordinal = v_fin
    ) then
      raise exception 'R2 : plage de citation orpheline pour le champ % — aucun token lu a l''ordinal de fin %',
        v_cit->>'field', v_fin using errcode = 'check_violation';
    end if;

    -- Le cadre est l'union des jetons cités. Pour un jeton seul, c'est le sien.
    insert into capture.citations (tenant_id, piece_id, field, token_id, page, ordinal_end,
                                   bbox, zone, ui_field, ui_role, bbox_page_px)
    select v_tenant, p_piece, v_cit->>'field', v_token_id, v_page, v_fin,
           jsonb_build_object('x0', min(t.x0), 'y0', min(t.y0),
                              'x1', max(t.x1), 'y1', max(t.y1)),
           nullif(v_cit->>'zone',''),
           nullif(v_cit->>'ui_field',''),
           nullif(v_cit->>'ui_role',''),
           case when v_cit ? 'bbox' then v_cit->'bbox' else null end
      from capture.token_plan t
     where t.piece_id = p_piece
       and t.page = v_page
       and t.ordinal between v_ordinal and coalesce(v_fin, v_ordinal);
    v_count := v_count + 1;
  end loop;
  insert into capture.extractions (tenant_id, piece_id, contract, payload, flags,
                                   mode_lecture, confiance_par_champ)
  values (v_tenant, p_piece, p_contract, p_extract, p_flags,
          nullif(trim(coalesce(p_mode, '')), ''), coalesce(p_confiance, '{}'::jsonb))
  returning id into v_extraction;

  -- Le type lu, s'il fait partie du vocabulaire, monte sur la pièce : lu,
  -- pas encore confirmé. Un type déjà confirmé par la personne n'est jamais
  -- écrasé par une lecture.
  select t.code into v_kind
    from ref.document_types t
   where t.code = p_extract->>'document_kind';

  update capture.pieces
     set status = case when status = 'capturee' then 'lue' else status end,
         document_kind = case when document_kind_statut = 'confirme' then document_kind
                              else coalesce(v_kind, document_kind) end,
         document_kind_statut = case when document_kind_statut = 'confirme' then 'confirme'
                                     when v_kind is not null then 'a_confirmer'
                                     else document_kind_statut end,
         updated_at = now()
   where id = p_piece;

  -- Qui a lu quoi, comment : l'audit de la lecture.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.read', 'capture', 'extractions', v_extraction,
          jsonb_build_object('piece', p_piece, 'contract', p_contract,
                             'mode', nullif(trim(coalesce(p_mode, '')), ''),
                             'citations', v_count,
                             'flags', jsonb_array_length(coalesce(p_flags, '[]'::jsonb))));

  return jsonb_build_object('piece_id', p_piece, 'citations', v_count,
                            'document_kind', v_kind, 'extraction_id', v_extraction);
end
$function$;

-- --- 5b. Reprendre la photo REMPLACE -----------------------------------------------------------
--
-- La nouvelle photo prend la place de l'ancienne : sa visibilité, son retour
-- en cours (la reprise EST la preuve), ses rattachements, sa place dans la
-- file du cabinet (`transmise_le`). L'ancienne reste, comme version
-- précédente : jamais effacée, elle quitte les listes. Rejouable : la même
-- paire rend `deja`.

create or replace function public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  n record;
  v_liee record;
begin
  -- Les deux lignes, dans un ordre fixe : deux remplacements croisés ne
  -- s'attendent pas l'un l'autre.
  perform 1 from capture.pieces where id in (p_ancienne, p_nouvelle) order by id for update;
  select * into a from capture.pieces where id = p_ancienne;
  select * into n from capture.pieces where id = p_nouvelle;

  -- `security definer` court-circuite la RLS : le contrôle est refait ici.
  if a.id is null or n.id is null or p_ancienne = p_nouvelle
     or a.tenant_id <> n.tenant_id
     or a.tenant_id not in (select app.member_orgs())
     or not app.piece_lisible(p_ancienne) then
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
                 where e.piece_id = p_ancienne and e.status = 'booked'
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

  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  update capture.pieces
     set vis = a.vis,
         entity_id = coalesce(n.entity_id, a.entity_id),
         transmise_le = a.transmise_le,
         gardee_le = a.gardee_le,
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

  -- Les documents rattachés à l'ancienne le sont à la nouvelle : un fait
  -- nouveau par paire (R7) ; ceux de l'ancienne restent au registre.
  for v_liee in
    select case when r.piece_id = p_ancienne then r.piece_liee_id else r.piece_id end as autre
      from public.rattachements_v r
     where (r.piece_id = p_ancienne or r.piece_liee_id = p_ancienne)
       and r.fait = 'rattache'
  loop
    if v_liee.autre <> p_nouvelle
       and coalesce((select f.fait from capture.dernier_fait_de_la_paire(p_nouvelle, v_liee.autre) f),
                    'detache') <> 'rattache' then
      insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
      values (a.tenant_id, p_nouvelle, v_liee.autre, 'rattache', auth.uid());
    end if;
  end loop;

  -- Une demande en attente sur l'ancienne n'a plus d'objet : on inscrit le
  -- fait qui la clôt — la ligne « demandee » reste, R7.
  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  select a.tenant_id, p_ancienne, d.objet, 'retiree', null, auth.uid()
    from (select distinct on (x.objet) x.objet, x.fait
            from collab.demandes_sur_piece x
           where x.piece_id = p_ancienne
           order by x.objet, x.created_at desc) d
   where d.fait = 'demandee';

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
$$;

revoke all on function public.piece_remplacer(uuid, uuid) from public, anon;
grant execute on function public.piece_remplacer(uuid, uuid) to authenticated;

-- --- 5c. « Renvoyer » remet la pièce au cabinet ------------------------------------------------
--
-- Le client ne confirme plus d'écriture (docs/sans-blocage.md, § 1) : renvoyer
-- clôt le retour et rend la pièce au cabinet, qui propose sur la lecture
-- COURANTE, ou force. Rien ne s'inscrit ici, et aucune proposition calculée
-- sur l'ancienne lecture ne repart avec elle.

create or replace function public.piece_renvoyer(p_piece uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- C'est la photo qui la remplace qui repart, jamais l'ancienne.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  if v_vis <> 'partage'::app.vis_t or v_status <> 'retournee' then
    raise exception 'refus.renvoi.sans_retour' using errcode = 'check_violation';
  end if;

  perform app.piece_oublie_ses_propositions(p_piece);

  update capture.pieces
     set status = app.statut_hors_retour(p_piece), updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.renvoyee', 'capture', 'pieces', p_piece, '{}'::jsonb);

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.renvoyee', jsonb_build_object('piece_id', p_piece));

  -- L'heure de la base : c'est elle que l'écran « Envoyé. » dit.
  return jsonb_build_object('piece_id', p_piece, 'le', now());
end
$$;

revoke all on function public.piece_renvoyer(uuid) from public, anon;
grant execute on function public.piece_renvoyer(uuid) to authenticated;

-- --- 5d. Ce que la PME lit d'un retour ---------------------------------------------------------
--
-- Repris de `20261026120000`. Deux ajouts : le retour posé sur une version
-- précédente suit la photo qui la remplace, et une reprise de la photo après
-- le retour vaut preuve « rattachement » ; une preuve faite sur une version
-- précédente compte aussi.

create or replace function public.piece_retour(p_piece uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive p as (
    select id, tenant_id, status from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
  ),
  versions(id) as (
    select id from p
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  ),
  c as (
    select c.decided_at, c.note, c.motif_id, c.decided_by
      from capture.conformite c join versions v on v.id = c.piece_id
     where c.verdict = 'a_corriger'::app.verdict_t
     order by c.decided_at desc limit 1
  )
  select case when (select status from p) = 'retournee' and exists (select 1 from c) then
    jsonb_build_object(
      'le', (select decided_at from c),
      'note', (select note from c),
      'motif', m.code,
      'motifLibelle', coalesce(l.value, lf.value, m.code),
      'geste', m.geste,
      'cabinet', (select o.name
                    from identity.engagements e
                    join identity.organizations o on o.id = e.cabinet_org_id
                   where e.pme_org_id = (select tenant_id from p) and e.status = 'actif'
                   order by e.starts_on desc nulls last limit 1),
      'fait', case m.preuve
        when 'aucune' then true
        when 'rattachement' then exists (
          select 1 from public.rattachements_v r join versions v
              on v.id in (r.piece_id, r.piece_liee_id)
           where r.fait = 'rattache'
             and r.created_at > (select decided_at from c))
          or exists (
          select 1 from capture.remplacements r join versions v on v.id = r.remplacee_par
           where r.created_at > (select decided_at from c))
        when 'precision' then exists (
          select 1 from capture.precisions pr join versions v on v.id = pr.piece_id
           where pr.champ = 'document_date'
             and pr.decided_at > (select decided_at from c))
        when 'reponse' then exists (
          select 1 from audit.event_log ev join versions v on v.id = ev.object_id
           where ev.action = 'piece.reponse_client'
             and ev.at > (select decided_at from c))
        else false end)
  end
    from c
    join ref.rejet_motifs m on m.id = c.motif_id
    left join ref.labels l on l.ns = 'rejet_motif' and l.key = m.code and l.locale = p_locale
    left join ref.labels lf on lf.ns = 'rejet_motif' and lf.key = m.code and lf.locale = 'fr'
$$;

-- --- 5e. Supprimer : effacer, ou archiver ------------------------------------------------------
--
-- La seule porte par laquelle une pièce disparaît, reprise de `20261027120000`.
-- Ce qui change :
--   * une pièce RETOURNÉE est rendue au client : il la supprime sans accord ;
--   * un statut ne bloque plus à lui seul : seule une écriture VIVANTE retient
--     la pièce (« engagée ») ; une proposition jamais inscrite part avec elle ;
--   * une écriture a existé, contre-passée depuis : la pièce la justifie au
--     journal du cabinet — archivée, jamais effacée ;
--   * ses versions précédentes partent aux archives avec elle ;
--   * elle rend ce qu'elle a fait (`supprimee` ou `archivee`) : l'API n'efface
--     les octets que d'une pièce effacée.
-- Le cabinet est prévenu quand le client retire une pièce qu'il avait reçue.

drop function if exists public.capture_piece_supprimer(uuid, boolean);
create function public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vis      text;
  v_status   text;
  v_tenant   uuid;
  v_archivee timestamptz;
begin
  select p.vis::text, p.status, p.tenant_id, p.archivee_le
    into v_vis, v_status, v_tenant, v_archivee
    from capture.pieces p where p.id = p_piece for update;

  if v_vis is null then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- `security definer` court-circuite la RLS : on refait ICI le contrôle de
  -- la politique `capture_pieces_del`.
  -- Le cabinet sous mandat n'est pas membre du dossier : il n'entre que pour
  -- exécuter un accord que la donnée établit (section 17), jamais autrement.
  if v_tenant not in (select app.member_orgs())
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- Déjà retirée : le geste rejoué ne refait rien.
  if v_archivee is not null then
    return 'archivee';
  end if;

  -- Libre tant que personne ne l'a reçue. `personnel` et `entite` sont tous
  -- deux « chez le client ». `partage` a franchi la frontière du cabinet :
  -- son accord, ou son retour — une pièce retournée est rendue au client.
  if v_vis = 'partage'
     and v_status <> 'retournee'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id = p_piece and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- Les versions précédentes ne s'effacent jamais : elles s'archivent.
  with recursive versions(id) as (
    select r.piece_id from capture.remplacements r where r.remplacee_par = p_piece
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  )
  update capture.pieces
     set archivee_le = now(), updated_at = now()
   where id in (select id from versions) and archivee_le is null;

  -- Une proposition jamais inscrite part avec la pièce.
  perform app.piece_oublie_ses_propositions(p_piece);

  -- Une écriture a existé — contre-passée, puisqu'aucune n'est vivante : la
  -- pièce la justifie au journal. Archivée : le client ne la voit plus, le
  -- cabinet la garde.
  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece) then
    update capture.pieces set archivee_le = now(), updated_at = now() where id = p_piece;

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.archivee', 'capture', 'pieces', p_piece,
            jsonb_build_object('vis', v_vis, 'status', v_status, 'par_accord', p_par_accord));

    if v_vis = 'partage' and not p_par_accord then
      insert into collab.notifications (tenant_id, kind, payload)
      values (v_tenant, 'piece.archivee', jsonb_build_object('piece_id', p_piece));
    end if;
    return 'archivee';
  end if;

  -- Une pièce qui nourrit une recette de lecture publiée ou évaluée en garde
  -- la provenance : elle ne s'efface pas. Le dire ici, en clair, plutôt que
  -- laisser la cascade buter sur R7 (audit du 27 octobre 2026).
  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id = p_piece
          and (exists (select 1 from fabrique.recette_version_exemples r where r.exemple_id = x.id)
               or exists (select 1 from fabrique.evaluation_exemples v where v.exemple_id = x.id)))
  then
    raise exception 'refus.suppression.exemple_de_recette' using errcode = 'check_violation';
  end if;

  -- La trace survit à la pièce. `audit.event_log` porte `object_id` sans clé
  -- étrangère : ce qui a existé reste dit, même quand l'objet n'est plus là.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord));

  -- Le cabinet avait reçu la pièce : il apprend que le client l'a retirée.
  if v_vis = 'partage' and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;

  perform set_config('malica.piece_effacable', p_piece::text, true);
  delete from capture.pieces where id = p_piece;
  perform set_config('malica.piece_effacable', '', true);
  perform set_config('malica.paiements_effacables', '', true);

  return 'supprimee';
end;$fn$;

revoke all on function public.capture_piece_supprimer(uuid, boolean) from public, anon;
grant execute on function public.capture_piece_supprimer(uuid, boolean) to authenticated;

-- Repris de `20261025223000` : la porte rend désormais ce qu'elle a fait. Une
-- pièce qui accompagne n'a pas d'écriture, elle est effacée ; le booléen dit
-- « effacée », pour que l'API sache si les octets partent.
create or replace function public.piece_qui_accompagne_supprimer(p_piece uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := app.piece_qui_accompagne_garde(p_piece, true);

  insert into capture.paiement_justificatifs (tenant_id, paiement_id, piece_id, fait)
  select v_tenant, r, null, 'detache' from app.reglements_prouves_par(p_piece) r;

  return public.capture_piece_supprimer(p_piece, false) = 'supprimee';
end
$$;

-- --- 5f. Où va la pièce ------------------------------------------------------------------------
--
-- Repris de `20261022320000`. Ce qui change :
--   * une pièce RETOURNÉE quitte le cabinet sans accord (garder, la remettre
--     à la société) ; son retour est clos, ses propositions oubliées, et le
--     cabinet en est prévenu ;
--   * ce qui est issu d'une pièce qui quitte le cabinet la suit — la règle
--     vivait dans `piece_repondre` seul, elle vaut pour toute sortie.

create or replace function public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_rendue boolean := false;
  v_derive record;
begin
  select tenant_id, vis, status, created_by
    into v_tenant, v_old, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  -- Une pièce qui justifie une écriture ne va pas en espace personnel, d'où
  -- qu'elle vienne (recette du 20 octobre 2026 : depuis `entite`, elle y
  -- allait). Comptabilisée par le statut, ou par une écriture vivante.
  if p_vis = 'personnel'::app.vis_t
     and (v_status in ('comptabilisee','supervisee')
          or exists (select 1 from socle.ecritures e
                      where e.piece_id = p_piece and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'une piece comptabilisee reste dans la societe' using errcode = 'check_violation';
  end if;

  -- Défaut de paiement : la garde vit sur la table (déclencheur
  -- `une_piece_transmise_exige_une_licence_active`, à l'insertion ET au
  -- passage en `partage`) — une seule règle, écrite une fois.

  -- Quitter `partage`, c'est retirer au cabinet ce qu'il a reçu : sur son
  -- accord, ou parce qu'il l'a lui-même retournée au client.
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    v_rendue := v_status = 'retournee';
    -- L'accord se dérive de la donnée, pas d'un drapeau.
    if not v_rendue and not app.accord_donne(p_piece, 'rappel') then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Après la capture, sortir une pièce de la société relève du propriétaire.
  if p_vis = 'personnel'::app.vis_t
     and v_old = 'entite'::app.vis_t
     and not app.has_org_role(v_tenant, array['dirigeant'])
  then
    raise exception 'sortir une piece de la societe releve du proprietaire'
      using errcode = 'check_violation';
  end if;

  -- Le retour est clos : la pièce n'est plus chez le cabinet, ce qu'il avait
  -- proposé sur elle n'a plus d'objet.
  if v_rendue then
    perform app.piece_oublie_ses_propositions(p_piece);
  end if;

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- La décision de la garder est à reprendre.
         gardee_le = null,
         status = case when v_rendue then app.statut_hors_retour(p_piece) else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  -- Ce qui est issu de la pièce (reçu, justificatif) n'est jamais partagé si
  -- elle ne l'est pas : il la suit hors du cabinet. Une pièce dérivée
  -- comptabilisée, si elle existait, resterait.
  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id = p_piece
         and vis = 'partage'::app.vis_t
         and status not in ('comptabilisee', 'supervisee')
      returning id
    loop
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', v_derive.id,
              jsonb_build_object('from', 'partage', 'to', p_vis,
                                 'par_accord', p_par_accord, 'suit_la_source', p_piece));
    end loop;
  end if;

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.a_valider',
            jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  -- Le client garde ce que le cabinet lui avait retourné : le cabinet le sait.
  if v_rendue and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.gardee', jsonb_build_object('piece_id', p_piece, 'vis', p_vis));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

-- --- 5g. Garder ---------------------------------------------------------------------------------
--
-- Repris de `20261012100000`. Une pièce que le cabinet a retournée se garde
-- sans rien demander : elle va dans l'espace de son auteur, par la porte de
-- la visibilité (qui prévient le cabinet). Une pièce transmise et non
-- retournée, elle, ne revient toujours que par accord.

create or replace function public.capture_piece_garder(p_piece uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_deja timestamptz;
begin
  select tenant_id, vis, status, gardee_le into v_tenant, v_vis, v_status, v_deja
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if v_vis = 'partage'::app.vis_t then
    if v_status = 'retournee' then
      return public.capture_piece_set_vis(p_piece, 'personnel'::app.vis_t);
    end if;
    -- Le chemin du retour existe, et il passe par l'accord du cabinet. Sans ce
    -- refus, un bouton « garder » contournerait la seule règle qui en exige un.
    raise exception 'une piece transmise ne revient que par accord du cabinet'
      using errcode = 'check_violation';
  end if;

  -- Le doigt ripe, l'écran revient : la date de la décision est celle du jour
  -- où elle a été prise, pas celle du dernier tap.
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

-- --- 5h. Le cabinet tranche une demande --------------------------------------------------------
--
-- Repris de `20261025231000`. Un rappel accordé rend la pièce à la SOCIÉTÉ
-- (`entite`), jamais à un espace privé : de là, plus rien ne la sortait. Ce
-- qui en est issu la suit par `capture_piece_set_vis`, qui en porte la règle.

create or replace function public.piece_repondre(p_piece uuid, p_objet text, p_accorde boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_dernier text;
begin
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if v_tenant not in (select app.engaged_orgs()) then
    raise exception 'seul le cabinet sous mandat tranche une demande sur une piece'
      using errcode = '42501';
  end if;

  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet
   order by d.created_at desc limit 1;
  if v_dernier is distinct from 'demandee' then
    raise exception 'aucune demande en attente sur cette piece'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid());

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                             'note', p_note));

  if p_accorde then
    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t, true);

      -- La suppression demandée n'a plus d'objet : la pièce est revenue à la
      -- société, qui l'efface elle-même. On inscrit le fait qui clôt la
      -- demande — la ligne « demandee » reste, R7.
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid()
       where (select d.fait from collab.demandes_sur_piece d
               where d.piece_id = p_piece and d.objet = 'suppression'
               order by d.created_at desc limit 1) = 'demandee';
    elsif p_objet = 'suppression' then
      -- `collab.demandes_sur_piece` cascade depuis la pièce ; ce qui survit est
      -- la ligne `piece.supprimee` de `audit.event_log` et la notification.
      -- Une écriture contre-passée la retient : elle est archivée.
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

-- --- 5i. Une demande qui ne pourrait pas aboutir est refusée DÈS la demande ----------------------
--
-- Repris de `20261011160000`. Une pièce prise en charge (écriture vivante) ne
-- se rappelle ni ne se supprime par accord : le cabinet la retourne d'abord
-- (contre-passation), puis elle se supprime ou se garde sans rien demander.
-- La contre-passation par accord n'est pas faite ici : la demande est refusée
-- avec ce qu'il faut faire, au lieu d'être accordée puis impossible.

create or replace function public.piece_demander(p_piece uuid, p_objet text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_dernier text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Une pièce qu'on n'a pas envoyée se reprend sans demander : il n'y a
  -- personne à qui demander, et exiger un accord inexistant bloquerait le
  -- dirigeant chez lui.
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'cette piece n''est pas partagee : rien a demander'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id = p_piece and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception '%', case when p_objet = 'rappel' then 'refus.rappel.inscrite'
                              else 'refus.suppression.inscrite' end
      using errcode = 'check_violation';
  end if;

  -- Deux demandes identiques en attente ne valent pas mieux qu'une, et la
  -- file du cabinet se remplirait de doublons.
  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet
   order by d.created_at desc limit 1;
  if v_dernier = 'demandee' then
    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', true);
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur)
  values (v_tenant, p_piece, p_objet, 'demandee', auth.uid());

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet));

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', false);
end
$$;

commit;
