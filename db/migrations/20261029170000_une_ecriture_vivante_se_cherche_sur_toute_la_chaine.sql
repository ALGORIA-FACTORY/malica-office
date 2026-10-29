-- Une écriture vivante se cherche sur TOUTE la chaîne des versions.
--
-- Revue Codex de #127 : un règlement saisi sur A, A remplacé par B, le
-- règlement hérité inscrit — son écriture vit sur A (le fait), le statut de B
-- ne bouge pas (seule l'écriture de la facture le fait avancer). Toute garde
-- « écriture inscrite / vivante / engagée » qui ne regardait que B laissait
-- supprimer B, la retourner, la remplacer, demander son rappel… alors qu'une
-- écriture vivante la porte.
--
-- La pièce, c'est toutes ses versions (`app.versions_de_la_piece`) : chaque
-- garde, et chaque lecture qui suit la pièce, regarde les écritures de toutes.
-- Les faits (piece_id des écritures) ne bougent pas.

CREATE OR REPLACE FUNCTION public.piece_demander(p_piece uuid, p_objet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
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
$function$
;

CREATE OR REPLACE FUNCTION public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
                      where e.piece_id in (select app.versions_de_la_piece(p_piece))
                        and e.status = 'booked'
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
  -- accord, ou parce qu'il l'a lui-même retournée au client — vers la SOCIÉTÉ
  -- seulement : une pièce retournée ne part jamais dans un espace privé
  -- (décision du 28 octobre 2026).
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    v_rendue := v_status = 'retournee' and p_vis = 'entite'::app.vis_t;
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
  --
  -- La pièce, c'est toutes ses versions : les reçus de CHACUNE la suivent. Ses
  -- photos précédentes, elles, n'ont rien à suivre — elles se lisent à travers
  -- la photo courante (`app.piece_lisible`).
  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id in (select app.versions_de_la_piece(p_piece))
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
$function$
;

CREATE OR REPLACE FUNCTION public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_pack   uuid;
  v_note_requise boolean;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Le second regard revient à l'expert ou au collaborateur du cabinet engagé.
  if not exists (
       select 1
         from identity.engagements e
         join identity.memberships m on m.tenant_id = e.cabinet_org_id
        where e.pme_org_id = v_tenant and e.status = 'actif'
          and m.user_id = auth.uid() and m.role in ('expert', 'collaborateur')) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Le statut peut retarder sur les écritures : on lit aussi les écritures.
  if v_status not in ('lue', 'proposee', 'confirmee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  -- Un motif retiré du référentiel ne se choisit plus.
  select requires_note into v_note_requise
    from ref.rejet_motifs where id = p_motif and active;
  if v_note_requise is null then
    raise exception 'motif inconnu' using errcode = 'check_violation';
  end if;
  if v_note_requise and coalesce(btrim(p_note), '') = '' then
    raise exception 'ce motif exige une note' using errcode = 'check_violation';
  end if;

  select a.pack_version_id into v_pack
    from capture.analyses a where a.piece_id = p_piece order by a.created_at desc limit 1;
  if v_pack is null then
    select jp.id into v_pack
      from ref.jurisdiction_packs jp
      join identity.organizations o on o.jurisdiction = jp.jurisdiction
     where o.id = v_tenant and jp.effective_from <= current_date
     order by jp.effective_from desc limit 1;
  end if;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, p_piece, 'a_corriger'::app.verdict_t, p_motif, nullif(btrim(p_note), ''),
          v_pack, auth.uid());

  update capture.pieces set status = 'retournee', updated_at = now() where id = p_piece;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.retournee',
          jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                             'note', nullif(btrim(p_note), '')));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.retournee', 'capture', 'pieces', p_piece, p_motif, v_pack,
          jsonb_build_object('note', nullif(btrim(p_note), ''), 'sans_ecriture', true));

  return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif);
end
$function$
;

CREATE OR REPLACE FUNCTION public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Une version précédente ne se retire pas seule : c'est la photo qui l'a
  -- remplacée qui se supprime, et elle l'emporte aux archives si elle le doit.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
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
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
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

  -- Les versions précédentes ne s'effacent jamais. Celles que le cabinet a
  -- connues (partagées, ou justifiant une écriture inscrite) s'archivent,
  -- chez lui ; les autres restent au client, et redeviennent sa pièce quand
  -- la photo qui les remplaçait part.
  with recursive versions(id) as (
    select r.piece_id from capture.remplacements r where r.remplacee_par = p_piece
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  )
  update capture.pieces
     set archivee_le = now(), updated_at = now()
   where id in (select id from versions) and archivee_le is null
     and app.piece_connue_du_cabinet(id);
  perform app.les_issues_suivent_l_archive(p_piece);

  -- Une proposition jamais inscrite part avec la pièce.
  perform app.piece_oublie_ses_propositions(p_piece);

  -- Une écriture a existé — contre-passée, puisqu'aucune n'est vivante : la
  -- pièce la justifie au journal. Archivée : le client ne la voit plus, le
  -- cabinet la garde.
  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.status = 'booked') then
    update capture.pieces set archivee_le = now(), updated_at = now() where id = p_piece;
    perform app.les_issues_suivent_l_archive(p_piece);

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
end;$function$
;

CREATE OR REPLACE FUNCTION app.piece_connue_du_cabinet(p_piece uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from capture.pieces p
     where p.id = p_piece
       and (p.vis = 'partage'::app.vis_t
            or p.transmise_le is not null
            or exists (select 1 from socle.ecritures e
                        where e.piece_id in (select app.versions_de_la_piece(p.id))
                          and e.status = 'booked')))
$function$
;

CREATE OR REPLACE FUNCTION app.la_piece_transmet_ce_qu_elle_porte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.vis is distinct from old.vis then
    update socle.ecritures
       set vis = new.vis, updated_at = now()
     where piece_id in (select app.versions_de_la_piece(new.id))
       and reverses_id is null
       and vis is distinct from new.vis
       and (new.vis = 'partage'::app.vis_t or status = 'proposee');
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.banque_book_lignes(p_tenant uuid, p_prefix text, p_from date, p_to date)
 RETURNS TABLE(ecriture_id uuid, piece_id uuid, date_ecriture date, journal text, libelle text, montant numeric, reference text, lettree boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select e.id, e.piece_id, e.date_ecriture, e.journal, e.libelle,
         sum(l.debit - l.credit) as montant,
         -- La référence relevée sur le document — un numéro de facture d'abord —, ou rien.
         (select r.valeur
            from capture.extractions x
            cross join lateral jsonb_each_text(coalesce(x.payload -> 'references', '{}'::jsonb))
                 as r(cle, valeur)
           where x.piece_id = app.version_courante(e.piece_id) and x.contract = 'extract.v1'
             and length(btrim(r.valeur)) > 0
           order by x.created_at desc,
                    (r.cle ~* 'invoice|facture|numero|number') desc,
                    r.cle
           limit 1) as reference,
         exists (select 1 from banque.lettrage_etat t
                  where t.ecriture_id = e.id and t.active) as lettree
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
   where e.tenant_id = p_tenant
     and e.status = 'booked'
     and e.date_ecriture between p_from and p_to
     and l.account_code like p_prefix || '%'
   group by e.id, e.piece_id, e.date_ecriture, e.journal, e.libelle
   order by e.date_ecriture, e.id
$function$
;

CREATE OR REPLACE FUNCTION public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
  n record;
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

  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  -- La nouvelle hérite du partage de l'ancienne : ce n'est pas une nouvelle
  -- transmission, et un impayé ne doit pas empêcher de corriger une pièce
  -- déjà envoyée (`une_piece_transmise_exige_une_licence_active` le lit).
  perform set_config('malica.remplacement', p_nouvelle::text, true);
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
  perform set_config('malica.remplacement', '', true);

  -- Les documents rattachés à l'ancienne ne se recopient pas : `rattachements_v`
  -- les lit à travers la version courante.

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
$function$
;

