-- Le type d'une pièce se dit court, et se corrige après la lecture
-- (23 octobre 2026).
--
-- Wissem : « il faut réduire les écritures — facture que j'ai émise, on dit
-- simplement facture vente — et on peut corriger après la lecture. »
--
-- ================================================================ CE QUI CHANGE
--
--   1. Les libellés : « Une facture que j'ai émise » devient « Facture vente »,
--      partout où le type se lit — la question avant la lecture, le titre de
--      la pièce, la chaîne, la question du sens. Une vingtaine de types
--      n'avaient AUCUN libellé traduit et s'affichaient en français dans un
--      écran arabe : ils en reçoivent un, dans les trois langues.
--
--   2. La correction : `capture_precision_persist` n'acceptait que
--      « facture_achat » et « facture_vente », écrits dans la fonction. Elle
--      accepte désormais tout type que le référentiel propose au choix
--      (`propose_a_la_capture`) : la règle vit dans la table, pas dans le code
--      (R4). Un reçu lu comme une facture se reclasse ; un relevé aussi.
--
-- ========================================================== CE QUI NE CHANGE PAS
--
--   — Une pièce engagée (proposée, supervisée, comptabilisée) ne se reclasse
--     plus : elle se corrige par écriture.
--   — Corriger le type ne relit pas la pièce : la lecture actuelle ne dépend
--     pas du type déclaré, et la relecture d'une pièce déjà comptée reste
--     gratuite (`lecture_verdict`, « relecture_gratuite », décision de Wissem
--     du 23 octobre : option A). Le jugement déterministe est refait par l'API
--     juste après, sur le type corrigé.
--
-- ================================================================= R7, R11
--
-- Une précision est une entrée NOUVELLE, l'extraction ne bouge pas ; la trace
-- d'audit garde le type d'avant. `ref.labels` n'a pas de date d'effet : les
-- libellés se remplacent. Aucune date du jour.

-- --- 1. Les libellés courts --------------------------------------------------------------------

insert into ref.labels (ns, key, locale, value) values
  ('document_type','facture_achat','fr','Facture achat'),
  ('document_type','facture_achat','en','Purchase invoice'),
  ('document_type','facture_achat','ar','فاتورة شراء'),
  ('document_type','facture_vente','fr','Facture vente'),
  ('document_type','facture_vente','en','Sales invoice'),
  ('document_type','facture_vente','ar','فاتورة بيع'),
  ('document_type','avoir','fr','Avoir'),
  ('document_type','avoir','en','Credit note'),
  ('document_type','avoir','ar','فاتورة تعديل'),
  ('document_type','ticket_caisse','fr','Reçu / ticket'),
  ('document_type','ticket_caisse','en','Receipt'),
  ('document_type','ticket_caisse','ar','وصل'),
  ('document_type','bon_livraison','fr','Bon de livraison'),
  ('document_type','bon_livraison','en','Delivery note'),
  ('document_type','bon_livraison','ar','وصل تسليم'),
  ('document_type','releve_bancaire','fr','Relevé bancaire'),
  ('document_type','releve_bancaire','en','Bank statement'),
  ('document_type','releve_bancaire','ar','كشف بنكي'),
  ('document_type','note_frais','fr','Note de frais'),
  ('document_type','note_frais','en','Expense report'),
  ('document_type','note_frais','ar','بيان مصاريف'),
  ('document_type','recu_de_paiement','fr','Reçu de paiement'),
  ('document_type','recu_de_paiement','en','Payment receipt'),
  ('document_type','recu_de_paiement','ar','وصل دفع'),
  ('document_type','justificatif_paiement','fr','Justificatif de paiement'),
  ('document_type','justificatif_paiement','en','Proof of payment'),
  ('document_type','justificatif_paiement','ar','مؤيّد دفع'),
  ('document_type','autre_document','fr','Autre'),
  ('document_type','autre_document','en','Other'),
  ('document_type','autre_document','ar','أخرى'),
  ('document_type','declaration_tva','fr','Déclaration TVA'),
  ('document_type','declaration_tva','en','VAT return'),
  ('document_type','declaration_tva','ar','تصريح بالأداء على القيمة المضافة'),
  ('document_type','declaration_impot','fr','Déclaration d''impôt'),
  ('document_type','declaration_impot','en','Tax return'),
  ('document_type','declaration_impot','ar','تصريح جبائي'),
  ('document_type','acompte_provisionnel','fr','Acompte provisionnel'),
  ('document_type','acompte_provisionnel','en','Provisional tax instalment'),
  ('document_type','acompte_provisionnel','ar','قسط احتياطي'),
  ('document_type','bulletin_paie','fr','Bulletin de paie'),
  ('document_type','bulletin_paie','en','Payslip'),
  ('document_type','bulletin_paie','ar','بطاقة خلاص'),
  ('document_type','declaration_cnss','fr','Déclaration CNSS'),
  ('document_type','declaration_cnss','en','CNSS return'),
  ('document_type','declaration_cnss','ar','تصريح الصندوق الوطني للضمان الاجتماعي'),
  ('document_type','carte_identification_fiscale','fr','Carte fiscale'),
  ('document_type','carte_identification_fiscale','en','Tax ID card'),
  ('document_type','carte_identification_fiscale','ar','بطاقة التعريف الجبائي'),
  ('document_type','pv_ago','fr','Gouvernance'),
  ('document_type','pv_ago','en','Governance'),
  ('document_type','pv_ago','ar','حوكمة'),
  ('document_type','pv_age','fr','PV d''AGE'),
  ('document_type','pv_age','en','EGM minutes'),
  ('document_type','pv_age','ar','محضر جلسة عامة خارقة للعادة'),
  ('document_type','statuts','fr','Statuts'),
  ('document_type','statuts','en','Articles of association'),
  ('document_type','statuts','ar','النظام الأساسي'),
  ('document_type','extrait_rne','fr','Extrait RNE'),
  ('document_type','extrait_rne','en','Business register extract'),
  ('document_type','extrait_rne','ar','مضمون من السجل الوطني للمؤسسات'),
  ('document_type','contrat','fr','Contrat'),
  ('document_type','contrat','en','Contract'),
  ('document_type','contrat','ar','عقد'),
  ('document_type','bail','fr','Bail'),
  ('document_type','bail','en','Lease'),
  ('document_type','bail','ar','عقد كراء'),
  ('document_type','non_comptable','fr','Non comptable'),
  ('document_type','non_comptable','en','Non-accounting'),
  ('document_type','non_comptable','ar','غير محاسبي')
on conflict (ns, key, locale) do update set value = excluded.value;

-- --- 2. Le type se corrige après la lecture ----------------------------------------------------
--
-- Corps repris de `20261012180000`. Seuls changent : la liste des types admis
-- (lue dans le référentiel) et le type d'avant, gardé dans la trace.

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
  v_avant  text;
  v_id uuid;
  v_date date;
begin
  select tenant_id, status, document_kind into v_tenant, v_status, v_avant
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_status not in ('capturee', 'lue', 'retournee') then
    raise exception 'une piece engagee ne se precise plus : elle se corrige par ecriture'
      using errcode = 'check_violation';
  end if;

  if p_champ = 'document_kind' then
    -- Ce qui se choisit à la photo se choisit aussi après : une seule liste.
    if not exists (select 1 from ref.document_types d
                    where d.code = p_valeur and d.propose_a_la_capture) then
      raise exception 'type de piece non propose : %', p_valeur using errcode = 'check_violation';
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
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ, 'valeur', p_valeur)
          || case when p_champ = 'document_kind'
                  then jsonb_build_object('avant', v_avant) else '{}'::jsonb end);

  return jsonb_build_object('id', v_id, 'piece_id', p_piece, 'champ', p_champ,
                            'valeur', p_valeur);
end
$$;
revoke all on function public.capture_precision_persist(uuid, text, text) from public, anon;
grant execute on function public.capture_precision_persist(uuid, text, text) to authenticated;

comment on function public.capture_precision_persist(uuid, text, text) is
  'Ce que la personne tranche ou corrige : le type de la pièce (parmi ceux que '
  'le référentiel propose au choix) et sa date. Une entrée NOUVELLE à côté de '
  'l''extraction, qui reste immuable (R7). Une pièce engagée ne se précise plus.';
