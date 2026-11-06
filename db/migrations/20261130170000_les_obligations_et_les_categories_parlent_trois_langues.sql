-- ======================================================================
--  Les obligations et les catégories d'immobilisation parlent trois langues
--  (5 novembre 2026).
--
--  Relevé sur staging : en arabe, l'écran des échéances et celui des
--  immobilisations restaient en français — « Déclaration mensuelle TVA »,
--  « Matériel informatique ». `ref.fiscal_obligations.libelle` et
--  `ref.immo_categories.label` sont le français ; les deux autres langues
--  n'existaient nulle part (R12 : un code du référentiel a son libellé en fr,
--  en et ar).
--
--  `ref.labels`, espaces `fiscal_obligation` et `immo_categorie` : le français
--  reprend le libellé du référentiel mot pour mot ; l'anglais et l'arabe sont
--  posés ici. L'API les lit dans la langue demandée, le français à défaut.
--
--  INCERTAIN : les intitulés arabes suivent la terminologie usuelle de
--  l'administration fiscale tunisienne ; à relire par un fiscaliste
--  arabophone.
-- ======================================================================

begin;

insert into ref.labels (ns, key, locale, value)
select distinct 'fiscal_obligation', o.code, 'fr', o.libelle
  from ref.fiscal_obligations o
on conflict (ns, key, locale) do nothing;

insert into ref.labels (ns, key, locale, value)
select 'fiscal_obligation', t.code, t.locale, t.valeur
  from (values
    ('ACOMPTE_PM', 'en', 'Provisional instalments (3 instalments)'),
    ('ACOMPTE_PM', 'ar', 'التسبقات الاحتياطية (3 أقساط)'),
    ('ACOMPTE_PP', 'en', 'Provisional instalments (3 instalments)'),
    ('ACOMPTE_PP', 'ar', 'التسبقات الاحتياطية (3 أقساط)'),
    ('CNSS_DECL', 'en', 'Quarterly CNSS wage declaration'),
    ('CNSS_DECL', 'ar', 'التصريح الثلاثي بالأجور لدى الصندوق الوطني للضمان الاجتماعي'),
    ('CNSS_PAIEMENT', 'en', 'Payment of CNSS contributions'),
    ('CNSS_PAIEMENT', 'ar', 'دفع اشتراكات الصندوق الوطني للضمان الاجتماعي'),
    ('DECL_CESSION', 'en', 'Declaration of total transfer or cessation of business'),
    ('DECL_CESSION', 'ar', 'التصريح بالإحالة أو بالتوقف الكلي عن النشاط'),
    ('DECL_DECES', 'en', 'Declaration upon death'),
    ('DECL_DECES', 'ar', 'التصريح في حالة الوفاة'),
    ('DECL_DEPART', 'en', 'Declaration before leaving Tunisia'),
    ('DECL_DEPART', 'ar', 'التصريح قبل مغادرة البلاد التونسية'),
    ('DECL_EMPLOYEUR', 'en', 'Employer''s declaration (amounts subject to withholding and invoiced advances)'),
    ('DECL_EMPLOYEUR', 'ar', 'تصريح المؤجر (المبالغ الخاضعة للخصم من المورد والتسبقات المفوترة)'),
    ('DECL_EXISTENCE', 'en', 'Declaration of existence'),
    ('DECL_EXISTENCE', 'ar', 'التصريح بالوجود'),
    ('DECL_MODIF', 'en', 'Filing of amending deeds (articles, registered office, capital, appropriation of profits)'),
    ('DECL_MODIF', 'ar', 'إيداع العقود المغيّرة (النظام الأساسي، المقر، رأس المال، تخصيص النتائج)'),
    ('FOPROLOS_PM', 'en', 'FOPROLOS contribution return'),
    ('FOPROLOS_PM', 'ar', 'التصريح بالمساهمة في صندوق النهوض بالمسكن لفائدة الأجراء'),
    ('FOPROLOS_PP', 'en', 'FOPROLOS contribution return'),
    ('FOPROLOS_PP', 'ar', 'التصريح بالمساهمة في صندوق النهوض بالمسكن لفائدة الأجراء'),
    ('FORFAIT_OPT', 'en', 'Annual return of the optional flat-rate tax'),
    ('FORFAIT_OPT', 'ar', 'التصريح السنوي بالضريبة التقديرية الاختيارية'),
    ('IFORTUNE', 'en', 'Wealth tax return'),
    ('IFORTUNE', 'ar', 'التصريح بالضريبة على الثروة'),
    ('IRPP_AGRI', 'en', 'Annual personal income tax return'),
    ('IRPP_AGRI', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين'),
    ('IRPP_ARTIS', 'en', 'Annual personal income tax return'),
    ('IRPP_ARTIS', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين'),
    ('IRPP_COMM', 'en', 'Annual personal income tax return'),
    ('IRPP_COMM', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين'),
    ('IRPP_NONCAL', 'en', 'Annual personal income tax return, non-calendar financial year'),
    ('IRPP_NONCAL', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين، سنة محاسبية غير مدنية'),
    ('IRPP_RCM', 'en', 'Annual personal income tax return'),
    ('IRPP_RCM', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين'),
    ('IRPP_SAL', 'en', 'Annual personal income tax return'),
    ('IRPP_SAL', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين'),
    ('IRPP_SERV', 'en', 'Annual personal income tax return'),
    ('IRPP_SERV', 'ar', 'التصريح السنوي بالضريبة على دخل الأشخاص الطبيعيين'),
    ('IS_PM', 'en', 'Annual corporate income tax return'),
    ('IS_PM', 'ar', 'التصريح السنوي بالضريبة على الشركات'),
    ('IS_PM_PROV', 'en', 'Amendment of the provisional corporate income tax return'),
    ('IS_PM_PROV', 'ar', 'تعديل التصريح الوقتي بالضريبة على الشركات'),
    ('PLUSVALUE', 'en', 'Capital gains declaration (transfers under art. 27-2 and 27-3)'),
    ('PLUSVALUE', 'ar', 'التصريح بالقيمة الزائدة (الإحالات طبق الفصل 27-2 و27-3)'),
    ('PRIX_TRANSFERT', 'en', 'Annual transfer pricing declaration'),
    ('PRIX_TRANSFERT', 'ar', 'التصريح السنوي بأسعار التحويل'),
    ('RS_FORF_TRIM', 'en', 'Payment of taxes withheld at source'),
    ('RS_FORF_TRIM', 'ar', 'دفع الخصوم من المورد'),
    ('RS_PM', 'en', 'Payment of taxes withheld at source'),
    ('RS_PM', 'ar', 'دفع الخصوم من المورد'),
    ('RS_PM_EDI', 'en', 'Payment of taxes withheld at source'),
    ('RS_PM_EDI', 'ar', 'دفع الخصوم من المورد'),
    ('RS_PP', 'en', 'Payment of taxes withheld at source'),
    ('RS_PP', 'ar', 'دفع الخصوم من المورد'),
    ('RS_TAXI_SEM', 'en', 'Payment of taxes withheld at source'),
    ('RS_TAXI_SEM', 'ar', 'دفع الخصوم من المورد'),
    ('TCL_PM', 'en', 'TCL return'),
    ('TCL_PM', 'ar', 'التصريح بالمعلوم على المؤسسات ذات الصبغة الصناعية أو التجارية أو المهنية'),
    ('TCL_PM_EDI', 'en', 'TCL return'),
    ('TCL_PM_EDI', 'ar', 'التصريح بالمعلوم على المؤسسات ذات الصبغة الصناعية أو التجارية أو المهنية'),
    ('TCL_PP', 'en', 'TCL return (industrial, commercial or professional establishments)'),
    ('TCL_PP', 'ar', 'التصريح بالمعلوم على المؤسسات ذات الصبغة الصناعية أو التجارية أو المهنية'),
    ('TCL_TRIM', 'en', 'TCL return'),
    ('TCL_TRIM', 'ar', 'التصريح بالمعلوم على المؤسسات ذات الصبغة الصناعية أو التجارية أو المهنية'),
    ('TFP_PM', 'en', 'Vocational training tax return'),
    ('TFP_PM', 'ar', 'التصريح بالمعلوم على التكوين المهني'),
    ('TFP_PP', 'en', 'Vocational training tax return'),
    ('TFP_PP', 'ar', 'التصريح بالمعلوم على التكوين المهني'),
    ('TFP_TRIM', 'en', 'Vocational training tax return'),
    ('TFP_TRIM', 'ar', 'التصريح بالمعلوم على التكوين المهني'),
    ('TIMBRE_PM', 'en', 'Return of stamp duty on declarations'),
    ('TIMBRE_PM', 'ar', 'التصريح بمعلوم الطابع الجبائي على التصاريح'),
    ('TIMBRE_PM_EDI', 'en', 'Return of stamp duty on declarations'),
    ('TIMBRE_PM_EDI', 'ar', 'التصريح بمعلوم الطابع الجبائي على التصاريح'),
    ('TIMBRE_PP', 'en', 'Return of stamp duty on declarations'),
    ('TIMBRE_PP', 'ar', 'التصريح بمعلوم الطابع الجبائي على التصاريح'),
    ('TVA_PM', 'en', 'Monthly VAT return'),
    ('TVA_PM', 'ar', 'التصريح الشهري بالأداء على القيمة المضافة'),
    ('TVA_PM_EDI', 'en', 'Monthly VAT return'),
    ('TVA_PM_EDI', 'ar', 'التصريح الشهري بالأداء على القيمة المضافة'),
    ('TVA_PP', 'en', 'Monthly VAT return'),
    ('TVA_PP', 'ar', 'التصريح الشهري بالأداء على القيمة المضافة')
  ) as t (code, locale, valeur)
 where exists (select 1 from ref.fiscal_obligations o where o.code = t.code)
on conflict (ns, key, locale) do nothing;

insert into ref.labels (ns, key, locale, value)
select distinct on (c.code) 'immo_categorie', c.code, 'fr', c.label
  from ref.immo_categories c
 order by c.code, c.valid_from desc
on conflict (ns, key, locale) do nothing;

insert into ref.labels (ns, key, locale, value)
select 'immo_categorie', t.code, t.locale, t.valeur
  from (values
    ('agencements', 'en', 'Fixtures and installations'),
    ('agencements', 'ar', 'التهيئة والتركيبات'),
    ('constructions', 'en', 'Buildings'),
    ('constructions', 'ar', 'البناءات'),
    ('informatique', 'en', 'IT equipment'),
    ('informatique', 'ar', 'المعدات الإعلامية'),
    ('logiciels', 'en', 'Software and licences'),
    ('logiciels', 'ar', 'البرمجيات والإجازات'),
    ('materiel', 'en', 'Industrial equipment and tools'),
    ('materiel', 'ar', 'المعدات والأدوات الصناعية'),
    ('mobilier', 'en', 'Office furniture'),
    ('mobilier', 'ar', 'أثاث المكاتب'),
    ('vehicules', 'en', 'Transport equipment'),
    ('vehicules', 'ar', 'معدات النقل')
  ) as t (code, locale, valeur)
 where exists (select 1 from ref.immo_categories c where c.code = t.code)
on conflict (ns, key, locale) do nothing;

commit;
