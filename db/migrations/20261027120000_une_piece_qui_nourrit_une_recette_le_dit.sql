-- Une pièce qui nourrit une recette de lecture le dit, au lieu de buter sur R7.
--
-- Audit de la base du 27 octobre 2026 : une pièce dont un exemple est cité par
-- une version de recette ou une évaluation ne peut pas être effacée — la
-- provenance d'une recette promue ne disparaît pas (`20261027090000`). Mais
-- `capture_piece_supprimer` ne le vérifiait pas : la cascade butait sur le
-- garde strict des tables de la fabrique, et l'utilisateur recevait
-- « R7 : DELETE interdit sur fabrique.recette_version_exemples ».
--
-- La fonction est reprise de sa dernière version, avec un seul ajout : ce cas
-- est refusé en clair, par une clé du dictionnaire, avant toute trace.

create or replace function public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vis    text;
  v_status text;
  v_tenant uuid;
begin
  select p.vis::text, p.status, p.tenant_id
    into v_vis, v_status, v_tenant
    from capture.pieces p where p.id = p_piece;

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

  -- Libre tant que personne ne l'a reçue. `personnel` et `entite` sont tous
  -- deux « chez le client » : la seconde a seulement quitté le compte de son
  -- auteur pour la société, et la société a le droit de défaire ce qu'elle a
  -- fait. Seule `partage` a franchi la frontière du cabinet.
  -- Le drapeau ne suffit pas : l'accord se DÉRIVE de la donnée (section 17).
  if v_vis = 'partage'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status not in ('capturee', 'lue') then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece)
     or exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
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

  perform set_config('malica.piece_effacable', p_piece::text, true);
  delete from capture.pieces where id = p_piece;
  perform set_config('malica.piece_effacable', '', true);
  perform set_config('malica.paiements_effacables', '', true);

  return true;
end;$fn$;
