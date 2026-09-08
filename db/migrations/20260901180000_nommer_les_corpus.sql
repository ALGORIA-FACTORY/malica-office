-- ============================================================================
-- Nommer les corpus : « CDPF » devient « code des droits et procédures fiscaux »
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Rien en base ne disait ce que « CDPF » veut dire. Deux conséquences, et la
-- seconde est la plus grave.
--
-- La première se voit : Malica écrivait « CDPF art. 89 » à un dirigeant de
-- PME qui n'a aucune raison de connaître cette abréviation.
--
-- La seconde ne se voit pas : quand elle écrit correctement « code des droits
-- et procédures fiscaux, art. 89 », AUCUN contrôle automatique ne peut
-- rattacher cette phrase à l'article en base pour vérifier qu'il existe et
-- qu'il est en vigueur. La citation devient invérifiable au moment même où
-- elle devient lisible.
--
-- Cette table est donc le pont : elle sert à Malica pour nommer, et aux
-- contrôles pour reconnaître.
--
-- ==================================================== CE QU'ELLE NE FAIT PAS
--
-- Elle n'invente aucun nom. Un corpus dont le titre n'a pas été vérifié dans
-- son propre texte reste sans nom : `nom_fr` est nul, et l'affichage retombe
-- sur le code. Un nom approximatif serait pire que pas de nom — il ferait
-- citer par Malica un code qui n'existe pas sous ce titre.
--
-- ============================================================= LES FAMILLES
--
-- Quatre familles suivent un motif régulier — lois de finances, lois de
-- finances complémentaires, décrets-lois de finances, notes communes, et les
-- conventions fiscales par pays. Leur nom se compose plutôt que de s'écrire
-- une centaine de fois à la main, et un corpus ajouté demain hérite du motif
-- sans qu'on y touche.
-- ============================================================================

create table if not exists legal.corpus_noms (
  code       text primary key,
  -- Nul tant que le titre n'a pas été vérifié dans le texte du corpus lui-même.
  nom_fr     text,
  nom_ar     text,
  -- À quoi ce corpus appartient : un code, une loi annuelle, de la doctrine,
  -- une convention. Sert à composer un nom et à trier une liste.
  famille    text not null,
  created_at timestamptz not null default now(),
  constraint corpus_noms_famille_check
    check (famille in ('code', 'loi', 'loi_finances', 'doctrine', 'convention', 'recueil'))
);

alter table legal.corpus_noms enable row level security;
alter table legal.corpus_noms force row level security;

-- Le droit tunisien n'appartient à personne : même politique que les articles.
drop policy if exists legal_corpus_noms_sel on legal.corpus_noms;
create policy legal_corpus_noms_sel on legal.corpus_noms for select to authenticated
  using (true);

grant select on legal.corpus_noms to authenticated;

-- ---------------------------------------------------------------- les codes
--
-- Chaque titre ci-dessous a été relu dans l'article premier du corpus
-- correspondant, pas déduit de son sigle.
insert into legal.corpus_noms (code, nom_fr, nom_ar, famille) values
  ('CTVA',        'code de la taxe sur la valeur ajoutée',                    'مجلة الأداء على القيمة المضافة', 'code'),
  ('CDPF',        'code des droits et procédures fiscaux',                    'مجلة الحقوق والإجراءات الجبائية', 'code'),
  ('CDET',        'code des droits d''enregistrement et de timbre',           'مجلة معاليم التسجيل والطابع الجبائي', 'code'),
  ('CIRPPIS',     'code de l''impôt sur le revenu des personnes physiques et de l''impôt sur les sociétés',
                                                                              'مجلة الضريبة على دخل الأشخاص الطبيعيين والضريبة على الشركات', 'code'),
  ('CFL',         'code de la fiscalité locale',                              'مجلة الجباية المحلية', 'code'),
  ('CII',         'code d''incitation aux investissements',                   'مجلة تشجيع الاستثمارات', 'code'),
  ('CCP',         'code de la comptabilité publique',                         'مجلة المحاسبة العمومية', 'code'),
  ('CSC',         'code des sociétés commerciales',                           'مجلة الشركات التجارية', 'code'),
  ('CCOM',        'code de commerce',                                         'المجلة التجارية', 'code'),
  ('COC',         'code des obligations et des contrats',                     'مجلة الالتزامات والعقود', 'code'),
  ('CTRAV',       'code du travail',                                          'مجلة الشغل', 'code'),
  ('SCE',         'loi relative au système comptable des entreprises',        'القانون المتعلق بنظام المحاسبة للمؤسسات', 'loi'),
  ('INVEST',      'loi relative à la promotion de l''investissement',         'القانون المتعلق بالنهوض بالاستثمار', 'loi'),
  -- Même texte que INVEST, article pour article. Le doublon est signalé dans
  -- `docs/`, pas résolu ici : fusionner deux corpus déplacerait des articles
  -- déjà cités par des fragments encodés.
  ('INCITATIONS', 'loi relative à la promotion de l''investissement',         'القانون المتعلق بالنهوض بالاستثمار', 'loi'),
  -- Recueil de textes divers, majoritairement en arabe, sans titre propre
  -- vérifiable. Il garde son code faute d'un nom qui soit vrai.
  ('RECUEIL',     null,                                                        null, 'recueil')
on conflict (code) do nothing;

-- ------------------------------------------------------- les familles réglées
--
-- On compose au lieu d'écrire cent cinquante lignes. Le `select` balaie les
-- corpus réellement présents : un corpus absent ne reçoit pas de nom, et un
-- corpus ajouté demain le recevra au prochain rejeu.
insert into legal.corpus_noms (code, nom_fr, nom_ar, famille)
select distinct a.corpus,
       case
         when a.corpus like 'LF-%'  then 'loi de finances ' || right(a.corpus, 4)
         when a.corpus like 'LFC-%' then 'loi de finances complémentaire ' || right(a.corpus, 4)
         when a.corpus like 'DECRET_LOI_FINANCES-%'
                                    then 'décret-loi de finances ' || right(a.corpus, 4)
         when a.corpus like 'NC-%'  then 'notes communes ' || right(a.corpus, 4)
         when a.corpus like 'CONV-%'
           then 'convention fiscale Tunisie–' ||
                initcap(replace(lower(substring(a.corpus from 6)), '-', ' '))
       end,
       case
         when a.corpus like 'LF-%'  then 'قانون المالية ' || right(a.corpus, 4)
         when a.corpus like 'LFC-%' then 'قانون المالية التكميلي ' || right(a.corpus, 4)
         when a.corpus like 'DECRET_LOI_FINANCES-%'
                                    then 'مرسوم قانون المالية ' || right(a.corpus, 4)
         when a.corpus like 'NC-%'  then 'المذكرات العامة ' || right(a.corpus, 4)
         when a.corpus like 'CONV-%' then 'اتفاقية جبائية'
       end,
       case
         when a.corpus like 'NC-%'   then 'doctrine'
         when a.corpus like 'CONV-%' then 'convention'
         else 'loi_finances'
       end
  from legal.articles a
 where a.corpus like 'LF-%' or a.corpus like 'LFC-%'
    or a.corpus like 'DECRET_LOI_FINANCES-%' or a.corpus like 'NC-%'
    or a.corpus like 'CONV-%'
on conflict (code) do nothing;
