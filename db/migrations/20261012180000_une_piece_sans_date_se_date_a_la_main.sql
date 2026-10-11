-- Une pièce sans date se date à la main.
--
-- ================================================================= POURQUOI
--
-- Le 5 octobre 2026, `20261005140000` a cessé de ranger au mois du scan une
-- pièce dont la date n'a pas été lue : la période devient NULLE, « pas de
-- rangement plutôt qu'un rangement faux ». C'était juste, et c'est resté
-- incomplet six jours : la pièce attendait une date que RIEN ne permettait de
-- donner.
--
-- Résultat observable : l'écran des charges annonçait « 3 pièces attendent
-- leur date », le montant qu'elles représentent, et aucun geste ne les
-- débloquait. Une impasse annoncée reste une impasse.
--
-- ============================================= POURQUOI UNE PRÉCISION, ET PAS UNE CORRECTION
--
-- `capture.precisions` existe depuis le 4 septembre pour exactement cela : ce
-- que la personne tranche quand la lecture n'a pas conclu. C'est une entrée
-- nouvelle, datée, à côté de l'extraction qui reste immuable (R7) — et non une
-- réécriture de la lecture. Le mécanisme n'acceptait qu'un seul champ, le sens
-- de la facture ; il en accepte un second.
--
-- ============================================================== CE QUI EST REFUSÉ
--
-- Une date qui n'est pas une date, et une date À VENIR. La seconde mérite un
-- mot : un doigt qui ripe sur un sélecteur donne « 2027-10-11 » aussi
-- facilement que « 2026-10-11 », et une facture rangée dans un exercice qui
-- n'a pas commencé disparaît de toutes les déclarations sans rien signaler.
--
-- Ce qui n'est PAS refusé : une date ancienne. Un dirigeant qui rattrape six
-- mois de factures saisit des dates de six mois ; les refuser rendrait le
-- rattrapage impossible, et c'est le cas d'usage le plus courant.

create or replace function public.capture_precision_persist(
  p_piece  uuid,
  p_champ  text,
  p_valeur text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_status text;
  v_id uuid;
  v_date date;
begin
  select tenant_id, status into v_tenant, v_status
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'une piece engagee ne se precise plus : elle se corrige par ecriture'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    if p_valeur not in ('facture_achat', 'facture_vente') then
      raise exception 'sens de facture inconnu : %', p_valeur using errcode = 'check_violation';
    end if;
  elsif p_champ = 'document_date' then
    -- Une date qui n'est pas une date lève ici, et non trois écrans plus loin.
    begin
      v_date := p_valeur::date;
    exception when others then
      raise exception 'date illisible : %', p_valeur using errcode = 'check_violation';
    end;
    -- Une facture dans un exercice qui n'a pas commencé disparaît de toutes
    -- les déclarations sans rien signaler. Le doigt qui ripe est courant.
    if v_date > current_date then
      raise exception 'une date a venir ne se precise pas : %', p_valeur
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'champ non precisable : %', p_champ using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, p_valeur)
  returning id into v_id;

  -- Repris de `20260908120000`, et BORNÉ au sens : la personne a tranché, la
  -- pièce porte le type, confirmé, et c'est ce que le verrou R2 attend avant
  -- toute écriture. Une date précisée ne touche pas au type — l'écrire ici
  -- aurait posé « confirme » sur un type que personne n'a confirmé.
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
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur));

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', p_valeur);
end
$$;

revoke all on function public.capture_precision_persist(uuid, text, text) from public, anon;
grant execute on function public.capture_precision_persist(uuid, text, text) to authenticated;

comment on function public.capture_precision_persist(uuid, text, text) is
  'Ce que la personne tranche quand la lecture n''a pas conclu : le sens de la '
  'facture, et sa date. Une entrée NOUVELLE à côté de l''extraction, qui reste '
  'immuable (R7). Une date à venir est refusée — un doigt qui ripe rangerait la '
  'pièce dans un exercice qui n''a pas commencé, et elle disparaîtrait de '
  'toutes les déclarations sans rien signaler.';
