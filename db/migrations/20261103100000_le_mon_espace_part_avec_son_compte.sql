-- Son Mon espace part avec son compte (« Malica sans blocage », lot 4).
--
-- Un siège qui quitte la société y laisse ses pièces de la société ; son Mon
-- espace reste lisible de lui seul (`20261103090000`). Il manquait le reste :
-- le voir hors de la société, le supprimer (la porte exigeait l'adhésion :
-- « piece introuvable »), et la garantie qu'il n'entre jamais dans une
-- société dont il n'est plus membre (la RLS d'écriture filtrait la ligne en
-- silence, et l'écran croyait la pièce déplacée).
--
-- Ce que ce fichier pose :
--   1. `public.mon_espace_hors_societe()` : ses pièces privées des sociétés
--      qu'il a quittées, avec le nom de la société.
--   2. `capture_piece_supprimer` : l'auteur d'une pièce privée la supprime,
--      même hors de la société (repris de `20261103090000`).

begin;

-- --- 1. Ce qu'il voit, hors de la société --------------------------------------------------------

create or replace function public.mon_espace_hors_societe()
returns table (
  id           uuid,
  tenant_id    uuid,
  societe      text,
  created_at   timestamptz,
  content_type text,
  document_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Ses pièces privées, et seulement celles des sociétés dont il n'est plus
  -- membre : celles d'une société où il est encore se lisent dans la société.
  select p.id, p.tenant_id, o.name, p.created_at, p.content_type, p.document_kind
    from capture.pieces p
    join identity.organizations o on o.id = p.tenant_id
   where auth.uid() is not null
     and p.created_by = auth.uid()
     and p.vis = 'personnel'::app.vis_t
     and p.archivee_le is null
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
     and p.tenant_id not in (select app.member_orgs())
   order by p.created_at desc
$$;

revoke all on function public.mon_espace_hors_societe() from public, anon;
grant execute on function public.mon_espace_hors_societe() to authenticated;

-- --- 2. Il le supprime ---------------------------------------------------------------------------

create or replace function public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vis      text;
  v_status   text;
  v_tenant   uuid;
  v_archivee timestamptz;
  v_version  uuid;
  v_auteur   uuid;
  v_prevenir uuid;
begin
  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;

  select p.vis::text, p.status, p.tenant_id, p.archivee_le, p.created_by
    into v_vis, v_status, v_tenant, v_archivee, v_auteur
    from capture.pieces p where p.id = p_piece;

  if v_vis is null then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- Son Mon espace part avec son compte : l'auteur d'une pièce privée la
  -- supprime, même hors de la société qu'il a quittée.
  if v_tenant not in (select app.member_orgs())
     and not (v_vis = 'personnel' and v_auteur is not distinct from auth.uid()
              and v_auteur is not null)
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  if v_tenant in (select app.member_orgs()) then
    -- Ce qu'on ne lit pas n'existe pas pour soi.
    if not app.piece_lisible(p_piece) then
      raise exception 'piece introuvable' using errcode = 'no_data_found';
    end if;
    if v_vis = 'personnel' and v_auteur is distinct from auth.uid() then
      raise exception 'piece introuvable' using errcode = 'no_data_found';
    end if;
    if v_vis <> 'personnel' and v_auteur is distinct from auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes') then
      raise exception 'refus.suppression.pas_la_sienne' using errcode = '42501';
    end if;
    if v_vis = 'entite' and v_auteur = auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes')
       and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'envoyee' then
      raise exception 'refus.suppression.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
    -- Le propriétaire retire la pièce d'un autre : l'auteur le saura. Sur
    -- l'accord de sa demande, la réponse le lui dit déjà.
    if v_auteur is distinct from auth.uid() and not p_par_accord then
      v_prevenir := v_auteur;
    end if;
  end if;

  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  if v_archivee is not null then
    return 'archivee';
  end if;

  if v_vis = 'partage'
     and v_status <> 'retournee'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from immo.assets a
              where a.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from stocks.mouvements m
                 where m.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from identity.fiches_fiscales f
                 where f.piece_id in (select app.versions_de_la_piece(p_piece)))
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  perform app.piece_oublie_ses_propositions(v.id)
     from app.versions_de_la_piece(p_piece) v(id);

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.status = 'booked') then
    update capture.pieces set archivee_le = now(), updated_at = now()
     where id in (select app.versions_de_la_piece(p_piece)) and archivee_le is null;
    perform app.les_issues_suivent_l_archive(p_piece);

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.archivee', 'capture', 'pieces', p_piece,
            jsonb_build_object('vis', v_vis, 'status', v_status, 'par_accord', p_par_accord));

    if v_vis = 'partage' and not p_par_accord then
      insert into collab.notifications (tenant_id, kind, payload)
      values (v_tenant, 'piece.archivee', jsonb_build_object('piece_id', p_piece));
    end if;
    if v_prevenir is not null then
      insert into collab.notifications (tenant_id, user_id, kind, payload)
      values (v_tenant, v_prevenir, 'piece.supprimee_par_le_proprietaire',
              jsonb_build_object('piece_id', p_piece,
                                 'par', app.prenom_au_moment(auth.uid()), 'archivee', true));
    end if;
    return 'archivee';
  end if;

  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id in (select app.versions_de_la_piece(p_piece))
          and (exists (select 1 from fabrique.recette_version_exemples r where r.exemple_id = x.id)
               or exists (select 1 from fabrique.evaluation_exemples v where v.exemple_id = x.id)))
  then
    raise exception 'refus.suppression.exemple_de_recette' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord,
                             'versions', (select jsonb_agg(v)
                                            from app.versions_de_la_piece(p_piece) v
                                           where v <> p_piece)));

  if v_vis = 'partage' and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;
  -- L'auteur apprend que sa pièce a été retirée par un propriétaire. La
  -- notification lui est adressée : elle survit à la pièce.
  if v_prevenir is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_prevenir, 'piece.supprimee_par_le_proprietaire',
            jsonb_build_object('piece_id', p_piece, 'par', app.prenom_au_moment(auth.uid())));
  end if;

  for v_version in
    with recursive suite(id, rang) as (
      select p_piece, 0
      union all
      select r.piece_id, s.rang + 1
        from capture.remplacements r join suite s on r.remplacee_par = s.id
    )
    select id from suite order by rang
  loop
    perform set_config('malica.piece_effacable', v_version::text, true);
    delete from capture.pieces where id = v_version;
  end loop;
  perform set_config('malica.piece_effacable', '', true);
  perform set_config('malica.paiements_effacables', '', true);

  return 'supprimee';
end
$$;

commit;
