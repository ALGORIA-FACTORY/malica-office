-- La chaîne des versions, partout (revue Codex de #127, 29 octobre 2026).
--
-- Une photo reprise est la MÊME pièce. Trois endroits raisonnaient encore sur
-- une seule ligne de `capture.pieces`, et la reprise les trompait :
--   1. la garde d'un règlement (`un_reglement_dit_vrai`) ignorait ce qui était
--      payé sur l'ancienne photo : « tout payé » réinscrivait le total, un
--      montant pouvait dépasser le total cumulé — et son verrou ne
--      sérialisait pas deux versions entre elles ;
--   2. un reçu produit depuis la nouvelle photo écartait en silence les
--      règlements saisis sur l'ancienne (`recu_attester_paiements`) ;
--   3. « Garder » la nouvelle photo laissait l'ancienne et ses reçus partagés,
--      lisibles par le cabinet.
-- Et, cherchés ensuite : le « pas encore payé » éteint par un règlement sur
-- une autre version, la mère d'un justificatif et ses règlements candidats,
-- le déplacement d'un justificatif, et ce qui est issu d'une pièce archivée.
--
-- Les faits d'avant ne bougent pas (R7) : ils se LISENT par la chaîne
-- (`app.versions_de_la_piece`, `app.version_courante`). Seule la visibilité
-- d'une version précédente suit encore la pièce, par la porte de la
-- visibilité.

begin;

-- --- La seule chose qu'une version précédente suit encore : sa visibilité ---------------------
--
-- Repris de `20261029120000` : en plus de l'archive, la visibilité, quand
-- `capture_piece_set_vis` la propage (`malica.suit_la_version`).

create or replace function app.une_version_precedente_ne_bouge_plus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from capture.remplacements r where r.piece_id = old.id) then
    if tg_op = 'UPDATE'
       and to_jsonb(new) - 'archivee_le' - 'updated_at'
         = to_jsonb(old) - 'archivee_le' - 'updated_at' then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and coalesce(current_setting('malica.suit_la_version', true), '') = 'on'
       and to_jsonb(new) - 'vis' - 'transmise_le' - 'gardee_le' - 'updated_at'
         = to_jsonb(old) - 'vis' - 'transmise_le' - 'gardee_le' - 'updated_at' then
      return new;
    end if;
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- --- Ce qui est issu d'une pièce archivée la suit aux archives ---------------------------------
--
-- Un reçu, un justificatif d'une version partie aux archives : archivés eux
-- aussi, sous la même règle — seulement ce que le cabinet a connu ; le reste
-- demeure au client.

create or replace function app.les_issues_suivent_l_archive(p_piece uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update capture.pieces d
     set archivee_le = now(), updated_at = now()
   where d.archivee_le is null
     and d.source_piece_id in (select app.versions_de_la_piece(p_piece))
     and exists (select 1 from capture.pieces s
                  where s.id = d.source_piece_id and s.archivee_le is not null)
     and app.piece_connue_du_cabinet(d.id)
$$;

revoke all on function app.les_issues_suivent_l_archive(uuid) from public, anon;

-- --- La garde d'un règlement lit toute la chaîne ------------------------------------------
--
-- Repris de `20261025160000` : les règlements déjà inscrits, le « pas encore
-- payé », le doublon et le verrou se lisent sur TOUTES les versions de la
-- pièce, et le TTC sur la photo courante. Après une reprise, 60 payés sur
-- l'ancienne photo d'une facture de 100 laissaient « tout payé » inscrire 100
-- sur la nouvelle. Les faits d'avant restent où ils sont nés.

create or replace function capture.un_reglement_dit_vrai()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ttc  bigint;
  v_paye bigint;
  v_courante uuid;
  v_versions uuid[];
begin
  -- Une annulation n'est pas un règlement : elle a ses propres gardes.
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
$function$;

-- --- Le « pas encore payé » s'éteint depuis toute version --------------------------------------

create or replace function capture.un_reglement_eteint_le_non_paye()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.annule_paiement_id is not null or new.moyen_code = 'non_paye' then
    return null;
  end if;
  insert into capture.paiements
    (tenant_id, entity_id, vis, piece_id, moyen_code, pack_version_id,
     montant_mineur, devise, paye_le, annule_paiement_id, annulation_motif_id)
  select p.tenant_id, p.entity_id, p.vis, p.piece_id, p.moyen_code, p.pack_version_id,
         p.montant_mineur, p.devise, p.paye_le, p.id,
         (select m.id from ref.paiement_motifs_annulation m where m.code = 'regle_depuis')
    from capture.paiements p
   where p.piece_id in (select app.versions_de_la_piece(new.piece_id)) and p.tenant_id = new.tenant_id
     and p.annule_paiement_id is null
     and p.moyen_code = 'non_paye'
     and not exists (select 1 from capture.paiements a where a.annule_paiement_id = p.id);
  return null;
end
$function$;

-- --- Un reçu atteste les règlements de toute la chaîne de sa source ----------------------------

create or replace function public.recu_attester_paiements(p_recu uuid, p_paiements uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_source uuid;
  v_kind   text;
  v_n      integer;
begin
  select tenant_id, source_piece_id, document_kind into v_tenant, v_source, v_kind
    from capture.pieces where id = p_recu;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_kind is distinct from 'recu_de_paiement' or v_source is null then
    raise exception 'seul un reçu issu d''une pièce atteste des règlements'
      using errcode = '22023';
  end if;

  -- Chaque règlement est un règlement RÉEL de la pièce dont le reçu est issu :
  -- ni une annulation, ni « pas encore payé », ni le règlement d'une autre.
  -- Un identifiant qui ne l'est pas (règlement disparu entre la production
  -- du reçu et son envoi depuis la file hors ligne) est écarté et tracé :
  -- lever ici bloquerait le reçu dans la file pour toujours.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  select v_tenant, auth.uid(), 'recu.reglement_ecarte', 'capture', 'pieces', p_recu,
         jsonb_build_object('paiement', x.id)
    from unnest(p_paiements) as x(id)
   where not exists (select 1 from capture.paiements p
                      where p.id = x.id and p.piece_id in (select app.versions_de_la_piece(v_source))
                        and p.tenant_id = v_tenant
                        and p.annule_paiement_id is null
                        and p.montant_mineur is not null);

  insert into capture.recu_paiements (tenant_id, piece_id, paiement_id)
  select v_tenant, p_recu, x.id from unnest(p_paiements) as x(id)
   where exists (select 1 from capture.paiements p
                  where p.id = x.id and p.piece_id in (select app.versions_de_la_piece(v_source))
                    and p.tenant_id = v_tenant
                    and p.annule_paiement_id is null
                    and p.montant_mineur is not null)
  on conflict (tenant_id, piece_id, paiement_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

-- --- La mère d'un justificatif, et ses candidats : la photo courante ----------------------------

create or replace function public.piece_qui_accompagne(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_piece      capture.pieces;
  v_genre      text;
  v_mere       uuid;
  v_reglements uuid[];
  v_mere_json  jsonb;
  v_regl_json  jsonb;
  v_annulation jsonb;
  v_candidats  jsonb := '[]'::jsonb;
begin
  select * into v_piece from capture.pieces where id = p_piece;
  if v_piece.id is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not app.piece_accompagne(p_piece) then
    return null;
  end if;

  select coalesce(array_agg(r), '{}') into v_reglements from app.reglements_prouves_par(p_piece) r;

  v_genre := case
    when v_piece.document_kind = 'recu_de_paiement' then 'recu'
    when cardinality(v_reglements) > 0 or v_piece.document_kind = 'justificatif_paiement'
      then 'justificatif'
    -- Une pièce née d'une autre, sans type et sans règlement : les reçus
    -- produits avant que le type ne soit déclaré.
    when v_piece.source_piece_id is not null then 'recu'
    else 'justificatif'
  end;

  if v_genre = 'recu' then
    select coalesce(array_agg(rp.paiement_id), '{}') into v_reglements
      from capture.recu_paiements rp where rp.piece_id = p_piece;
    v_mere := v_piece.source_piece_id;
  else
    -- Le justificatif suit son règlement : sa pièce est la mère.
    v_mere := coalesce(
      (select p.piece_id from capture.paiements p where p.id = any (v_reglements)
        order by p.created_at limit 1),
      v_piece.source_piece_id);
  end if;
  -- La mère, c'est sa photo courante : un règlement saisi sur une photo
  -- reprise mène à celle qui l'a remplacée (revue Codex de #127).
  v_mere := app.version_courante(v_mere);

  select jsonb_build_object(
           'id', m.id,
           'typeDeDocument', coalesce(m.document_kind, x.payload ->> 'document_kind'),
           'emetteur', x.payload ->> 'issuer',
           'date', x.payload ->> 'document_date',
           'ttc', x.payload #>> '{totals,ttc}',
           'devise', x.payload ->> 'currency')
    into v_mere_json
    from capture.pieces m
    left join lateral (
      select e.payload from public.extractions_v e
       where e.piece_id = m.id and e.contract like 'extract.v1%'
       order by e.created_at desc limit 1
    ) x on true
   where m.id = v_mere;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'moyenCode', v.moyen_code,
           'montantMineur', v.montant_mineur,
           'devise', v.devise,
           'payeLe', v.paye_le,
           'eteint', v.eteint) order by v.paye_le, v.created_at), '[]'::jsonb)
    into v_regl_json
    from public.paiements_v v
   where v.id = any (v_reglements);

  -- La première extinction : le règlement d'origine annulé, sa date et son motif.
  select jsonb_build_object(
           'paiementId', v.id,
           'le', a.created_at,
           'motifCode', m.code)
    into v_annulation
    from public.paiements_v v
    join capture.paiements a on a.annule_paiement_id = v.id
    join ref.paiement_motifs_annulation m on m.id = a.annulation_motif_id
   where v.id = any (v_reglements)
   order by a.created_at
   limit 1;

  if v_genre = 'justificatif' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'moyenCode', c.moyen_code,
             'montantMineur', c.montant_mineur,
             'devise', c.devise,
             'payeLe', c.paye_le,
             'pieceId', c.piece_id,
             'tiers', c.tiers) order by c.paye_le desc, c.created_at desc), '[]'::jsonb)
      into v_candidats
      from (
        -- La facture d'un règlement candidat : sa photo courante — son tiers,
        -- son côté du cabinet, et le lien de l'écran.
        select v.id, v.moyen_code, v.montant_mineur, v.devise, v.paye_le, f.id as piece_id,
               v.created_at,
               (select e.payload ->> 'issuer' from public.extractions_v e
                 where e.piece_id = f.id and e.contract like 'extract.v1%'
                 order by e.created_at desc limit 1) as tiers
          from public.paiements_v v
          join capture.pieces f on f.id = app.version_courante(v.piece_id)
         where v.tenant_id = v_piece.tenant_id
           and not v.eteint
           and v.annule_paiement_id is null
           and v.montant_mineur is not null
           and v.moyen_code <> 'non_paye'
           and v.justificatif_piece_id is null
           and not (v.id = any (v_reglements))
           and ((f.vis = 'partage'::app.vis_t) = (v_piece.vis = 'partage'::app.vis_t))
         order by v.paye_le desc, v.created_at desc
         limit 50
      ) c;
  end if;

  return jsonb_build_object(
    'genre', v_genre,
    'vis', v_piece.vis,
    'creeLe', v_piece.created_at,
    'mere', v_mere_json,
    'reglements', v_regl_json,
    'vaut', v_annulation is null,
    'annulation', v_annulation,
    'candidats', v_candidats);
end
$function$;

-- --- Déplacer un justificatif : vers la photo courante du règlement -----------------------------

create or replace function public.justificatif_deplacer(p_piece uuid, p_paiement uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  update capture.pieces set source_piece_id = app.version_courante(v_cible.piece_id)
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'paiement.justificatif_deplace', 'capture', 'pieces', p_piece,
          jsonb_build_object('vers', p_paiement, 'depuis', to_jsonb(v_quittes)));

  return jsonb_build_object('piece_id', p_piece, 'paiement_id', p_paiement);
end
$function$;

-- --- Où va la pièce : avec toutes ses versions, et ce qui en est issu -----------------------------

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
  -- La pièce, c'est toutes ses versions (revue Codex de #127) : ses photos
  -- précédentes la suivent aussi hors du cabinet — la seule chose qu'une
  -- version précédente peut encore changer, et par cette porte seulement —,
  -- et les reçus de chacune avec elles.
  if v_old = 'partage'::app.vis_t then
    perform set_config('malica.suit_la_version', 'on', true);
    for v_derive in
      update capture.pieces
         set vis = p_vis, transmise_le = null, gardee_le = null, updated_at = now()
       where id in (select app.versions_de_la_piece(p_piece))
         and id <> p_piece
         and vis = 'partage'::app.vis_t
      returning id
    loop
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', v_derive.id,
              jsonb_build_object('from', 'partage', 'to', p_vis,
                                 'par_accord', p_par_accord, 'suit_la_version', p_piece));
    end loop;
    perform set_config('malica.suit_la_version', '', true);

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
$$;


-- --- Supprimer : ce qui est issu d'une version archivée la suit -------------------------------------

create or replace function public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean default false)
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
              where e.piece_id = p_piece and e.status = 'booked') then
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
end;$fn$;


commit;
