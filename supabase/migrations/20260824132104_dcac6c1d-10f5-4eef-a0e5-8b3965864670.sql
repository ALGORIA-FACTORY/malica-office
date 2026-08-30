-- ============================================================
-- 006 : semis du référentiel Tunisie (pack non ratifié)
-- ============================================================

-- 1. Pack TN 2026 — validated_by IS NULL => bandeau "non ratifié"
insert into ref.jurisdiction_packs (jurisdiction, version, effective_from, source, validated_by, validated_at)
values ('TN', '2026.1', date '2026-01-01',
        'Code de la TVA (TN) + Loi de finances 2026 + Système Comptable Tunisien (NCT)',
        null, null)
on conflict (jurisdiction, version) do nothing;

-- 2. Taux de TVA
insert into ref.tva_rates (pack_version_id, code, label, rate, valid_from, legal_reference)
select p.id, v.code, v.label, v.rate, date '2026-01-01', v.ref
from ref.jurisdiction_packs p,
  (values
    ('TVA19', 'TVA taux normal 19%',        0.190000, 'Code TVA, art. 7 - taux normal'),
    ('TVA13', 'TVA taux intermediaire 13%', 0.130000, 'Code TVA, art. 7 - taux reduit'),
    ('TVA07', 'TVA taux reduit 7%',         0.070000, 'Code TVA, art. 7 - taux reduit'),
    ('EXO',   'Exonere de TVA',             0.000000, 'Code TVA, tableau A'),
    ('EXPORT','Export - taux zero',         0.000000, 'Code TVA, art. 11')
  ) as v(code, label, rate, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;

-- 3. Comptes (Systeme Comptable Tunisien)
insert into ref.accounts (pack_version_id, account_code, label, parent_code, account_class)
select p.id, a.code, a.label, a.parent, a.class
from ref.jurisdiction_packs p,
  (values
    ('401', 'Fournisseurs d''exploitation',        '40', '4'),
    ('411', 'Clients',                             '41', '4'),
    ('4366','Etat - TVA deductible',               '436','4'),
    ('4367','Etat - TVA collectee',                '436','4'),
    ('4368','Etat - Retenue a la source',          '436','4'),
    ('4369','Etat - Timbre fiscal',                '436','4'),
    ('532', 'Banque',                              '53', '5'),
    ('540', 'Caisse',                              '54', '5'),
    ('601', 'Achats de marchandises',              '60', '6'),
    ('606', 'Achats non stockes de matieres et fournitures', '60','6'),
    ('613', 'Locations',                           '61', '6'),
    ('624', 'Transports',                          '62', '6'),
    ('626', 'Frais postaux et telecommunications', '62', '6'),
    ('627', 'Services bancaires',                  '62', '6'),
    ('665', 'Honoraires',                          '66', '6'),
    ('701', 'Ventes de marchandises',              '70', '7'),
    ('706', 'Prestations de services',             '70', '7')
  ) as a(code, label, parent, class)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, account_code) do nothing;

-- 4. Mentions obligatoires de facture
insert into ref.mentions (pack_version_id, code, label, mandatory, legal_reference)
select p.id, m.code, m.label, m.mandatory, m.ref
from ref.jurisdiction_packs p,
  (values
    ('IDENT_FISCAL_EMETTEUR', 'Identifiant fiscal de l''emetteur', true,  'Code TVA, art. 18'),
    ('IDENT_FISCAL_CLIENT',   'Identifiant fiscal du client',      true,  'Code TVA, art. 18'),
    ('DATE_FACTURE',          'Date de la facture',                true,  'Code TVA, art. 18'),
    ('NUMERO_SEQUENTIEL',     'Numero sequentiel ininterrompu',    true,  'Code TVA, art. 18'),
    ('DESIGNATION',           'Designation des biens ou services', true,  'Code TVA, art. 18'),
    ('BASE_HT',               'Base imposable hors taxes',         true,  'Code TVA, art. 18'),
    ('TAUX_TVA',              'Taux de TVA applique',              true,  'Code TVA, art. 18'),
    ('MONTANT_TVA',           'Montant de la TVA',                 true,  'Code TVA, art. 18'),
    ('TOTAL_TTC',             'Total toutes taxes comprises',      true,  'Code TVA, art. 18'),
    ('TIMBRE_FISCAL',         'Droit de timbre',                   true,  'Code des droits de timbre'),
    ('MENTION_EXONERATION',   'Mention d''exoneration ou de suspension', false, 'Code TVA, tableau A'),
    ('RETENUE_SOURCE',        'Retenue a la source appliquee',     false, 'Code IRPP/IS, art. 52')
  ) as m(code, label, mandatory, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code) do nothing;

-- 5. Correspondance comptable par type de piece et code de taxe
insert into ref.account_mappings (pack_version_id, document_kind, tax_code, main_account, vat_account, counterparty_account)
select p.id, m.kind, m.tax, m.main, m.vat, m.cpty
from ref.jurisdiction_packs p,
  (values
    ('facture_achat', 'TVA19',  '601', '4366', '401'),
    ('facture_achat', 'TVA13',  '601', '4366', '401'),
    ('facture_achat', 'TVA07',  '601', '4366', '401'),
    ('facture_achat', 'EXO',    '601', '4366', '401'),
    ('facture_achat', 'EXPORT', '601', '4366', '401'),
    ('facture_vente', 'TVA19',  '701', '4367', '411'),
    ('facture_vente', 'TVA13',  '701', '4367', '411'),
    ('facture_vente', 'TVA07',  '701', '4367', '411'),
    ('facture_vente', 'EXO',    '701', '4367', '411'),
    ('facture_vente', 'EXPORT', '701', '4367', '411')
  ) as m(kind, tax, main, vat, cpty)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, document_kind, tax_code) do nothing;

-- 6. Echeances declaratives
insert into ref.pack_rules (pack_version_id, jurisdiction, kind, label, cadence, day_of_month, month_offset, legal_reference, valid_from)
select p.id, 'TN', r.kind, r.label, r.cadence, r.dom, r.moff, r.ref, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('tva_mensuelle_personne_morale', 'Declaration mensuelle de TVA (personne morale)', 'monthly', 28, 1, 'Code TVA, art. 9'),
    ('tva_mensuelle_personne_physique','Declaration mensuelle de TVA (personne physique)','monthly',15, 1, 'Code TVA, art. 9'),
    ('retenue_source_mensuelle',       'Reversement des retenues a la source',           'monthly', 28, 1, 'Code IRPP/IS, art. 52'),
    ('acompte_provisionnel',           'Acompte provisionnel',                           'quarterly',28, 1, 'Code IRPP/IS, art. 51'),
    ('declaration_annuelle_is',        'Declaration annuelle de resultat',               'yearly',  25, 3, 'Code IRPP/IS, art. 60'),
    ('declaration_employeur',          'Declaration de l''employeur',                    'yearly',  30, 4, 'Code IRPP/IS, art. 55')
  ) as r(kind, label, cadence, dom, moff, ref)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, kind, valid_from) do nothing;

-- 7. Motifs de retour gouvernes
insert into ref.rejet_motifs (code, severity, requires_note, sort_order)
values
  ('piece_illisible',        'bloquant',      false, 10),
  ('montant_incoherent',     'bloquant',      false, 20),
  ('mention_legale_absente', 'bloquant',      true,  30),
  ('taux_tva_inapproprie',   'bloquant',      false, 40),
  ('non_deductible',         'bloquant',      true,  50),
  ('doublon',                'bloquant',      false, 60),
  ('hors_exercice',          'bloquant',      false, 70),
  ('justificatif_manquant',  'avertissement', true,  80),
  ('imputation_a_revoir',    'avertissement', true,  90)
on conflict (code) do nothing;

-- 8. Libelles traduits (fr/en/ar)
insert into ref.labels (ns, key, locale, value) values
  ('tva_rate','TVA19','fr','TVA 19%'), ('tva_rate','TVA19','en','VAT 19%'), ('tva_rate','TVA19','ar','الأداء على القيمة المضافة 19%'),
  ('tva_rate','TVA13','fr','TVA 13%'), ('tva_rate','TVA13','en','VAT 13%'), ('tva_rate','TVA13','ar','الأداء على القيمة المضافة 13%'),
  ('tva_rate','TVA07','fr','TVA 7%'),  ('tva_rate','TVA07','en','VAT 7%'),  ('tva_rate','TVA07','ar','الأداء على القيمة المضافة 7%'),
  ('tva_rate','EXO','fr','Exonéré'),   ('tva_rate','EXO','en','Exempt'),    ('tva_rate','EXO','ar','معفى'),
  ('tva_rate','EXPORT','fr','Export'), ('tva_rate','EXPORT','en','Export'), ('tva_rate','EXPORT','ar','تصدير'),

  ('mention','IDENT_FISCAL_EMETTEUR','fr','Identifiant fiscal de l''émetteur'),
  ('mention','IDENT_FISCAL_EMETTEUR','en','Supplier tax identification number'),
  ('mention','IDENT_FISCAL_EMETTEUR','ar','المعرف الجبائي للمزود'),
  ('mention','IDENT_FISCAL_CLIENT','fr','Identifiant fiscal du client'),
  ('mention','IDENT_FISCAL_CLIENT','en','Customer tax identification number'),
  ('mention','IDENT_FISCAL_CLIENT','ar','المعرف الجبائي للحريف'),
  ('mention','DATE_FACTURE','fr','Date de la facture'), ('mention','DATE_FACTURE','en','Invoice date'), ('mention','DATE_FACTURE','ar','تاريخ الفاتورة'),
  ('mention','NUMERO_SEQUENTIEL','fr','Numéro séquentiel'), ('mention','NUMERO_SEQUENTIEL','en','Sequential number'), ('mention','NUMERO_SEQUENTIEL','ar','رقم متسلسل'),
  ('mention','DESIGNATION','fr','Désignation'), ('mention','DESIGNATION','en','Description'), ('mention','DESIGNATION','ar','التسمية'),
  ('mention','BASE_HT','fr','Base hors taxes'), ('mention','BASE_HT','en','Taxable base'), ('mention','BASE_HT','ar','الأساس دون أداء'),
  ('mention','TAUX_TVA','fr','Taux de TVA'), ('mention','TAUX_TVA','en','VAT rate'), ('mention','TAUX_TVA','ar','نسبة الأداء'),
  ('mention','MONTANT_TVA','fr','Montant de la TVA'), ('mention','MONTANT_TVA','en','VAT amount'), ('mention','MONTANT_TVA','ar','مبلغ الأداء'),
  ('mention','TOTAL_TTC','fr','Total TTC'), ('mention','TOTAL_TTC','en','Total incl. VAT'), ('mention','TOTAL_TTC','ar','المجموع بالأداء'),
  ('mention','TIMBRE_FISCAL','fr','Droit de timbre'), ('mention','TIMBRE_FISCAL','en','Stamp duty'), ('mention','TIMBRE_FISCAL','ar','معلوم الطابع الجبائي'),
  ('mention','MENTION_EXONERATION','fr','Mention d''exonération'), ('mention','MENTION_EXONERATION','en','Exemption statement'), ('mention','MENTION_EXONERATION','ar','بيان الإعفاء'),
  ('mention','RETENUE_SOURCE','fr','Retenue à la source'), ('mention','RETENUE_SOURCE','en','Withholding tax'), ('mention','RETENUE_SOURCE','ar','الخصم من المورد'),

  ('rejet_motif','piece_illisible','fr','Pièce illisible'), ('rejet_motif','piece_illisible','en','Unreadable document'), ('rejet_motif','piece_illisible','ar','وثيقة غير مقروءة'),
  ('rejet_motif','montant_incoherent','fr','Montant incohérent'), ('rejet_motif','montant_incoherent','en','Inconsistent amount'), ('rejet_motif','montant_incoherent','ar','مبلغ غير متناسق'),
  ('rejet_motif','mention_legale_absente','fr','Mention légale manquante'), ('rejet_motif','mention_legale_absente','en','Missing legal statement'), ('rejet_motif','mention_legale_absente','ar','بيان قانوني ناقص'),
  ('rejet_motif','taux_tva_inapproprie','fr','Taux de TVA inapproprié'), ('rejet_motif','taux_tva_inapproprie','en','Incorrect VAT rate'), ('rejet_motif','taux_tva_inapproprie','ar','نسبة أداء غير ملائمة'),
  ('rejet_motif','non_deductible','fr','Dépense non déductible'), ('rejet_motif','non_deductible','en','Non-deductible expense'), ('rejet_motif','non_deductible','ar','مصروف غير قابل للخصم'),
  ('rejet_motif','doublon','fr','Doublon'), ('rejet_motif','doublon','en','Duplicate'), ('rejet_motif','doublon','ar','تكرار'),
  ('rejet_motif','hors_exercice','fr','Hors exercice'), ('rejet_motif','hors_exercice','en','Outside fiscal year'), ('rejet_motif','hors_exercice','ar','خارج السنة المحاسبية'),
  ('rejet_motif','justificatif_manquant','fr','Justificatif manquant'), ('rejet_motif','justificatif_manquant','en','Missing supporting document'), ('rejet_motif','justificatif_manquant','ar','مؤيد ناقص'),
  ('rejet_motif','imputation_a_revoir','fr','Imputation à revoir'), ('rejet_motif','imputation_a_revoir','en','Account allocation to review'), ('rejet_motif','imputation_a_revoir','ar','تخصيص حسابي للمراجعة')
on conflict (ns, key, locale) do nothing;

-- 9. Vues d'exposition en lecture seule (Data API)
create or replace view public.ref_packs_v with (security_invoker = true) as
  select id, jurisdiction, version, effective_from, effective_to, source,
         (validated_by is not null) as ratified, validated_at
    from ref.jurisdiction_packs;

create or replace view public.ref_tva_rates_v with (security_invoker = true) as
  select id, pack_version_id, code, label, rate, valid_from, valid_to, legal_reference
    from ref.tva_rates;

create or replace view public.ref_accounts_v with (security_invoker = true) as
  select id, pack_version_id, account_code, label, parent_code, account_class
    from ref.accounts;

create or replace view public.ref_mentions_v with (security_invoker = true) as
  select id, pack_version_id, code, label, mandatory, legal_reference
    from ref.mentions;

create or replace view public.ref_account_mappings_v with (security_invoker = true) as
  select id, pack_version_id, document_kind, tax_code, main_account, vat_account, counterparty_account
    from ref.account_mappings;

create or replace view public.ref_pack_rules_v with (security_invoker = true) as
  select id, pack_version_id, jurisdiction, kind, label, cadence, day_of_month, month_offset,
         legal_reference, valid_from, valid_to
    from ref.pack_rules;

create or replace view public.ref_rejet_motifs_v with (security_invoker = true) as
  select id, code, severity, requires_note, sort_order, active, valid_from, valid_to
    from ref.rejet_motifs;

create or replace view public.ref_labels_v with (security_invoker = true) as
  select id, ns, key, locale, value from ref.labels;

do $$
declare v text;
begin
  foreach v in array array['ref_packs_v','ref_tva_rates_v','ref_accounts_v','ref_mentions_v',
                           'ref_account_mappings_v','ref_pack_rules_v','ref_rejet_motifs_v','ref_labels_v'] loop
    execute format('revoke all on table public.%I from public, anon, service_role', v);
    execute format('grant select on table public.%I to authenticated', v);
  end loop;
end $$;