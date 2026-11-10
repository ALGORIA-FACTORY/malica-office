-- Le motif d'une réponse se nettoie et se borne.
--
-- Audit du 10 novembre 2026, exécuté contre l'API : un refus portant un motif de
-- 100 000 caractères était accepté et stocké (puis recopié dans les
-- notifications, que R7 interdit d'effacer), et un motif entouré d'espaces était
-- gardé tel quel. Un motif vide ou fait d'espaces n'était arrêté que par une
-- contrainte, dont la violation remontait en erreur brute sans message.
--
--   * `app.motif_longueur_max()` : UNE valeur, lue par la contrainte, par la
--     porte et par un test qui la compare à celle de l'écran ;
--   * `piece_repondre` nettoie la note (trim, vide devient null), exige un motif
--     pour un refus et le borne, avec deux clés `refus.*` dites en fr, en et ar ;
--   * la contrainte est posée `not valid` : elle vaut pour toute écriture à
--     venir et ne réécrit rien (R7) — une note plus ancienne et plus longue reste.
-- Corps de `piece_repondre` repris tel qu'en base (20261125120000) ; seules
-- les premières lignes changent.

begin;

create or replace function app.motif_longueur_max()
returns integer
language sql
immutable
set search_path to ''
as $$ select 1000 $$;
revoke all on function app.motif_longueur_max() from public, anon;
grant execute on function app.motif_longueur_max() to authenticated;

alter table collab.demandes_sur_piece
  add constraint demandes_note_bornee
  check (note is null or length(note) <= app.motif_longueur_max()) not valid;

CREATE OR REPLACE FUNCTION public.piece_repondre(p_piece uuid, p_objet text, p_accorde boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_auteur  uuid;
  v_dernier record;
  v_demandeur uuid;
  v_relayee boolean := false;
  v_vivante uuid;
begin
  -- Le motif se nettoie et se borne ICI, avant toute écriture : une note de
  -- plusieurs Mo était acceptée (audit du 10 novembre 2026), recopiée dans les
  -- notifications, et R7 interdit de l'effacer ensuite.
  p_note := nullif(btrim(p_note), '');
  if p_accorde is not null and not p_accorde and p_note is null then
    raise exception 'refus.piece.motif_requis' using errcode = 'check_violation';
  end if;
  if length(p_note) > app.motif_longueur_max() then
    raise exception 'refus.piece.motif_trop_long' using errcode = 'check_violation';
  end if;

  if p_accorde is null then
    raise exception 'refus.reponse.sans_decision' using errcode = 'check_violation';
  end if;
  if not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;
  select tenant_id, vis, created_by into v_tenant, v_vis, v_auteur
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- Le propriétaire tranche la demande d'un siège. Un membre de la société
  -- ne tranche rien d'autre : la demande faite au cabinet n'est pas à lui (nul
  -- ne tranche sa propre demande).
  -- LE RÔLE SE CHOISIT PAR L'ÉTAPE QUI ATTEND (recette du 2 novembre 2026).
  -- Une personne à la fois membre de la société ET du cabinet mandaté (un
  -- dirigeant qui tient aussi le cabinet) entrait toujours ici, et la
  -- demande faite au cabinet lui était refusée « réservée au cabinet
  -- mandaté ». La branche du propriétaire ne vaut que si une demande attend
  -- le propriétaire, ou si la personne n'est pas du cabinet mandaté.
  if v_tenant in (select app.member_orgs())
     and ((select d.fait from app.derniere_demande(p_piece, p_objet, 'proprietaire') d)
            = 'demandee'
          or v_tenant not in (select app.engaged_orgs())) then
    select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'proprietaire');
    if v_dernier.fait is distinct from 'demandee' then
      raise exception 'refus.reserve.cabinet_mandate'
        using errcode = '42501';
    end if;
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') then
      raise exception 'refus.reserve.proprietaire'
        using errcode = '42501';
    end if;
    v_demandeur := v_dernier.auteur;

    -- Accordée sur une pièce chez le comptable, la demande y part : un fait.
    v_relayee := p_accorde and v_vis = 'partage'::app.vis_t;
    insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape,
                                           transmise)
    values (v_tenant, p_piece, p_objet,
            case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(),
            'proprietaire', v_relayee);

    if v_relayee then
      -- Chez le comptable : la demande part d'elle-même, au nom du propriétaire.
      if (select d.fait from app.derniere_demande(p_piece, p_objet, 'cabinet') d)
         is distinct from 'demandee' then
        -- Après l'accord, dans la même transaction : l'heure de l'horloge, pas
        -- celle de la transaction, pour que la suite des faits garde son ordre.
        insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape,
                                               created_at)
        values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), 'cabinet', clock_timestamp());
        insert into collab.notifications (tenant_id, kind, payload)
        values (v_tenant, 'piece.demande',
                jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
      end if;
    elsif p_accorde and p_objet = 'rappel' then
      -- Rendue au siège, dans la société : à envoyer de nouveau.
      insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
      values (v_tenant, p_piece, 'rappelee', auth.uid(), app.prenom_au_moment(auth.uid()));
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'proprietaire'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'proprietaire') d)
             = 'demandee';
    end if;

    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_demandeur, 'piece.demande_tranchee',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note, 'chez', 'proprietaire',
                               'transmise', v_relayee));

    if p_accorde and p_objet = 'suppression' and not v_relayee then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;

    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                              'transmise', v_relayee);
  end if;

  -- Le comptable : repris de `20261029100000`, sur les demandes qui lui sont faites.
  if v_tenant not in (select app.engaged_orgs()) then
    raise exception 'refus.reserve.cabinet_mandate'
      using errcode = '42501';
  end if;

  select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'cabinet');
  if v_dernier.fait is distinct from 'demandee' then
    raise exception 'refus.piece.aucune_demande'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(), 'cabinet');

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                             'note', p_note));

  -- La demande venait d'un siège, que son propriétaire a fait partir ici : il
  -- apprend la réponse. L'état par étape le dit (`transmise`).
  select e.demandeur into v_demandeur
    from app.etat_des_demandes(p_piece) e
   where e.objet = p_objet and e.etape = 'proprietaire' and e.transmise;
  if v_demandeur is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_demandeur, 'piece.demande_tranchee',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note));
  end if;

  if p_accorde then
    -- Prise en charge : son écriture se contre-passe au journal du jour, puis
    -- la pièce revient ou s'archive (spec §3).
    select e.id into v_vivante
      from socle.ecritures e
     where e.piece_id in (select app.versions_de_la_piece(p_piece))
       and e.nature = 'piece'
       and app.ecriture_vivante(e.id)
     limit 1;
    if v_vivante is not null then
      perform public.socle_ecriture_contre_passer(
        v_vivante, (select m.id from ref.rejet_motifs m where m.code = 'retrait_accorde'));
      update capture.pieces
         set status = app.statut_hors_retour(p_piece), updated_at = now()
       where id = p_piece;
    end if;

    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t, true);
      -- Rendue à la société ; la pièce d'un siège lui revient « à envoyer ».
      if v_demandeur is not null then
        insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
        values (v_tenant, p_piece, 'rappelee', auth.uid(), app.nom_au_moment(auth.uid()));
      end if;
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'cabinet'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'cabinet') d)
             = 'demandee';
    elsif p_objet = 'suppression' then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$function$;

commit;
