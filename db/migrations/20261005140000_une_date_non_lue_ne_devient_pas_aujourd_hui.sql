-- Une date non lue ne devient pas aujourd'hui.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 5 octobre 2026, en cherchant pourquoi « Vos charges » affichait 222 000 et
-- « Votre TVA » zéro pour le même mois. La projection des articles rangeait
-- toute pièce ainsi (`20260826142600`) :
--
--     v_period text := to_char(coalesce(p_document_date, current_date), 'YYYY-MM');
--
-- Et, deux lignes plus bas, résolvait la famille de charge à la même date :
--
--     charge_famille_resolve(p_pack, p_account, designation,
--                            coalesce(p_document_date, current_date))
--
-- Quand la date de la pièce n'a pas été lue — exactement le cas de la facture
-- de loyer du 4 octobre, dont la date était écrite en toutes lettres — la
-- pièce était rangée au mois du SCAN, et son imputation résolue au référentiel
-- du jour où la photo a été prise. Sans un mot.
--
-- ===================================================================== LA RÈGLE
--
-- R4 interdit le repli implicite, et le nomme comme la pire forme d'erreur :
-- invisible, non surchargeable, et produisant un résultat PLAUSIBLE. Une
-- facture de septembre comptée en octobre ne choque personne à la lecture, et
-- fausse une déclaration de TVA.
--
-- Deux corrections, et elles ne sont pas de même nature :
--
--   1. LA PÉRIODE devient NULLE. Pas de rangement plutôt qu'un rangement faux.
--      La pièce attend sa date, et les écrans la montrent comme telle. Un mois
--      vide se voit et se corrige ; un mois faux ne se voit pas.
--
--   2. LA DATE DE RÉSOLUTION devient la date de RÉCEPTION de la pièce, c'est-à-
--      dire `capture.pieces.created_at`. Ce n'est pas un repli déguisé : c'est
--      un fait observé et enregistré, propre à cette pièce, qui ne change pas
--      selon le jour où la projection est rejouée. `current_date`, lui, donnait
--      un résultat différent à chaque reprise — la même pièce pouvait changer
--      d'imputation sans que rien ne bouge.
--
--      Il faut bien UNE date : `charge_famille_resolve` lit un référentiel
--      daté, et refuser de projeter l'article perdrait sa désignation, dont
--      l'écran des charges et Malica ont besoin. Entre une date qui dérive et
--      une date qui est un fait, on prend le fait.
--
-- Ce que ce changement NE FAIT PAS : il ne devine aucune date de pièce, et il
-- ne remplit pas rétroactivement les périodes déjà écrites. Les projections
-- d'avant ce jour gardent le mois de scan qu'on leur a donné ; elles se
-- refont à la prochaine lecture de la pièce.

-- --- 1. La période peut être vide ----------------------------------------------------------

alter table capture.piece_articles alter column period drop not null;

comment on column capture.piece_articles.period is
  'Mois de la pièce, AAAA-MM, dérivé de sa date IMPRIMÉE. NULL quand la date '
  'n''a pas été lue : la pièce n''est alors rangée dans aucun mois, et attend '
  'sa date. Jamais le mois du scan — R4, aucun repli implicite.';

-- --- 2. La projection, qui ne devine plus --------------------------------------------------
-- Corps repris de `20260826142600`. Deux changements, et deux seulement : la
-- période, et la date de résolution de la famille.

create or replace function public.capture_articles_persist(
  p_piece uuid, p_pack uuid, p_document_date date, p_account text, p_articles jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_a jsonb;
  v_i smallint := 0;
  v_fam text;
  v_src text;
  v_idx text;
  -- NULL quand la date n'a pas été lue : aucun mois, plutôt qu'un faux mois.
  v_period text := case when p_document_date is null
                        then null
                        else to_char(p_document_date, 'YYYY-MM') end;
  -- La date de réception de la pièce : un fait, propre à cette pièce, stable
  -- d'une reprise à l'autre. Renseignée juste après la lecture du tenant.
  v_recue date;
  v_date_ref date;
begin
  select tenant_id, entity_id, vis, created_at::date
    into v_tenant, v_entity, v_vis, v_recue
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  v_date_ref := coalesce(p_document_date, v_recue);

  -- Projection reconstruite depuis l'extraction, elle-meme immuable et historisee :
  -- aucune donnee d'origine n'est effacee ici.
  delete from capture.piece_articles where piece_id = p_piece;

  for v_a in select * from jsonb_array_elements(coalesce(p_articles, '[]'::jsonb))
  loop
    if coalesce(btrim(v_a->>'designation'), '') = '' then
      continue;
    end if;
    v_i := v_i + 1;
    v_idx := 'articles[' || (v_i - 1)::text || ']';
    select r.famille_code, r.famille_source into v_fam, v_src
      from public.charge_famille_resolve(p_pack, p_account, v_a->>'designation', v_date_ref) r;
    if v_fam is null then
      raise exception 'aucune famille au pack pour « % » — referentiel incomplet',
        v_a->>'designation' using errcode = 'check_violation';
    end if;

    insert into capture.piece_articles (tenant_id, entity_id, vis, piece_id, ordinal,
      designation, quantity, unit_price_ht, unit_price_ttc, total_ht,
      famille_code, famille_source, period, document_date, citation_field,
      citation_quantity, citation_unit_price_ht, citation_unit_price_ttc,
      citation_total_ht, pack_version_id)
    values (v_tenant, v_entity, v_vis, p_piece, v_i,
      v_a->>'designation',
      nullif(v_a->>'quantity','')::numeric,
      nullif(v_a->>'unit_price_ht','')::numeric,
      nullif(v_a->>'unit_price_ttc','')::numeric,
      nullif(v_a->>'total_ht','')::numeric,
      v_fam, v_src, v_period, p_document_date, v_idx,
      v_idx || '.quantity', v_idx || '.unit_price_ht', v_idx || '.unit_price_ttc',
      v_idx || '.total_ht', p_pack);
  end loop;

  return jsonb_build_object('piece_id', p_piece, 'articles', v_i, 'period', v_period);
end
$$;

revoke all on function public.capture_articles_persist(uuid, uuid, date, text, jsonb)
  from public, anon;
grant execute on function public.capture_articles_persist(uuid, uuid, date, text, jsonb)
  to authenticated;
