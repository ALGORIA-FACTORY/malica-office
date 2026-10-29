-- Une pièce se juge à sa VERSION COURANTE, partout où un dépendant la nomme.
--
-- Revue Codex de #127 : un règlement saisi sur A avant confirmation du type,
-- A remplacé par B, B confirmé — le règlement hérité ne s'inscrivait pas :
-- son écriture porte A (le fait du règlement, intact), et `assert_bookable`
-- jugeait le type de A, gelé « à confirmer » pour toujours.
--
-- Inventaire de tout ce qui va d'un dépendant (règlement, écriture, pièce
-- issue) à un attribut de la pièce. Restaient quatre écarts :
--   1. `socle.assert_bookable` : le contrôle R2 (type confirmé, type qui porte
--      écriture) juge la version courante ;
--   2. `socle_ecriture_propose` : l'écriture prend le dossier, l'établissement
--      et le côté (vis) de la version courante, et c'est elle qu'on verrouille.
--      La pièce de l'écriture reste celle nommée (le règlement, sur A) ;
--   3. `socle_ecriture_review` : le verdict, le statut et l'avis portent sur la
--      version courante ; la contre-passation garde la pièce de l'écriture ;
--   4. `export_lignes_lire` : référence, date, tiers et contrepartie du FEC se
--      lisent sur la version courante ;
--   5. `capture_piece_register` : une pièce issue d'une version précédente
--      prend le côté de la courante — jamais partagée si la courante est
--      gardée dans la société.
-- Les faits (piece_id des règlements, des écritures, source_piece_id) ne
-- bougent pas.

CREATE OR REPLACE FUNCTION socle.assert_bookable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'socle', 'identity', 'capture', 'ref', 'app', 'pg_catalog'
AS $function$
declare
  v_debit  numeric(38,3);
  v_credit numeric(38,3);
  v_count  integer;
  v_mode   app.validation_mode_t;
  v_kind   text;
  v_statut text;
  v_porte  boolean;
begin
  if new.status = 'booked' and (old.status is distinct from 'booked') then
    select count(*), coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
      into v_count, v_debit, v_credit
      from socle.ecriture_lignes l where l.ecriture_id = new.id;

    if v_count = 0 then
      raise exception 'R5 : une ecriture sans ligne ne peut pas etre comptabilisee'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception 'R5 : desequilibre debit=% credit=%', v_debit, v_credit
        using errcode = 'check_violation';
    end if;

    /*
     * Ce qui a été photographié doit être un document qui porte écriture, et
     * son type doit être ÉTABLI.
     *
     * Sans cela, un procès-verbal d'assemblée ou un brouillon devenait une
     * facture d'achat par simple valeur par défaut, et cherchait un compte de
     * charge. La règle est ici et non dans l'écran : un écran s'oublie.
     *
     * Une écriture sans pièce reste possible — une écriture d'à-nouveaux, une
     * régularisation. C'est le rattachement à une pièce qui est contrôlé, pas
     * son existence.
     *
     * Une photo reprise : c'est la version courante qui dit le type (un
     * règlement saisi sur l'ancienne garde son écriture sur l'ancienne).
     */
    if new.piece_id is not null then
      select p.document_kind, p.document_kind_statut
        into v_kind, v_statut
        from capture.pieces p where p.id = app.version_courante(new.piece_id);

      if v_statut is distinct from 'confirme' then
        raise exception 'R2 : le type de la piece n''est pas confirme (%), aucune ecriture ne peut en decouler',
          coalesce(v_statut, 'inconnu')
          using errcode = 'check_violation';
      end if;

      select t.porte_ecriture into v_porte
        from ref.document_types t where t.code = v_kind;

      if coalesce(v_porte, false) = false then
        raise exception 'R2 : un document de type % ne porte pas d''ecriture comptable',
          coalesce(v_kind, 'inconnu')
          using errcode = 'check_violation';
      end if;
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome is not null and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    if v_mode = 'mandate' and new.reviewed_by = new.booked_by then
      raise exception 'chk_ecr_4eyes : en mode mandat, le superviseur ne peut pas etre celui qui a comptabilise'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.socle_ecriture_propose(p_piece uuid, p_journal text, p_date date, p_libelle text, p_pack_version uuid, p_lignes jsonb, p_devise text DEFAULT 'TND'::text, p_paiement uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis    app.vis_t;
  v_nature text := case when p_paiement is null then 'piece' else 'reglement' end;
  v_ecr    uuid;
  v_inscrite uuid;
  v_l      jsonb;
  v_i      smallint := 0;
begin
  -- Le verrou de la pièce sérialise deux clics, deux onglets, deux personnes.
  -- Une photo reprise se lit à sa version courante : c'est elle qu'on
  -- verrouille, et elle qui dit le dossier, l'établissement et le côté.
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = app.version_courante(p_piece) for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if p_paiement is not null
     and not exists (select 1 from capture.paiements
                      where id = p_paiement and piece_id = p_piece) then
    raise exception 'ce reglement n''appartient pas a cette piece' using errcode = '22023';
  end if;

  select e.id into v_inscrite
    from socle.ecritures e
   where e.piece_id = p_piece and e.nature = v_nature
     and e.paiement_id is not distinct from p_paiement
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_inscrite is not null then
    -- Un règlement inscrit l'est une fois : redemander rend la même écriture.
    if v_nature = 'reglement' then
      return v_inscrite;
    end if;
    raise exception 'Cette pièce est déjà inscrite. Pour la réimputer, retournez d''abord son écriture : elle sera contre-passée.'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  delete from socle.ecritures
   where piece_id = p_piece and status = 'proposee' and reverses_id is null
     and nature = v_nature and paiement_id is not distinct from p_paiement;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               nature, paiement_id)
  values (v_tenant, v_entity, p_piece, v_vis, p_journal, p_date, p_devise,
          p_libelle, p_pack_version, v_nature, p_paiement)
  returning id into v_ecr;

  for v_l in select * from jsonb_array_elements(p_lignes)
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code)
    values (v_tenant, v_ecr, v_i, v_l->>'account_code', v_l->>'libelle',
            coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0),
            nullif(v_l->>'tax_code',''));
  end loop;

  -- Seule l'écriture de la facture fait avancer la pièce.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when status in ('capturee','lue','retournee') then 'proposee' else status end,
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.proposed', 'socle', 'ecritures', v_ecr,
          jsonb_build_object('piece_id', p_piece, 'pack_version_id', p_pack_version,
                             'nature', v_nature, 'paiement_id', p_paiement,
                             'lignes', jsonb_array_length(p_lignes)));

  return v_ecr;
end $function$
;

CREATE OR REPLACE FUNCTION public.socle_ecriture_review(p_ecriture uuid, p_outcome app.review_outcome_t, p_motif uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant  uuid;
  v_entity  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_journal text;
  v_libelle text;
  v_devise  text;
  v_status  text;
  v_date    date;
  v_rev     uuid;
  v_i       smallint := 0;
  v_l       record;
  v_requires_note boolean;
  v_courante uuid;
begin
  select tenant_id, entity_id, piece_id, pack_version_id, journal, libelle, devise, status,
         date_ecriture
    into v_tenant, v_entity, v_piece, v_pack, v_journal, v_libelle, v_devise, v_status, v_date
    from socle.ecritures where id = p_ecriture;
  -- Le verdict porte sur la pièce, donc sur sa version courante ; la
  -- contre-passation, elle, garde la pièce de l'écriture qu'elle annule.
  v_courante := app.version_courante(v_piece);

  if v_tenant is null then
    raise exception 'ecriture introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- La supervision est le second regard : elle revient à l'expert ou au
  -- collaborateur du cabinet engagé, jamais à l'assistant (ANO-CAB-006). Un
  -- membre de la société (dossier autonome) garde la main sur son dossier.
  if v_tenant not in (select app.member_orgs())
     and not exists (
       select 1
         from identity.engagements e
         join identity.memberships m on m.tenant_id = e.cabinet_org_id
        where e.pme_org_id = v_tenant and e.status = 'actif'
          and m.user_id = auth.uid() and m.role in ('expert', 'collaborateur')
     ) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_status <> 'booked' then
    raise exception 'seule une ecriture comptabilisee est supervisable'
      using errcode = 'check_violation';
  end if;

  if p_outcome = 'retourne' then
    if p_motif is null then
      raise exception 'un retour exige un motif gouverne' using errcode = 'check_violation';
    end if;
    select requires_note into v_requires_note from ref.rejet_motifs where id = p_motif;
    if v_requires_note is null then
      raise exception 'motif inconnu' using errcode = 'check_violation';
    end if;
    if v_requires_note and coalesce(btrim(p_note), '') = '' then
      raise exception 'ce motif exige une note' using errcode = 'check_violation';
    end if;
  end if;

  update socle.ecritures
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_outcome = p_outcome,
         review_motif_id = p_motif,
         review_note = p_note,
         updated_at = now()
   where id = p_ecriture;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, v_courante,
          case when p_outcome = 'valide' then 'conforme'::app.verdict_t
               else 'a_corriger'::app.verdict_t end,
          p_motif, p_note, v_pack, auth.uid());

  if p_outcome = 'valide' then
    update capture.pieces set status = 'supervisee', updated_at = now()
     where id = v_courante;
  else
    insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                                 date_ecriture, devise, libelle, pack_version_id,
                                 status, reverses_id, reversal_reason_id)
    values (v_tenant, v_entity, v_piece, 'partage', v_journal,
            app.date_de_contre_passation(v_tenant, v_date), v_devise,
            'Contre-passation — ' || v_libelle, v_pack,
            'proposee', p_ecriture, p_motif)
    returning id into v_rev;

    for v_l in
      select ordinal, account_code, libelle, debit, credit, tax_code
        from socle.ecriture_lignes where ecriture_id = p_ecriture order by ordinal
    loop
      v_i := v_i + 1;
      insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                         libelle, debit, credit, tax_code)
      values (v_tenant, v_rev, v_i, v_l.account_code,
              'Contre-passation — ' || v_l.libelle,
              v_l.credit, v_l.debit, v_l.tax_code);
    end loop;

    update socle.ecritures
       set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
     where id = v_rev;

    update capture.pieces set status = 'retournee', updated_at = now()
     where id = v_courante;
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant,
          case when p_outcome = 'valide' then 'piece.validee' else 'piece.retournee' end,
          jsonb_build_object('piece_id', v_courante, 'ecriture_id', p_ecriture,
                             'motif_id', p_motif, 'note', p_note));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(),
          case when p_outcome = 'valide' then 'ecriture.validee' else 'ecriture.retournee' end,
          'socle', 'ecritures', p_ecriture, p_motif, v_pack,
          jsonb_build_object('piece_id', v_piece, 'reversal_id', v_rev, 'note', p_note));

  return v_rev;
end $function$
;

CREATE OR REPLACE FUNCTION public.export_lignes_lire(p_cabinet uuid, p_client uuid, p_du date, p_au date)
 RETURNS TABLE(client_tenant_id uuid, client_nom text, client_legal_id text, ecriture_id uuid, numero bigint, journal text, journal_libelle text, date_ecriture date, ordinal smallint, compte text, compte_libelle text, piece_ref text, piece_date date, ecriture_libelle text, ligne_libelle text, debit numeric, credit numeric, tax_code text, valide_le date, devise text, pack_version_id uuid, tiers_num text, tiers_lib text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin
  return query
    select e.tenant_id,
           o.name,
           o.legal_id,
           e.id,
           dense_rank() over (partition by e.tenant_id, e.journal
                              order by e.date_ecriture, e.booked_at, e.id),
           e.journal,
           coalesce(j.libelle, e.journal),
           e.date_ecriture,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = e.pack_version_id and ra.account_code = l.account_code),
             ''),
           coalesce(
             (select r.valeur
                from capture.extractions x
                cross join lateral jsonb_each_text(coalesce(x.payload -> 'references', '{}'::jsonb))
                     as r(cle, valeur)
               where x.piece_id = c.id and x.contract = 'extract.v1'
                 and length(btrim(r.valeur)) > 0
               order by x.created_at desc,
                        (r.cle ~* 'invoice|facture|numero|number') desc,
                        r.cle
               limit 1),
             ''),
           coalesce(
             (case when xp.payload ->> 'document_date' ~ '^\d{4}-\d{2}-\d{2}$'
                   then (xp.payload ->> 'document_date')::date end),
             p.created_at::date,
             e.date_ecriture),
           e.libelle,
           l.libelle,
           l.debit::numeric,
           l.credit::numeric,
           l.tax_code,
           -- ValidDate : la SUPERVISION, pas la comptabilisation (ANO-007).
           -- Une contre-passation est l'acte même du cabinet : elle est
           -- validée à son inscription. Sinon, vide tant que non validée.
           case when e.reverses_id is not null then e.booked_at::date
                when e.review_outcome = 'valide' then e.reviewed_at::date end,
           e.devise,
           e.pack_version_id,
           case when l.account_code = cp.counterparty_account then t.num end,
           case when l.account_code = cp.counterparty_account and t.num is not null
                then coalesce(nullif(t.lib, ''), t.num) end
      from socle.ecritures e
      join socle.ecriture_lignes l on l.ecriture_id = e.id
      join identity.organizations o on o.id = e.tenant_id
      left join ref.journals j on j.code = e.journal
      -- La pièce telle que sa version courante la dit : un règlement saisi
      -- sur une photo reprise garde son écriture sur l'ancienne (le fait).
      cross join lateral (select app.version_courante(e.piece_id) as id) c
      left join capture.pieces p on p.id = c.id
      left join lateral (
             select x.payload from capture.extractions x
              where x.piece_id = c.id and x.contract = 'extract.v1'
              order by x.created_at desc limit 1) xp on true
      left join lateral (
             select mm.counterparty_account from ref.account_mappings mm
              where mm.pack_version_id = e.pack_version_id and mm.document_kind = p.document_kind
              order by mm.counterparty_account limit 1) cp on true
      left join lateral (
             select nullif(upper(regexp_replace(
                      coalesce(xp.payload -> 'references' ->> 'matricule_fiscal', ''), '\s', '', 'g')), '') as emetteur,
                    nullif(upper(regexp_replace(
                      coalesce(xp.payload -> 'references' ->> 'matricule_fiscal_client', ''), '\s', '', 'g')), '') as client
           ) mf on true
      left join lateral (
             select case when mf.emetteur is not null and mf.emetteur = upper(o.legal_id)
                         then mf.client else mf.emetteur end as num,
                    case when mf.emetteur is not null and mf.emetteur = upper(o.legal_id)
                         then null else btrim(xp.payload ->> 'issuer') end as lib
           ) t on true
     where e.status = 'booked'
       -- Ce que la société n'a pas transmis n'est pas au cabinet (ANO-007).
       and e.vis = 'partage'::app.vis_t
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $function$
;

CREATE OR REPLACE FUNCTION public.capture_piece_register(p_tenant uuid, p_source text, p_storage_path text, p_idempotency_key text, p_entity uuid DEFAULT NULL::uuid, p_vis app.vis_t DEFAULT 'partage'::app.vis_t, p_sha256 text DEFAULT NULL::text, p_page_count smallint DEFAULT NULL::smallint, p_document_kind text DEFAULT NULL::text, p_source_piece uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    -- Une source remplacée se lit à sa version courante : son côté est celui
    -- de la courante (une version précédente garde le sien, gelé).
    select tenant_id, vis into v_tenant_source, v_vis_source
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
$function$
;

-- Le contrôle R2 juge maintenant la version courante : une écriture de
-- FACTURE proposée sur une version précédente doit être refusée pour ce
-- qu'elle est (refus.piece.remplacee / refus.piece.archivee), avant que le
-- type de la courante ne soit jugé. Les déclencheurs d'une même table et d'un
-- même moment partent dans l'ordre de leur nom : le retrait passe en tête.
alter trigger une_piece_retiree_ne_s_inscrit_plus on socle.ecritures
  rename to ecritures_0_une_piece_retiree_ne_s_inscrit_plus;
