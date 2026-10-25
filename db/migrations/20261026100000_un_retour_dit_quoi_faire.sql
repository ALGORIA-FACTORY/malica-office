-- Un retour du cabinet dit QUOI faire, et le cabinet a des gestes devant une
-- pièce que le client n'a pas confirmée.
--
-- Audit du 25 octobre 2026, maquette « Retours du cabinet et pièces à
-- confirmer » validée par Wissem le même jour :
--   * côté cabinet, une pièce transmise mais « lue » (le client n'a pas dit
--     « Oui ») n'avait AUCUN geste : ni inscrire, ni retourner, ni relancer ;
--   * côté PME, un retour ne montrait ni le motif ni la note : le bandeau
--     redemandait « C'est bien le bon montant ? », et « Oui » recomptabilisait
--     sans le document demandé.
--
-- Ce que ce fichier pose :
--   1. le GESTE qu'un motif de retour demande au client, et la PREUVE qu'il a
--      été fait — dans le référentiel, pas dans l'écran ;
--   2. `piece_retourner` : retourner au client une pièce pas encore inscrite ;
--   3. `piece_demander_confirmation` : relancer le client ;
--   4. `piece_retour` : ce que la PME lit d'un retour (motif, note, cabinet,
--      geste, fait ou non) ;
--   5. `piece_repondre_au_cabinet` : la réponse du client, tracée.

-- --- 1. Le geste et sa preuve -------------------------------------------------------------------

alter table ref.rejet_motifs
  add column if not exists geste text,
  add column if not exists preuve text;

update ref.rejet_motifs m
   set geste = v.geste, preuve = v.preuve
  from (values
    ('justificatif_manquant',  'joindre_document',         'rattachement'),
    ('mention_legale_absente', 'joindre_facture_conforme', 'rattachement'),
    ('montant_incoherent',     'reprendre_photo',          'rattachement'),
    ('piece_illisible',        'reprendre_photo',          'rattachement'),
    ('hors_exercice',          'corriger_date',            'precision'),
    ('taux_tva_inapproprie',   'repondre',                 'reponse'),
    ('imputation_a_revoir',    'repondre',                 'reponse'),
    ('non_deductible',         'repondre',                 'reponse'),
    ('doublon',                'demander_suppression',     'aucune'),
    ('reglement_annule',       'voir_reglement',           'aucune')
  ) as v(code, geste, preuve)
 where m.code = v.code;

-- Un motif sans geste ne laisse pas le client sans issue : il peut répondre.
update ref.rejet_motifs set geste = 'repondre', preuve = 'reponse' where geste is null;

alter table ref.rejet_motifs
  alter column geste set not null,
  alter column preuve set not null,
  drop constraint if exists rejet_motifs_geste_check,
  add constraint rejet_motifs_geste_check check (geste in (
    'joindre_document', 'joindre_facture_conforme', 'reprendre_photo', 'corriger_date',
    'repondre', 'demander_suppression', 'voir_reglement')),
  drop constraint if exists rejet_motifs_preuve_check,
  add constraint rejet_motifs_preuve_check check (preuve in (
    'rattachement', 'precision', 'reponse', 'aucune'));

create or replace view public.ref_rejet_motifs_v with (security_invoker = true) as
  select id, code, severity, requires_note, sort_order, active, valid_from, valid_to,
         geste, preuve
    from ref.rejet_motifs;
grant select on public.ref_rejet_motifs_v to authenticated;

-- --- 2. Retourner une pièce pas encore inscrite ---------------------------------------------------
--
-- Une pièce INSCRITE se retourne par `socle_ecriture_review` (contre-passation).
-- Une pièce transmise que le client n'a pas confirmée n'a rien à contre-passer :
-- elle revient au client, avec le motif gouverné et la note.

create or replace function public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if v_status not in ('lue', 'proposee', 'confirmee') then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  select requires_note into v_note_requise from ref.rejet_motifs where id = p_motif;
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
$$;

revoke all on function public.piece_retourner(uuid, uuid, text) from public, anon;
grant execute on function public.piece_retourner(uuid, uuid, text) to authenticated;

-- --- 3. Relancer le client ------------------------------------------------------------------------

create or replace function public.piece_demander_confirmation(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.engaged_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_vis <> 'partage'::app.vis_t or v_status not in ('lue', 'proposee') then
    raise exception 'refus.confirmation.sans_objet' using errcode = 'check_violation';
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.confirmation_demandee', jsonb_build_object('piece_id', p_piece));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.confirmation_demandee', 'capture', 'pieces', p_piece,
          '{}'::jsonb);

  return jsonb_build_object('piece_id', p_piece);
end
$$;

revoke all on function public.piece_demander_confirmation(uuid) from public, anon;
grant execute on function public.piece_demander_confirmation(uuid) to authenticated;

-- --- 5. La réponse du client (avant 4 : `piece_retour` la lit) -------------------------------------

create or replace function public.piece_repondre_au_cabinet(p_piece uuid, p_texte text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
begin
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'cette piece n''est pas partagee : personne a qui repondre'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_texte), '') = '' then
    raise exception 'refus.reponse.vide' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.reponse_client', 'capture', 'pieces', p_piece,
          jsonb_build_object('texte', btrim(p_texte)));

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.reponse_client',
          jsonb_build_object('piece_id', p_piece, 'note', btrim(p_texte)));

  return jsonb_build_object('piece_id', p_piece);
end
$$;

revoke all on function public.piece_repondre_au_cabinet(uuid, text) from public, anon;
grant execute on function public.piece_repondre_au_cabinet(uuid, text) to authenticated;

-- --- 4. Ce que la PME lit d'un retour -------------------------------------------------------------
--
-- Le DERNIER verdict « à corriger » d'une pièce retournée : motif, note, date,
-- cabinet, et si le geste demandé est fait — une preuve postérieure au retour,
-- du genre que le référentiel désigne. `null` si la pièce n'est pas retournée.

create or replace function public.piece_retour(p_piece uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select id, tenant_id, status from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
  ),
  c as (
    select c.decided_at, c.note, c.motif_id, c.decided_by
      from capture.conformite c join p on p.id = c.piece_id
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
          select 1 from capture.rattachements r
           where r.piece_id = p_piece and r.fait = 'rattache'
             and r.created_at > (select decided_at from c))
        when 'precision' then exists (
          select 1 from capture.precisions pr
           where pr.piece_id = p_piece and pr.decided_at > (select decided_at from c))
        when 'reponse' then exists (
          select 1 from audit.event_log ev
           where ev.object_id = p_piece and ev.action = 'piece.reponse_client'
             and ev.at > (select decided_at from c))
        else false end)
  end
    from c
    join ref.rejet_motifs m on m.id = c.motif_id
    left join ref.labels l on l.ns = 'rejet_motif' and l.key = m.code and l.locale = p_locale
    left join ref.labels lf on lf.ns = 'rejet_motif' and lf.key = m.code and lf.locale = 'fr'
$$;

revoke all on function public.piece_retour(uuid, text) from public, anon;
grant execute on function public.piece_retour(uuid, text) to authenticated;
