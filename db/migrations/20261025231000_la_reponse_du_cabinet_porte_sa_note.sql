-- La réponse du cabinet porte sa note jusqu'à la PME (25 octobre 2026).
--
-- ================================================================ LE DÉFAUT
--
-- Audit du 25 octobre 2026. Le cabinet refuse un rappel et écrit pourquoi —
-- la base EXIGE cette note. Mais la notification posée chez la PME ne
-- portait que l'objet et le verdict : l'écran ne pouvait dire que « Votre
-- comptabilité a répondu… », sans dire quoi ni pourquoi. La note, écrite pour
-- la PME, ne quittait pas le journal des demandes.
--
-- La notification porte désormais la note, comme `piece.retournee` porte la
-- sienne. Rien d'autre ne change.
--
-- Corps repris de la base vivante (`20261025200000`) ; seul le `payload` de
-- la notification `piece.demande_tranchee` s'allonge de `note`.

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
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                             'note', p_note));

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
