-- Un rappel accordé clôt la demande de suppression ; un reçu suit sa pièce
-- (25 octobre 2026).
--
-- ============================================================ DEUX DÉFAUTS
--
-- 1. Une PME demande la suppression d'une pièce transmise, puis son rappel.
--    Le cabinet accorde le rappel : la pièce revient au privé, et la PME peut
--    l'effacer elle-même. Mais la demande de suppression restait « demandée » :
--    l'écran de la PME disait « Suppression demandée. Votre comptabilité doit
--    l'accorder. » sur une pièce que plus personne n'avait à accorder.
--
--    Les demandes sont une suite de faits (R7) : on n'efface pas la ligne
--    « demandee », on inscrit le fait qui la clôt. Un nouveau fait,
--    « retiree » : la demande n'a plus d'objet. Ce n'est ni un accord ni un
--    refus — le cabinet n'a pas tranché la suppression, et le dire serait faux.
--
--    Seule la base l'inscrit (`piece_repondre`, `security definer`) : la
--    politique d'écriture n'est PAS élargie, aucun compte ne l'écrit en direct.
--
-- 2. Un reçu généré aujourd'hui depuis une pièce PRIVÉE est né « partage » :
--    la visibilité venait de l'écran, qui l'avait reçue en cache. Le cabinet
--    voyait le reçu d'une facture qu'on ne lui avait pas transmise.
--
--    La visibilité d'une pièce dérivée ne se déclare plus : elle se lit sur la
--    pièce source, dans la porte de création. Et quand la source revient au
--    privé par un rappel accordé, ce qui en est issu revient avec elle.

-- --- 1. Le fait « retiree » ---------------------------------------------------------------

alter table collab.demandes_sur_piece
  drop constraint if exists demandes_sur_piece_fait_check;
alter table collab.demandes_sur_piece
  add constraint demandes_sur_piece_fait_check
  check (fait in ('demandee', 'accordee', 'refusee', 'retiree'));

comment on column collab.demandes_sur_piece.fait is
  'Le fait inscrit : demandee, accordee, refusee, ou retiree — la demande n''a '
  'plus d''objet (la pièce est revenue au privé par un rappel accordé). L''état '
  'courant d''une demande est son dernier fait (R7).';

-- --- 2. La porte de création lit la visibilité de la source -------------------------------
--
-- Corps repris de la base vivante (`20261013200000`) ; seule la visibilité
-- d'une pièce dérivée change.

create or replace function public.capture_piece_register(
  p_tenant uuid,
  p_source text,
  p_storage_path text,
  p_idempotency_key text,
  p_entity uuid default null,
  p_vis app.vis_t default 'partage',
  p_sha256 text default null,
  p_page_count smallint default null,
  p_document_kind text default null,
  p_source_piece uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant_source uuid;
  v_vis_source app.vis_t;
  v_vis app.vis_t := p_vis;
begin
  if p_document_kind is not null
     and not exists (select 1 from ref.document_types d where d.code = p_document_kind) then
    raise exception 'type de document inconnu au referentiel : %', p_document_kind
      using errcode = 'foreign_key_violation';
  end if;

  -- La pièce source doit être du MÊME dossier. Sinon le lien pointerait hors
  -- du dossier et la RLS rendrait un reçu orphelin sans dire pourquoi.
  if p_source_piece is not null then
    select tenant_id, vis into v_tenant_source, v_vis_source
      from capture.pieces where id = p_source_piece;
    if v_tenant_source is null or v_tenant_source <> p_tenant then
      raise exception 'piece source introuvable ou non autorisee dans ce dossier'
        using errcode = '42501';
    end if;
    -- Une pièce dérivée a la visibilité de sa source, quoi qu'on déclare :
    -- jamais partagée si sa source ne l'est pas.
    v_vis := v_vis_source;
  end if;

  insert into capture.pieces (tenant_id, entity_id, vis, source, storage_path,
                              sha256, page_count, idempotency_key,
                              document_kind, document_kind_statut, source_piece_id)
  values (p_tenant, p_entity, v_vis, p_source, p_storage_path,
          p_sha256, p_page_count, p_idempotency_key,
          p_document_kind,
          -- Sans type déclaré : à déterminer, la lecture tranchera.
          -- Type déclaré sur une pièce DÉRIVÉE : confirmé — Malica l'a faite.
          -- Type déclaré sur une pièce autonome : à confirmer, la lecture a
          -- le dernier mot.
          case
            when p_document_kind is null then 'a_determiner'
            when p_source_piece is not null then 'confirme'
            else 'a_confirmer'
          end,
          p_source_piece)
  on conflict (tenant_id, idempotency_key) do update
     set updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
          jsonb_build_object('source', p_source, 'document_kind', p_document_kind,
                             'source_piece_id', p_source_piece));

  return v_id;
end
$$;

revoke all on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text, uuid)
  from public, anon;
grant execute on function public.capture_piece_register(uuid, text, text, text, uuid, app.vis_t, text, smallint, text, uuid)
  to authenticated;

-- --- 3. Le rappel accordé clôt la suppression et ramène ce qui en est issu ----------------
--
-- Corps repris de la base vivante (`20261011160000` et suivantes) ; seul le
-- bloc du rappel accordé s'allonge.

create or replace function public.piece_repondre(
  p_piece uuid, p_objet text, p_accorde boolean, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_dernier text;
  v_derive  record;
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
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde));

  if p_accorde then
    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'personnel'::app.vis_t, true);

      -- La suppression demandée n'a plus d'objet : la pièce est privée, la
      -- PME l'efface elle-même. On inscrit le fait qui clôt la demande — la
      -- ligne « demandee » reste, R7.
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid()
       where (select d.fait from collab.demandes_sur_piece d
               where d.piece_id = p_piece and d.objet = 'suppression'
               order by d.created_at desc limit 1) = 'demandee';

      -- Ce qui est issu de la pièce (reçu, justificatif) n'est jamais
      -- partagé si elle ne l'est pas : il revient avec elle. Un reçu ne porte
      -- pas d'écriture ; une pièce dérivée comptabilisée, si elle existait,
      -- resterait — la même règle que `capture_piece_set_vis`.
      for v_derive in
        update capture.pieces
           set vis = 'personnel'::app.vis_t,
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
                jsonb_build_object('from', 'partage', 'to', 'personnel',
                                   'par_accord', true, 'suit_la_source', p_piece));
      end loop;
    elsif p_objet = 'suppression' then
      -- `collab.demandes_sur_piece` cascade depuis la pièce ; ce qui survit est
      -- la ligne `piece.supprimee` de `audit.event_log` et la notification.
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

revoke all on function public.piece_repondre(uuid, text, boolean, text) from public, anon;
grant execute on function public.piece_repondre(uuid, text, boolean, text) to authenticated;

-- --- 4. Régularisation de l'existant -----------------------------------------------------
--
-- Une non-conformité se régularise, elle ne se laisse pas en place.
--
-- a) Les demandes de suppression restées « demandee » sur une pièce qui
--    n'est plus partagée : on inscrit le fait qui les clôt.
insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
select d.tenant_id, d.piece_id, 'suppression', 'retiree', null, null
  from (select distinct on (piece_id) tenant_id, piece_id, fait
          from collab.demandes_sur_piece
         where objet = 'suppression'
         order by piece_id, created_at desc) d
  join capture.pieces p on p.id = d.piece_id
 where d.fait = 'demandee'
   and p.vis <> 'partage'::app.vis_t;

-- b) Les pièces dérivées partagées alors que leur source ne l'est pas. Seul
--    ce sens est corrigé : rendre privé ce qui n'aurait jamais dû partir.
--    Seulement celles NÉES partagées (l'écran passait `partage` à la
--    génération) : une pièce que la PME a choisi de transmettre ensuite porte
--    un `piece.vis_changed` vers `partage`, et elle ne revient que par accord
--    du cabinet — la régularisation ne passe pas outre.
--    L'autre sens (source partagée, reçu privé) est un choix possible de la
--    PME, et partager à sa place serait une transmission qu'elle n'a pas faite.
with corrigees as (
  update capture.pieces r
     set vis = s.vis,
         transmise_le = null,
         gardee_le = null,
         updated_at = now()
    from capture.pieces s
   where s.id = r.source_piece_id
     and r.vis = 'partage'::app.vis_t
     and s.vis <> 'partage'::app.vis_t
     and r.status not in ('comptabilisee', 'supervisee')
     and not exists (select 1 from audit.event_log e
                      where e.object_id = r.id
                        and e.action = 'piece.vis_changed'
                        and e.payload ->> 'to' = 'partage')
  returning r.id, r.tenant_id, r.created_by, s.vis as vis_source, s.id as source_id
)
insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                             object_id, payload)
-- `actor` est obligatoire et aucune session n'en porte pendant une migration :
-- l'auteur de la pièce régularisée tient la ligne (le staging a refusé `null`).
select tenant_id, created_by, 'piece.vis_changed', 'capture', 'pieces', id,
       jsonb_build_object('from', 'partage', 'to', vis_source,
                          'suit_la_source', source_id,
                          'regularisation', '20261025200000')
  from corrigees;
