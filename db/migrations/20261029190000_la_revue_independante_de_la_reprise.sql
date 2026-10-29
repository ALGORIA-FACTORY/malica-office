-- La revue indépendante de #127 (29 octobre 2026) : cinq P2, huit P3.
--
-- La règle reste une : « une version précédente se lit à travers sa version
-- courante », et rien de nouveau ne s'écrit sur elle. Ce qui suit la mène au
-- bout là où elle s'arrêtait.
--
--  1. Lecture. `lecture_autorisee` laissait lire A remplacée : le modèle payant
--     était appelé, la persistance échouait (A est gelée) et le travail se
--     rejouait jusqu'à épuisement. Refus définitif `piece_remplacee`, avant le
--     modèle ; le travail de lecture d'une pièce remplacée se DÉDUIT refusé
--     (`fabrique.etat_des_travaux_v`) — l'état d'un travail se déduit de la
--     base (20261020120000), il ne s'écrit pas : une panne en attente de repli
--     n'est pas « prenable », on ne pourrait pas y inscrire de prise pour la
--     clore. Les octets de A arrivés après la reprise : refus nommé
--     `refus.piece.remplacee` au scellement (la route rend 410).
--  2. Suppression. Supprimer la courante sans écriture inscrite sur la chaîne
--     emporte TOUTES ses versions, comme une pièce jamais reprise ; avec une
--     écriture inscrite sur la chaîne, toutes s'archivent. Plus de version
--     précédente archivée « parce que le cabinet l'a connue » alors que la
--     courante, gardée dans la société, lui était fermée.
--  3. Verrous. Une seule règle : la chaîne se verrouille dans l'ordre des
--     identifiants — l'inscription (pièce de l'écriture ET sa courante), la
--     suppression et la réponse à une demande (toute la chaîne), la reprise
--     (ancienne et nouvelle, déjà). Une reprise ou une suppression attend une
--     inscription en cours, puis la voit.
--  4. Le retour d'une version précédente ne se lit plus : seule la courante
--     porte le retour (`piece_retour`).
--  5. Une reprise impossible se dit par un code de reprise :
--     `refus.remplacement.introuvable` quand l'ancienne n'est plus là.
--  6. Un fait nouveau sur une version gelée : un règlement est REDIRIGÉ vers la
--     courante (c'est la même facture ; la file hors ligne peut porter un
--     identifiant d'avant la reprise, et « rien ne bloque ») — une annulation,
--     elle, reste sur la pièce du règlement qu'elle annule ; un reçu issu
--     d'une version précédente l'est de la courante ; et les tables qui ne
--     doivent plus rien recevoir sur une version gelée le refusent.
--  8. Le scellement ne prend jamais une version de la même pièce, ni une
--     version remplacée, pour l'original d'un doublon.
--  9. Le cabinet ne lit un remplacement que s'il lit la photo qui remplace.
-- 10. `pieces_v` expose la version courante : A → B → C mène de A à C.
-- 11. La preuve « rattachement » ne compte une nouvelle photo que si le geste
--     demandé était de reprendre la photo.
-- 13. La photo reprise reste celle de l'auteur de l'ancienne (la pièce d'un
--     siège reprise par le dirigeant reste au siège) ; qui l'a reprise est au
--     registre (`capture.remplacements.auteur`).

-- ============================================================ 1. LA LECTURE

create or replace function public.lecture_autorisee(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Une version précédente ne se lit plus : sa lecture ne s'inscrirait nulle
  -- part (elle est gelée), et le modèle serait payé pour rien. Refus définitif.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_remplacee',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà lue ne reçoit pas de seconde lecture : le dire ICI, avant
  -- le modèle, et non après l'avoir payé. Avant les licences : le refus ne
  -- dépend ni du forfait ni du plafond.
  if exists (select 1 from capture.extractions where piece_id = p_piece) then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_deja_lue',
      'restantes', null, 'droit', null);
  end if;

  return public.lecture_verdict(p_piece);
end
$$;

create or replace view fabrique.etat_des_travaux_v with (security_invoker = true) as
with livres as (
  select distinct on (s.code) s.code, s.value_num
    from ref.socle_params s
   where s.code like 'fabrique.seuil.travail.%'
     and s.valid_from <= current_date
     and (s.valid_to is null or s.valid_to >= current_date)
   order by s.code, s.valid_from desc
)
select t.id                              as travail_id,
       t.tenant_id,
       t.piece_id,
       t.nature,
       t.priorite,
       t.demande_le,
       coalesce(c.tentatives, 0)::smallint as tentatives,
       b.tentatives_max,
       d.nature                          as dernier_fait,
       d.motif                           as dernier_motif,
       d.inscrit_le                      as dernier_le,
       e.etat,
       e.prenable_a,
       (e.prenable_a is not null and e.prenable_a <= now()) as prenable
  from fabrique.travaux t
  left join lateral (
    select f.nature, f.motif, f.tentative, f.inscrit_le
      from fabrique.travail_faits f
     where f.travail_id = t.id
     order by f.ordre desc
     limit 1
  ) d on true
  left join lateral (
    select count(*) filter (where f.nature = 'pris') as tentatives
      from fabrique.travail_faits f
     where f.travail_id = t.id
  ) c on true
  cross join lateral (
    select
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.tentatives_max') as tentatives_max,
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.abandon_s')      as abandon_s,
      max(coalesce(o.value_num, l.value_num))
        filter (where l.code = 'fabrique.seuil.travail.repli_s')        as repli_s
      from livres l
      left join parametrage.fabrique_seuils o
        on o.tenant_id = t.tenant_id and o.code = l.code
  ) b
  cross join lateral (
    -- L'ORDRE DE CES BRANCHES EST LA REGLE, et il se lit de haut en bas.
    select case
      when d.nature = 'termine'             then 'termine'
      -- Une pièce remplacée ne se lit plus (`lecture_autorisee`) : son travail
      -- est refusé, quel que soit le dernier fait — rien ne le reprend.
      when exists (select 1 from capture.remplacements r where r.piece_id = t.piece_id)
                                            then 'refuse'
      when d.nature is null                 then 'a_faire'
      when d.nature = 'refus_metier'        then 'refuse'
      when d.nature = 'erreur_technique'    then 'en_erreur'
      -- Une prise encore fraiche : quelqu'un travaille.
      when d.nature = 'pris'
       and now() <= d.inscrit_le + make_interval(secs => b.abandon_s::double precision) then 'en_cours'
      -- Au-dela, le preneur est repute mort. Reste a savoir s'il reste des
      -- tentatives : la borne passe avant la reprise.
      when coalesce(c.tentatives, 0) >= b.tentatives_max then 'epuise'
      when d.nature = 'pris'                then 'abandonne'
      else                                       'en_panne'
    end as etat
  ) e0
  cross join lateral (
    select e0.etat,
           case e0.etat
             when 'a_faire'   then t.demande_le
             when 'abandonne' then d.inscrit_le + make_interval(secs => b.abandon_s::double precision)
             when 'en_panne'  then d.inscrit_le + make_interval(secs => b.repli_s::double precision)
             else null
           end as prenable_a
  ) e;

comment on view fabrique.etat_des_travaux_v is
  'Ou en est chaque travail, d''apres ses faits : a_faire, en_cours, '
  'abandonne, en_panne, epuise, termine, refuse, en_erreur. Le travail d''une '
  'piece remplacee est refuse : sa lecture ne s''inscrirait nulle part. Une '
  'borne absente du referentiel rend « prenable » faux — elle refuse, elle ne '
  'devine pas ; la fonction de prise, elle, leve et le dit.';

create or replace function public.capture_sceller_empreinte(p_piece uuid, p_sha256 text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v record;
  v_original uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'empreinte invalide' using errcode = '22023';
  end if;
  select id, tenant_id, sha256, doublon_de into v
    from capture.pieces where id = p_piece for update;
  if v.id is null then
    raise exception 'pièce introuvable' using errcode = 'P0002';
  end if;

  -- Remplacée pendant que ses octets voyageaient (file hors ligne) : ils
  -- arrivent trop tard, et le disent — ni « scellée », ni panne.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Déjà scellée : même contenu, rien à faire ; autre contenu, refus.
  if v.sha256 is not null then
    if v.sha256 <> p_sha256 then
      raise exception 'Le contenu de cette pièce est scellé : il ne se remplace pas.'
        using errcode = '23514';
    end if;
    return jsonb_build_object('sha256', v.sha256, 'doublonDe', null, 'etat', 'deja_scellee');
  end if;
  if v.doublon_de is not null then
    return jsonb_build_object('sha256', p_sha256, 'doublonDe', v.doublon_de, 'etat', 'doublon');
  end if;

  -- L'original d'un doublon n'est jamais une version de la même pièce, ni une
  -- version remplacée : la même règle que la détection à l'analyse.
  select p.id into v_original
    from capture.pieces p
   where p.tenant_id = v.tenant_id and p.sha256 = p_sha256 and p.id <> p_piece
     and p.id not in (select app.versions_de_la_piece(p_piece))
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
   limit 1;

  if v_original is not null then
    update capture.pieces set doublon_de = v_original where id = p_piece;
  else
    begin
      update capture.pieces set sha256 = p_sha256 where id = p_piece;
    exception when unique_violation then
      -- L'empreinte est déjà tenue — par une pièce que l'appelant ne voit pas,
      -- ou par une version de cette pièce : on ne la nomme pas.
      return jsonb_build_object('sha256', p_sha256, 'doublonDe', null, 'etat', 'non_scellee');
    end;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v.tenant_id, auth.uid(), 'piece.recue', 'capture', 'pieces', p_piece,
          jsonb_build_object('sha256', p_sha256, 'doublonDe', v_original));

  return jsonb_build_object('sha256', p_sha256, 'doublonDe', v_original,
                            'etat', case when v_original is null then 'scellee' else 'doublon' end);
end
$$;

-- ============================================================ 2. LA SUPPRESSION

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
begin
  -- Toute la chaîne, dans l'ordre des identifiants : le même ordre que
  -- l'inscription (`socle_ecriture_book`) — l'une attend l'autre, sans
  -- interblocage.
  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;

  select p.vis::text, p.status, p.tenant_id, p.archivee_le
    into v_vis, v_status, v_tenant, v_archivee
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

  -- Une version précédente ne se retire pas seule : c'est la photo qui l'a
  -- remplacée qui se supprime, et elle l'emporte avec elle.
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

  -- La pièce, c'est toutes ses versions : une seule qui justifie un bien, un
  -- mouvement de stock ou une fiche fiscale la retient toute.
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

  -- Une proposition jamais inscrite part avec la pièce — de chaque version.
  perform app.piece_oublie_ses_propositions(v.id)
     from app.versions_de_la_piece(p_piece) v(id);

  -- Une écriture a existé sur la chaîne — contre-passée, puisqu'aucune n'est
  -- vivante : la pièce la justifie au journal. Toutes ses versions
  -- s'archivent : le client ne les voit plus, le cabinet les garde.
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
    return 'archivee';
  end if;

  -- Une pièce qui nourrit une recette de lecture publiée ou évaluée en garde
  -- la provenance : elle ne s'efface pas. Le dire ici, en clair, plutôt que
  -- laisser la cascade buter sur R7 (audit du 27 octobre 2026).
  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id in (select app.versions_de_la_piece(p_piece))
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
                             'par_accord', p_par_accord,
                             'versions', (select jsonb_agg(v)
                                            from app.versions_de_la_piece(p_piece) v
                                           where v <> p_piece)));

  -- Le cabinet avait reçu la pièce : il apprend que le client l'a retirée.
  if v_vis = 'partage' and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;

  -- Sans écriture sur la chaîne, la pièce part tout entière, comme une pièce
  -- jamais reprise : de la courante à la plus ancienne, chacune emportant le
  -- fait qui la liait à la suivante. Rien ne reste au cabinet, ni ailleurs.
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

-- ============================================================ 3. LES VERROUS

create or replace function public.socle_ecriture_book(p_ecriture uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_nature  text;
  v_paiement uuid;
  v_reverses uuid;
  v_dossier uuid;
begin
  select piece_id into v_piece from socle.ecritures where id = p_ecriture;
  -- La pièce de l'écriture ET sa version courante — celle que le contrôle R2
  -- juge —, dans l'ordre des identifiants : une reprise ou une suppression de
  -- la courante attend cette inscription, puis la voit.
  if v_piece is not null then
    perform 1 from capture.pieces
     where id in (v_piece, app.version_courante(v_piece)) order by id for update;
  end if;

  select e.nature, e.paiement_id, e.reverses_id, e.tenant_id
    into v_nature, v_paiement, v_reverses, v_dossier
    from socle.ecritures e where e.id = p_ecriture and e.status = 'proposee';

  -- L'annulation d'un règlement, dans un dossier confié à une comptabilité,
  -- est inscrite par l'expert mandaté, et par lui seul (revue du 24 octobre
  -- 2026) : la PME ne touche pas au grand livre qu'elle a confié.
  if v_nature = 'reglement' and v_reverses is not null
     and exists (select 1 from identity.engagements g
                  where g.pme_org_id = v_dossier and g.status = 'actif')
     and v_dossier not in (select app.engaged_orgs_as_expert()) then
    raise exception 'L''annulation d''un règlement est inscrite par l''expert mandaté.'
      using errcode = '42501', hint = 'reglement.annulation_expert';
  end if;
  -- Une contre-passation éteint l'écriture vivante : elle ne la double pas.
  if v_nature is not null and v_piece is not null and v_reverses is null and exists (
       select 1 from socle.ecritures o
        where o.piece_id = v_piece and o.id <> p_ecriture
          and o.nature = v_nature and o.paiement_id is not distinct from v_paiement
          and app.ecriture_vivante(o.id)) then
    raise exception 'Cette pièce porte déjà une écriture inscrite : une seconde la compterait deux fois.'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  update socle.ecritures
     set status = 'booked',
         booked_by = auth.uid(),
         booked_at = now(),
         updated_at = now()
   where id = p_ecriture and status = 'proposee'
  returning tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'ecriture introuvable, deja comptabilisee ou non autorisee'
      using errcode = '42501';
  end if;

  -- Un règlement inscrit ne fait pas repasser une facture supervisée en
  -- « comptabilisée » : seule l'écriture de la facture fait le statut.
  if v_nature = 'piece' then
    update capture.pieces
       set status = 'comptabilisee', updated_at = now()
     where id = v_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece, 'nature', v_nature,
                             'paiement_id', v_paiement));
end
$$;

create or replace function public.piece_repondre(p_piece uuid, p_objet text, p_accorde boolean,
                                                 p_note text default null)
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

  -- Toute la chaîne, dans l'ordre des identifiants : un accord de suppression
  -- l'emporte toute (`capture_piece_supprimer`), et l'inscription d'un
  -- règlement hérité tient les mêmes lignes dans le même ordre.
  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
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

-- ============================================================ 4, 11. LE RETOUR

create or replace function public.piece_retour(p_piece uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Une version précédente ne porte plus de retour : c'est sa courante qui le
  -- porte, avec le même motif, la même note et la même preuve.
  with recursive p as (
    select id, tenant_id, status from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
       and not exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
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
          -- Une nouvelle photo ne prouve que ce qu'on a demandé : la reprendre.
          -- Elle ne joint pas le document qui manque.
          or (m.geste = 'reprendre_photo' and exists (
          select 1 from capture.remplacements r join versions v on v.id = r.remplacee_par
           where r.created_at > (select decided_at from c)))
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

-- ============================================================ 5, 13. LA REPRISE

create or replace function public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  -- déjà envoyée (`une_piece_transmise_exige_une_licence_active` le lit).
  perform set_config('malica.remplacement', p_nouvelle::text, true);
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
$$;

-- ============================================================ 6. LES FAITS NOUVEAUX

create or replace function capture.un_reglement_dit_vrai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttc  bigint;
  v_paye bigint;
  v_courante uuid;
  v_versions uuid[];
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes, et elle
  -- reste sur la pièce du règlement qu'elle annule.
  if new.annule_paiement_id is not null then
    return new;
  end if;

  -- La pièce appartient au dossier inscrit : la politique d'insertion vérifie
  -- le dossier, pas la pièce, et cette fonction lit (et éteint) au-delà de la
  -- RLS de l'appelant (revue Codex de #101).
  if not exists (select 1 from capture.pieces x
                  where x.id = new.piece_id and x.tenant_id = new.tenant_id) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  v_courante := app.version_courante(new.piece_id);
  select array_agg(v) into v_versions from app.versions_de_la_piece(new.piece_id) v;

  -- Un règlement nouveau ne s'inscrit pas sur une version gelée : c'est la
  -- même facture, il va à sa version courante — avec son établissement et son
  -- côté. La file hors ligne peut porter un identifiant d'avant la reprise ;
  -- la refuser ferait perdre un règlement réel (« rien ne bloque »).
  if new.piece_id <> v_courante then
    select c.id, c.entity_id, c.vis into new.piece_id, new.entity_id, new.vis
      from capture.pieces c where c.id = v_courante;
  end if;

  -- Une seule inscription à la fois par pièce — toutes versions : deux appuis
  -- simultanés, sur l'ancienne et la nouvelle photo, ne passent pas tous deux
  -- la règle du dépassement.
  perform pg_advisory_xact_lock(hashtextextended(v_courante::text, 0));

  if new.moyen_code = 'non_paye' then
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code <> 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_regle' using errcode = 'check_violation';
    end if;
    if exists (select 1 from capture.paiements p
                where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                  and p.moyen_code = 'non_paye'
                  and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
      raise exception 'paiement.deja_non_paye' using errcode = 'check_violation';
    end if;
    new.montant_mineur := null;
    new.paye_le := null;
    return new;
  end if;

  v_ttc := capture.ttc_mineur(v_courante);
  -- Ce qui est DÉJÀ éteint : la dette qu'éteint chaque règlement (retenue à la
  -- source comprise, `app.dette_eteinte`), sinon son montant (revue Codex).
  select coalesce(sum(coalesce(
           round(app.dette_eteinte(p.id) * power(10, d.exposant))::bigint,
           p.montant_mineur)), 0) into v_paye
    from capture.paiements p
    join ref.devises d on d.code = p.devise
   where p.piece_id = any (v_versions) and p.annule_paiement_id is null
     and p.moyen_code <> 'non_paye'
     and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id);

  if new.montant_mineur is null then
    if v_ttc is null then
      raise exception 'paiement.montant_requis' using errcode = 'check_violation';
    end if;
    new.montant_mineur := v_ttc - v_paye;
    if new.montant_mineur <= 0 then
      raise exception 'paiement.deja_solde' using errcode = 'check_violation';
    end if;
  end if;

  if new.montant_mineur <= 0 then
    raise exception 'paiement.montant_positif' using errcode = 'check_violation';
  end if;

  if v_ttc is not null and v_paye + new.montant_mineur > v_ttc then
    raise exception 'paiement.depasse_le_total' using errcode = 'check_violation';
  end if;

  if new.paye_le is null then
    new.paye_le := current_date;
  end if;
  if new.paye_le > current_date + 1 then
    raise exception 'paiement.date_future' using errcode = 'check_violation';
  end if;

  if exists (select 1 from capture.paiements p
              where p.piece_id = any (v_versions) and p.annule_paiement_id is null
                and p.moyen_code = new.moyen_code
                and p.montant_mineur = new.montant_mineur
                and p.paye_le is not distinct from new.paye_le
                and p.created_at > now() - interval '10 seconds'
                and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id)) then
    raise exception 'paiement.en_double' using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create or replace function public.capture_piece_register(p_tenant uuid, p_source text, p_storage_path text,
                                                         p_idempotency_key text, p_entity uuid default null,
                                                         p_vis app.vis_t default 'partage'::app.vis_t,
                                                         p_sha256 text default null,
                                                         p_page_count smallint default null,
                                                         p_document_kind text default null,
                                                         p_source_piece uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_source uuid;
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
    -- Une pièce issue d'une version précédente l'est de sa version courante :
    -- rien de nouveau ne s'accroche à une version gelée, et le côté est celui
    -- de la courante.
    select id, tenant_id, vis into v_source, v_tenant_source, v_vis_source
      from capture.pieces where id = app.version_courante(p_source_piece);
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
            when v_source is not null then 'confirme'
            else 'a_confirmer'
          end,
          v_source)
  on conflict (tenant_id, idempotency_key) do update
     set updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'piece.captured', 'capture', 'pieces', v_id,
          jsonb_build_object('source', p_source, 'document_kind', p_document_kind,
                             'source_piece_id', v_source));

  return v_id;
end
$$;

-- Rien de nouveau ne s'écrit sur une version gelée. Le déclencheur
-- `pas_de_geste_sur_une_version_precedente` (20261029120000) couvrait les
-- gestes ; il couvre aussi ce qui se tire d'une pièce :
--   capture.analyses        une analyse se recalcule sur la lecture courante ;
--   capture.piece_articles  la projection des articles se refait sur la courante ;
--   identity.fiches_fiscales, immo.assets, stocks.mouvements
--                           un justificatif se rattache à la pièce telle qu'elle
--                           est, pas à une photo remplacée.
-- Laissés dehors, et pourquoi :
--   capture.extractions, token_plan, citations, piece_versions — n'ont qu'un
--     écrivain, `capture_read_persist`, qui met la pièce à jour dans la même
--     transaction et bute déjà sur le gel (`une_version_precedente_ne_bouge_plus`) ;
--   capture.paiements — un règlement nouveau va à la courante (ci-dessus) ;
--     une annulation reste sur la pièce du règlement qu'elle annule ;
--   capture.paiement_justificatifs, recu_paiements — leur `piece_id` est la
--     preuve ou le reçu, pas la facture remplacée ;
--   socle.ecritures — son propre déclencheur (`ecritures_0_une_piece_retiree…`)
--     refuse l'écriture d'une facture sur une version précédente ; un règlement
--     hérité, lui, s'inscrit sur sa pièce (le fait) ;
--   fabrique.travaux — se déduit refusé (ci-dessus) ;
--   fabrique.exemples — un exemple de recette est une lecture passée, il ne
--     fait rien de la pièce.
do $$
declare
  t text;
begin
  foreach t in array array['capture.analyses', 'capture.piece_articles',
                           'identity.fiches_fiscales', 'immo.assets', 'stocks.mouvements']
  loop
    execute format('drop trigger if exists pas_de_geste_sur_une_version_precedente on %s', t);
    execute format('create trigger pas_de_geste_sur_une_version_precedente
                      before insert on %s
                      for each row execute function app.pas_de_geste_sur_une_version_precedente()', t);
  end loop;
end $$;

-- ============================================================ 9. LA POLITIQUE
--
-- Le remplacement ne se lit plus que si la photo qui remplace se lit. Mais la
-- politique de `capture.pieces` demandait « cette pièce est-elle remplacée ? »
-- à `capture.remplacements` SOUS la RLS de l'appelant : un remplacement caché
-- l'aurait fait retomber sur la règle de la pièce elle-même — et le cabinet
-- aurait relu une version précédente partagée dont la courante est gardée.
-- La question se pose donc à une fonction qui voit le registre entier, et
-- qui ne rend qu'un booléen sur une pièce déjà nommée.

create or replace function app.piece_remplacee(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
$$;

revoke all on function app.piece_remplacee(uuid) from public, anon;
grant execute on function app.piece_remplacee(uuid) to authenticated;

drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (case
           -- Une version précédente se lit à travers sa version courante.
           when app.piece_remplacee(id) then app.piece_lisible(id)
           else (((archivee_le is null)
                  and (((vis = 'personnel'::app.vis_t) and (created_by = auth.uid()))
                       or ((vis = 'entite'::app.vis_t) and (tenant_id in (select app.member_orgs())))
                       or ((vis = 'partage'::app.vis_t)
                           and ((tenant_id in (select app.member_orgs()))
                                or (tenant_id in (select app.engaged_orgs()))))))
                 or ((archivee_le is not null)
                     and (tenant_id in (select app.engaged_orgs()))
                     and app.piece_connue_du_cabinet(id))
                 or app.plateforme_requise(tenant_id))
         end);

drop policy if exists capture_remplacements_sel on capture.remplacements;
create policy capture_remplacements_sel on capture.remplacements
  for select to authenticated
  using (((tenant_id in (select app.member_orgs()))
          or (tenant_id in (select app.engaged_orgs()))
          or app.plateforme_requise(tenant_id))
         -- Le remplacement se lit si la photo qui remplace se lit : le cabinet
         -- n'apprend rien d'une photo gardée dans la société.
         and app.piece_lisible(remplacee_par));

-- ============================================================ 10. LA VERSION COURANTE

create or replace view public.pieces_v with (security_invoker = true) as
select p.id, p.tenant_id, p.entity_id, p.vis, p.source, p.storage_path, p.sha256,
       p.page_count, p.status, p.idempotency_key, p.created_by, p.created_at,
       p.updated_at, p.content_type, p.document_kind, p.document_kind_statut,
       p.transmise_le, p.gardee_le, p.source_piece_id, p.archivee_le,
       (select r.remplacee_par from capture.remplacements r where r.piece_id = p.id) as remplacee_par,
       (select r.piece_id from capture.remplacements r where r.remplacee_par = p.id) as remplace,
       -- La photo qui fait foi : elle-même, ou la dernière de sa chaîne. Un lien
       -- vers une version précédente mène là en un geste, même au bout de A → B → C.
       case when exists (select 1 from capture.remplacements r where r.piece_id = p.id)
            then app.version_courante(p.id) else p.id end as version_courante
  from capture.pieces p;
