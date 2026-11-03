-- Le nom de l'émetteur se corrige, comme le type et la date.
--
-- Recette du 2 novembre 2026, facture MyTek : la lecture a pris le logo
-- stylisé, lu « MITEK », pour le nom de l'émetteur, alors que la facture
-- imprime « MyTek » plus bas. Le dirigeant voyait « MITEK » en titre de sa
-- pièce et n'avait aucun moyen de le corriger : `capture_precision_persist`
-- ne connaissait que le type et la date (« champ non précisable »).
--
-- Décision du dirigeant, 3 novembre 2026 : « on doit accepter la correction
-- et on met le petit crayon devant le nom ».
--
-- Ce que ce fichier pose :
--   1. `app.emetteur_dit(piece)` : le dernier nom donné par une personne, ou
--      rien. La lecture reste immuable (R7) ; la correction est une entrée
--      NOUVELLE, datée et signée, à côté d'elle. Une seule règle, lue partout
--      où le nom de l'émetteur sort : la fiche, les listes, la bibliothèque,
--      le reçu, l'export FEC.
--   2. `capture_precision_persist` accepte `issuer` tant que la pièce n'est
--      pas engagée — la même borne que le type et la date. Le nom n'est pas
--      le sens : la PME le corrige même quand le cabinet tient les livres.
--   3. L'export FEC (`export_lignes_lire`) et la fiche d'une pièce qui en
--      accompagne une autre (`piece_qui_accompagne`) nomment le tiers par ce
--      nom retenu. Corps repris tels qu'en base ; seule l'expression du nom
--      change.

begin;

-- --- 1. Le nom retenu ---------------------------------------------------------------------------

create or replace function app.emetteur_dit(p_piece uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select q.valeur from capture.precisions q
   where q.piece_id = p_piece and q.champ = 'issuer'
   order by q.decided_at desc
   limit 1
$$;
revoke all on function app.emetteur_dit(uuid) from public, anon;
grant execute on function app.emetteur_dit(uuid) to authenticated;

comment on function app.emetteur_dit(uuid) is
  'Le dernier nom d''émetteur donné par une personne (précision `issuer`), ou '
  'NULL. La lecture n''est jamais modifiée : qui affiche le nom écrit '
  '`coalesce(app.emetteur_dit(piece), payload ->> ''issuer'')`.';

-- --- 2. La correction du nom ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_precision_persist(p_piece uuid, p_champ text, p_valeur text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_status text;
  v_avant  text;
  v_statut text;
  v_id uuid;
  v_date date;
  v_nom  text;
  v_lu   text;
begin
  select tenant_id, status, document_kind, document_kind_statut
    into v_tenant, v_status, v_avant, v_statut
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'refus.precision.engagee'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après : une seule liste.
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur and d.propose_a_la_capture) then
      raise exception '%', app.refus_avec_valeurs('refus.precision.type_non_propose', 'type', (p_valeur)::text) using errcode = 'check_violation';
    end if;
    -- Le sens (un type qui porte une écriture) est l'acte du cabinet quand il
    -- tient les livres : la PME ne le pose pas, et ne défait pas celui qu'une
    -- personne a établi.
    if app.livres_tenus_par_le_cabinet(v_tenant)
       and not app.supervise_le_dossier(v_tenant)
       and (exists (select 1 from ref.document_types d
                     where d.code = p_valeur and d.porte_ecriture)
            or (v_statut = 'confirme'
                and exists (select 1 from ref.document_types d
                             where d.code = v_avant and d.porte_ecriture))) then
      raise exception 'refus.sens.reserve_au_cabinet'
        using errcode = '42501', hint = 'sens.cabinet';
    end if;
  elsif p_champ = 'document_date' then
    -- Une date qui n'est pas une date lève ici, et non trois écrans plus loin.
    begin
      v_date := p_valeur::date;
    exception when others then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_illisible', 'date', (p_valeur)::text) using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception '%', app.refus_avec_valeurs('refus.precision.date_a_venir', 'date', (p_valeur)::text)
        using errcode = 'check_violation';
    end if;
  elsif p_champ = 'issuer' then
    -- Le nom de l'émetteur, tel que la personne le lit sur sa pièce : le
    -- logo lu « MITEK » quand la facture imprime « MyTek ». Les blancs se
    -- resserrent ; un nom vide n'est pas un nom.
    v_nom := btrim(regexp_replace(coalesce(p_valeur, ''), '\s+', ' ', 'g'));
    if v_nom = '' then
      raise exception 'refus.precision.nom_vide' using errcode = 'check_violation';
    end if;
    -- Borne technique d'une saisie (pas une règle métier) : un nom de société
    -- tient sur une ligne de journal.
    if length(v_nom) > 200 then
      raise exception '%', app.refus_avec_valeurs('refus.precision.nom_trop_long', 'max', '200')
        using errcode = 'check_violation';
    end if;
    -- Ce qui était retenu avant : la dernière correction, sinon la lecture.
    v_lu := coalesce(app.emetteur_dit(p_piece),
                     (select x.payload ->> 'issuer' from capture.extractions x
                       where x.piece_id = p_piece order by x.created_at desc limit 1));
    if v_lu is not distinct from v_nom then
      -- Redire le même nom n'écrit rien : la pièce ne change pas.
      return jsonb_build_object('id', null, 'piece_id', p_piece, 'champ', p_champ,
                                'valeur', v_nom);
    end if;
  else
    raise exception '%', app.refus_avec_valeurs('refus.precision.champ', 'champ', (p_champ)::text) using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, coalesce(v_nom, p_valeur))
  returning id into v_id;

  -- La personne a tranché : la pièce porte le type, confirmé, et c'est ce que
  -- le verrou R2 attend avant toute écriture. Une date précisée ne touche pas
  -- au type.
  if p_champ = 'document_kind' then
    update capture.pieces
       set document_kind = p_valeur,
           document_kind_statut = 'confirme',
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ,
                             'valeur', coalesce(v_nom, p_valeur))
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant)
                  when p_champ = 'issuer'
                  then jsonb_build_object('avant', v_lu) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', coalesce(v_nom, p_valeur));
end
$function$;

comment on function public.capture_precision_persist(uuid, text, text) is
  'Ce que la personne tranche ou corrige : le type de la pièce (parmi ceux que '
  'le référentiel propose au choix), sa date et le nom de son émetteur. Une '
  'entrée NOUVELLE à côté de l''extraction, qui reste immuable (R7). Une pièce '
  'engagée ne se précise plus. Dans un dossier tenu par un cabinet, le sens (un '
  'type qui porte une écriture) ne se précise que par le cabinet '
  '(`piece_type_etabli_par_le_cabinet`).';

-- --- 3. Le FEC et la pièce qui accompagne nomment le tiers par le nom retenu ----------------------

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
                         then null else btrim(coalesce(app.emetteur_dit(c.id), xp.payload ->> 'issuer')) end as lib
           ) t on true
     where e.status = 'booked'
       -- Ce que la société n'a pas transmis n'est pas au cabinet (ANO-007).
       and e.vis = 'partage'::app.vis_t
       and e.tenant_id = any(v_mandats)
       and e.date_ecriture between p_du and p_au
     order by o.name, e.tenant_id, e.date_ecriture, e.booked_at, e.id, l.ordinal;
end $function$;

CREATE OR REPLACE FUNCTION public.piece_qui_accompagne(p_piece uuid)
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
    raise exception 'refus.introuvable.piece' using errcode = '42501';
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
           'emetteur', coalesce(app.emetteur_dit(m.id), x.payload ->> 'issuer'),
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
               coalesce(app.emetteur_dit(f.id), (select e.payload ->> 'issuer' from public.extractions_v e
                 where e.piece_id = f.id and e.contract like 'extract.v1%'
                 order by e.created_at desc limit 1)) as tiers
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

commit;
