-- Les experts de lecture lisent la base (16 novembre 2026).
--
-- POURQUOI. Le sudoku prouve les MONTANTS d'une pièce. Les autres champs (dates,
-- identifiants, références, libellés, mentions) étaient lus par du code qui
-- portait son vocabulaire en dur : les noms de mois et l'ordre jour/mois/année
-- dans `normalizeDate` (token-plan.ts), la forme du matricule fiscal tunisien
-- et ses étiquettes dans `packages/socle/src/matricule.ts`. Et le montant en
-- toutes lettres n'était lu par personne : la facture fictive 100/D-04 imprime
-- « trois mille deux cents dinars » sous un net de 9 676,890, et elle sortait
-- PROUVÉE.
--
-- CE QUE FAIT CETTE MIGRATION. Rien n'est réécrit : l'existant devient
-- paramétrable, et son paramètre vit ici, daté, par pack (R4, R5, R10).
--
--   1. LA DATE. `ref.conventions_de_date` : l'ordre d'une date numérique (jma),
--      le siècle d'une année à deux chiffres, et si une date en lettres peut
--      l'abréger. `ref.mois_en_lettres` : les noms de mois, en fr et en ar
--      (Maghreb et Machrek), tels que `normalizeDate` les portait.
--   2. L'IDENTIFIANT. `ref.identifiant_formats` gagne la forme de LECTURE du
--      matricule (noyau de chiffres, groupes qui suivent la lettre de contrôle,
--      séparateur, étiquettes à retirer) : `normaliserMatricule` la reçoit. La
--      lettre de contrôle a sa règle, `ref.identifiant_controles` : la somme
--      pondérée 7..1 des sept chiffres, modulo 23, sur ABCDEFGHJKLMNPQRSTVWXYZ.
--      La DGI ne la publie pas : statut `defaut_a_valider`, source `incertain`.
--      DÉCISION du dirigeant (1er novembre 2026) : elle AVERTIT, ne bloque pas
--      (`effet = 'avertit'`) — docs/sudoku/sources-reglementaires-2026-11-01.md.
--   3. LE MONTANT EN LETTRES. `ref.nombres_en_lettres` (les mots des nombres, fr
--      et ar, et leur nature : nombre, centaine, multiplicateur, liaison,
--      préfixe) et `ref.devises_en_lettres` (les unités d'une devise de
--      `ref.devises` : majeure, mineure, qualificatif). La preuve `lettres` de la
--      grille facture (P13) et celle du chèque (P04, jusqu'ici `a_traduire`)
--      deviennent exécutables : le moteur compare le montant que l'adaptateur a
--      lu en lettres au total prouvé. S'ils diffèrent, la pièce n'est plus
--      prouvée : elle est SIGNALÉE (`issue = 'signalee'`). C'est la seule preuve
--      non arithmétique qui change l'issue du sudoku.
--   4. CE QUI EST LU. `capture.champs_lus` accepte l'issue `signalee` et porte
--      un `avertissement` (clé vers `ref.avertissements_de_lecture`, libellé en
--      fr, en, ar) : la lettre de contrôle discordante d'un matricule bien formé.
--      La famille d'experts et le rôle d'un champ ne sont PAS recopiés : ils se
--      lisent par `grille_champ_id` → `ref.grille_champs.role` et
--      `ref.concepts.expert` (R12, aucun doublon de vérité).
--
-- REJEU (R11) : dates en littéral ; aucune horloge n'écrit dans `ref`.

begin;

-- ===================================================================== 1. LA DATE

create table ref.conventions_de_date (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id) on delete cascade,
  -- L'ordre d'une date NUMÉRIQUE : jour-mois-année, mois-jour-année, année-mois-jour.
  -- Une date ISO (AAAA-MM-JJ) se lit toujours : elle dit son ordre.
  ordre text not null check (ordre in ('jma', 'mja', 'amj')),
  -- Le siècle d'une année numérique à deux chiffres (20 : « 26 » est 2026) ; nul :
  -- une année à deux chiffres n'est pas une date.
  siecle_des_annees_courtes smallint check (siecle_des_annees_courtes between 1 and 99),
  -- Une date en lettres peut-elle abréger son année (« 15 mars 26 ») ?
  annees_courtes_en_lettres boolean not null,
  -- Ce qui suit le premier jour du mois dans une date en lettres (« 1er », « 1re »).
  suffixes_ordinaux text[] not null,
  statut text not null check (statut in ('defaut_a_valider', 'arrete')),
  source_fondement text not null check (source_fondement in ('texte', 'pratique', 'incertain')),
  fondement text not null check (length(btrim(fondement)) > 0),
  valid_from date not null,
  valid_to date,
  constraint conventions_de_date_pack_debut_key unique (pack_version_id, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

comment on table ref.conventions_de_date is
  'Comment une date se lit sur une pièce du pack : l''ordre d''une date numérique, le siècle '
  'd''une année à deux chiffres. Lu par normalizeDate (apps/api/src/malica/lecture/token-plan.ts).';

create table ref.mois_en_lettres (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id) on delete cascade,
  langue text not null check (langue in ('fr', 'ar')),
  -- Le nom tel qu'il s'imprime ; le lecteur le compare sans accents, sans casse,
  -- sans tashkeel ni hamza.
  nom text not null check (length(btrim(nom)) > 0),
  mois smallint not null check (mois between 1 and 12),
  valid_from date not null,
  valid_to date,
  constraint mois_en_lettres_pack_nom_debut_key unique (pack_version_id, nom, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

comment on table ref.mois_en_lettres is
  'Les noms de mois qu''une date en lettres peut porter (« 1er septembre 2026 », '
  '« ١٥ سبتمبر ٢٠٢٦ »), par langue. L''arabe porte les deux séries : Maghreb (جانفي) et Machrek (يناير).';

insert into ref.conventions_de_date
  (pack_version_id, ordre, siecle_des_annees_courtes, annees_courtes_en_lettres,
   suffixes_ordinaux, statut, source_fondement, fondement, valid_from)
select p.id, 'jma', 20, false, array['er', 're'], 'defaut_a_valider', 'pratique',
       'Usage tunisien et français : jour, mois, année. Une date numérique ne bascule jamais en '
       'mois/jour quand le premier nombre dépasse 12 : une date qui n''existe pas est demandée. '
       'Une date en lettres exige quatre chiffres d''année : choisir un siècle au jugé dans une '
       'phrase est une écriture fausse. Repris de normalizeDate (4 octobre 2026).',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1';

insert into ref.mois_en_lettres (pack_version_id, langue, nom, mois, valid_from)
select p.id, m.langue, m.nom, m.mois, date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('fr', 'janvier', 1), ('fr', 'février', 2), ('fr', 'mars', 3), ('fr', 'avril', 4),
   ('fr', 'mai', 5), ('fr', 'juin', 6), ('fr', 'juillet', 7), ('fr', 'août', 8),
   ('fr', 'septembre', 9), ('fr', 'octobre', 10), ('fr', 'novembre', 11), ('fr', 'décembre', 12),
   -- Arabe du Maghreb.
   ('ar', 'جانفي', 1), ('ar', 'فيفري', 2), ('ar', 'أفريل', 4), ('ar', 'ماي', 5),
   ('ar', 'جوان', 6), ('ar', 'جويلية', 7), ('ar', 'أوت', 8),
   -- Arabe du Machrek.
   ('ar', 'يناير', 1), ('ar', 'فبراير', 2), ('ar', 'أبريل', 4), ('ar', 'مايو', 5),
   ('ar', 'يونيو', 6), ('ar', 'يوليو', 7), ('ar', 'أغسطس', 8),
   -- Communs aux deux.
   ('ar', 'مارس', 3), ('ar', 'سبتمبر', 9), ('ar', 'أكتوبر', 10), ('ar', 'نوفمبر', 11),
   ('ar', 'ديسمبر', 12)
 ) as m(langue, nom, mois)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- ============================================================== 2. L'IDENTIFIANT

-- La forme de LECTURE d'un identifiant, à côté de son motif de VALIDATION
-- (`pattern`, lu par `public.identifiant_verifier` à la saisie d'une fiche).
-- Le motif dit ce qui est valide ; la forme dit comment le retrouver dans ce que
-- l'œil a vu (étiquette collée, chiffres arabes, « l » pour « 1 », séparateurs).
alter table ref.identifiant_formats
  add column noyau_chiffres smallint check (noyau_chiffres between 1 and 20),
  add column groupes text[],
  add column separateur text check (separateur is null or length(separateur) = 1),
  add column etiquettes text[],
  add constraint identifiant_formats_forme_entiere check (
    (noyau_chiffres is null) = (groupes is null)
    and (noyau_chiffres is null) = (separateur is null)
    and (noyau_chiffres is null) = (etiquettes is null)),
  add constraint identifiant_formats_groupes_lisibles check (
    groupes is null
    or (cardinality(groupes) between 1 and 8
        and array_to_string(groupes, ',') ~ '^(lettre|[1-9][0-9]?)(,(lettre|[1-9][0-9]?))*$'));

comment on column ref.identifiant_formats.noyau_chiffres is
  'Forme de lecture : le nombre de chiffres du noyau (7 pour le matricule fiscal tunisien).';
comment on column ref.identifiant_formats.groupes is
  'Forme de lecture : les groupes qui suivent la lettre de contrôle — « lettre », ou un nombre '
  'de chiffres. Trois lettres puis les chiffres : la lettre de contrôle est là ; deux : elle manque.';
comment on column ref.identifiant_formats.separateur is
  'Forme de lecture : le séparateur de la forme pleine reconstituée.';
comment on column ref.identifiant_formats.etiquettes is
  'Forme de lecture : les étiquettes qui précèdent l''identifiant sur une pièce (expressions '
  'régulières JavaScript, lues sans casse), retirées avant la lecture.';

update ref.identifiant_formats f
   set noyau_chiffres = 7,
       groupes = array['lettre', 'lettre', '3'],
       separateur = '/',
       etiquettes = array[
         '\bmatricule\s*fiscal(e)?\b', '\bmatricule\b', '\bidentifiant\s*fiscal\b',
         '\bid\s*fiscal\b', '\bm\s*\.?\s*f\s*\.?', '\bn\s*[°º]?\s*fiscal\b', '\bcode\s*tva\b',
         'المعرف\s*ال?جبائ[يى]', 'رقم\s*ال?جبائ[يى]', 'م\s*\.?\s*ج\s*\.?']
 where f.kind = 'matricule_fiscal' and f.jurisdiction = 'TN';

create table ref.identifiant_controles (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id) on delete cascade,
  kind text not null check (length(btrim(kind)) > 0),
  -- La lettre attendue : alphabet[ (Σ poids[i] × chiffre[i]) mod modulo ].
  poids smallint[] not null check (cardinality(poids) between 1 and 20),
  modulo smallint not null check (modulo > 1),
  alphabet text not null,
  -- `avertit` : une lettre discordante se dit, la pièce passe ; `bloque` : elle refuse.
  effet text not null check (effet in ('avertit', 'bloque')),
  statut text not null check (statut in ('defaut_a_valider', 'arrete')),
  source_fondement text not null check (source_fondement in ('texte', 'pratique', 'incertain')),
  fondement text not null check (length(btrim(fondement)) > 0),
  valid_from date not null,
  valid_to date,
  constraint identifiant_controles_pack_kind_debut_key unique (pack_version_id, kind, valid_from),
  check (length(alphabet) = modulo),
  check (valid_to is null or valid_to >= valid_from)
);

comment on table ref.identifiant_controles is
  'La règle de la lettre de contrôle d''un identifiant, quand le pack en porte une. Défaut livré '
  'par Malica, non publié par l''administration : elle avertit, elle ne bloque pas.';

insert into ref.identifiant_controles
  (pack_version_id, kind, poids, modulo, alphabet, effet, statut, source_fondement, fondement,
   valid_from)
select p.id, 'matricule_fiscal', array[7, 6, 5, 4, 3, 2, 1]::smallint[], 23,
       'ABCDEFGHJKLMNPQRSTVWXYZ', 'avertit', 'defaut_a_valider', 'incertain',
       'La DGI ne publie pas l''algorithme. La somme pondérée 7 à 1 des sept chiffres, modulo 23, '
       'sur l''alphabet sans I, O ni U, retrouve la lettre de 146 des 150 matricules publics '
       'testés (docs/sudoku/sources-reglementaires-2026-11-01.md). Décision du dirigeant : la forme '
       'bloque, la lettre avertit — jusqu''à publication de l''algorithme.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- ======================================================== 3. LE MONTANT EN LETTRES

create table ref.nombres_en_lettres (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id) on delete cascade,
  langue text not null check (langue in ('fr', 'ar')),
  -- Le mot, ou un mot composé par traits d'union (« quatre-vingt »), tel qu'il
  -- s'imprime ; le lecteur le compare sans accents, sans casse, sans tashkeel.
  mot text not null check (length(btrim(mot)) > 0),
  -- nombre         : s'ajoute (« trois », « vingt », « خمسمائة ») ;
  -- centaine       : multiplie ce qui précède dans le groupe (« deux cents ») ;
  -- multiplicateur : ferme un groupe (« mille », « آلاف ») ;
  -- liaison        : ne compte pas (« et ») ;
  -- prefixe        : se retire d'un mot inconnu (« و » de « ومائتان »), ou ne compte pas seul.
  nature text not null check (nature in ('nombre', 'centaine', 'multiplicateur', 'liaison', 'prefixe')),
  valeur bigint not null check (valeur >= 0),
  valid_from date not null,
  valid_to date,
  constraint nombres_en_lettres_pack_mot_debut_key unique (pack_version_id, langue, mot, valid_from),
  check ((nature in ('liaison', 'prefixe')) = (valeur = 0) or (nature = 'nombre' and valeur = 0)),
  check (valid_to is null or valid_to >= valid_from)
);

comment on table ref.nombres_en_lettres is
  'Les mots d''un montant écrit en toutes lettres (« mille deux cent trente-quatre », '
  '« ألف ومائتان وأربعة وثلاثون »), par langue, avec leur nature. Lu par le lecteur des lettres.';

create table ref.devises_en_lettres (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs (id) on delete cascade,
  devise text not null references ref.devises (code),
  langue text not null check (langue in ('fr', 'ar')),
  mot text not null check (length(btrim(mot)) > 0),
  -- majeure : le dinar ; mineure : le millime (l'exposant vient de `ref.devises`) ;
  -- qualificatif : « tunisiens », qui suit l'unité et ne compte pas.
  unite text not null check (unite in ('majeure', 'mineure', 'qualificatif')),
  valid_from date not null,
  valid_to date,
  constraint devises_en_lettres_pack_mot_debut_key unique (pack_version_id, langue, mot, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

comment on table ref.devises_en_lettres is
  'Les unités monétaires d''un montant en lettres (dinars, millimes, دينارا, مليما), rattachées à '
  'leur devise de ref.devises : leur exposant met le montant en unités mineures.';

create index devises_en_lettres_devise_fk_idx on ref.devises_en_lettres (devise);

insert into ref.nombres_en_lettres (pack_version_id, langue, mot, nature, valeur, valid_from)
select p.id, m.langue, m.mot, m.nature, m.valeur, date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   -- Français.
   ('fr', 'zéro', 'nombre', 0), ('fr', 'un', 'nombre', 1), ('fr', 'une', 'nombre', 1),
   ('fr', 'deux', 'nombre', 2), ('fr', 'trois', 'nombre', 3), ('fr', 'quatre', 'nombre', 4),
   ('fr', 'cinq', 'nombre', 5), ('fr', 'six', 'nombre', 6), ('fr', 'sept', 'nombre', 7),
   ('fr', 'huit', 'nombre', 8), ('fr', 'neuf', 'nombre', 9), ('fr', 'dix', 'nombre', 10),
   ('fr', 'onze', 'nombre', 11), ('fr', 'douze', 'nombre', 12), ('fr', 'treize', 'nombre', 13),
   ('fr', 'quatorze', 'nombre', 14), ('fr', 'quinze', 'nombre', 15), ('fr', 'seize', 'nombre', 16),
   ('fr', 'vingt', 'nombre', 20), ('fr', 'vingts', 'nombre', 20), ('fr', 'trente', 'nombre', 30),
   ('fr', 'quarante', 'nombre', 40), ('fr', 'cinquante', 'nombre', 50),
   ('fr', 'soixante', 'nombre', 60), ('fr', 'septante', 'nombre', 70),
   ('fr', 'quatre-vingt', 'nombre', 80), ('fr', 'quatre-vingts', 'nombre', 80),
   ('fr', 'huitante', 'nombre', 80), ('fr', 'octante', 'nombre', 80),
   ('fr', 'nonante', 'nombre', 90),
   ('fr', 'cent', 'centaine', 100), ('fr', 'cents', 'centaine', 100),
   ('fr', 'mille', 'multiplicateur', 1000), ('fr', 'million', 'multiplicateur', 1000000),
   ('fr', 'millions', 'multiplicateur', 1000000),
   ('fr', 'milliard', 'multiplicateur', 1000000000),
   ('fr', 'milliards', 'multiplicateur', 1000000000),
   ('fr', 'et', 'liaison', 0),
   -- Arabe : unités (masculin, féminin, état construit).
   ('ar', 'صفر', 'nombre', 0), ('ar', 'واحد', 'nombre', 1), ('ar', 'واحدة', 'nombre', 1),
   ('ar', 'أحد', 'nombre', 1), ('ar', 'إحدى', 'nombre', 1),
   ('ar', 'اثنان', 'nombre', 2), ('ar', 'اثنين', 'nombre', 2), ('ar', 'اثنا', 'nombre', 2),
   ('ar', 'اثنتان', 'nombre', 2), ('ar', 'اثنتين', 'nombre', 2), ('ar', 'اثنتا', 'nombre', 2),
   ('ar', 'ثلاثة', 'nombre', 3), ('ar', 'ثلاث', 'nombre', 3),
   ('ar', 'أربعة', 'nombre', 4), ('ar', 'أربع', 'nombre', 4),
   ('ar', 'خمسة', 'nombre', 5), ('ar', 'خمس', 'nombre', 5),
   ('ar', 'ستة', 'nombre', 6), ('ar', 'ست', 'nombre', 6),
   ('ar', 'سبعة', 'nombre', 7), ('ar', 'سبع', 'nombre', 7),
   ('ar', 'ثمانية', 'nombre', 8), ('ar', 'ثماني', 'nombre', 8), ('ar', 'ثمان', 'nombre', 8),
   ('ar', 'تسعة', 'nombre', 9), ('ar', 'تسع', 'nombre', 9),
   ('ar', 'عشرة', 'nombre', 10), ('ar', 'عشر', 'nombre', 10),
   -- Arabe : dizaines (nominatif et cas oblique).
   ('ar', 'عشرون', 'nombre', 20), ('ar', 'عشرين', 'nombre', 20),
   ('ar', 'ثلاثون', 'nombre', 30), ('ar', 'ثلاثين', 'nombre', 30),
   ('ar', 'أربعون', 'nombre', 40), ('ar', 'أربعين', 'nombre', 40),
   ('ar', 'خمسون', 'nombre', 50), ('ar', 'خمسين', 'nombre', 50),
   ('ar', 'ستون', 'nombre', 60), ('ar', 'ستين', 'nombre', 60),
   ('ar', 'سبعون', 'nombre', 70), ('ar', 'سبعين', 'nombre', 70),
   ('ar', 'ثمانون', 'nombre', 80), ('ar', 'ثمانين', 'nombre', 80),
   ('ar', 'تسعون', 'nombre', 90), ('ar', 'تسعين', 'nombre', 90),
   -- Arabe : centaines, dans les deux graphies (مائة, مئة).
   ('ar', 'مائة', 'centaine', 100), ('ar', 'مئة', 'centaine', 100),
   ('ar', 'مائتان', 'nombre', 200), ('ar', 'مائتين', 'nombre', 200), ('ar', 'مائتا', 'nombre', 200),
   ('ar', 'مئتان', 'nombre', 200), ('ar', 'مئتين', 'nombre', 200), ('ar', 'مئتا', 'nombre', 200),
   ('ar', 'ثلاثمائة', 'nombre', 300), ('ar', 'ثلاثمئة', 'nombre', 300),
   ('ar', 'أربعمائة', 'nombre', 400), ('ar', 'أربعمئة', 'nombre', 400),
   ('ar', 'خمسمائة', 'nombre', 500), ('ar', 'خمسمئة', 'nombre', 500),
   ('ar', 'ستمائة', 'nombre', 600), ('ar', 'ستمئة', 'nombre', 600),
   ('ar', 'سبعمائة', 'nombre', 700), ('ar', 'سبعمئة', 'nombre', 700),
   ('ar', 'ثمانمائة', 'nombre', 800), ('ar', 'ثمانمئة', 'nombre', 800),
   ('ar', 'ثمانيمائة', 'nombre', 800),
   ('ar', 'تسعمائة', 'nombre', 900), ('ar', 'تسعمئة', 'nombre', 900),
   -- Arabe : milliers et millions.
   ('ar', 'ألف', 'multiplicateur', 1000), ('ar', 'آلاف', 'multiplicateur', 1000),
   ('ar', 'ألفا', 'multiplicateur', 1000),
   ('ar', 'ألفان', 'nombre', 2000), ('ar', 'ألفين', 'nombre', 2000),
   ('ar', 'مليون', 'multiplicateur', 1000000), ('ar', 'ملايين', 'multiplicateur', 1000000),
   ('ar', 'و', 'prefixe', 0)
 ) as m(langue, mot, nature, valeur)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

insert into ref.devises_en_lettres (pack_version_id, devise, langue, mot, unite, valid_from)
select p.id, m.devise, m.langue, m.mot, m.unite, date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('TND', 'fr', 'dinar', 'majeure'), ('TND', 'fr', 'dinars', 'majeure'),
   ('TND', 'fr', 'millime', 'mineure'), ('TND', 'fr', 'millimes', 'mineure'),
   ('TND', 'fr', 'tunisien', 'qualificatif'), ('TND', 'fr', 'tunisiens', 'qualificatif'),
   ('TND', 'ar', 'دينار', 'majeure'), ('TND', 'ar', 'دينارا', 'majeure'),
   ('TND', 'ar', 'دنانير', 'majeure'),
   ('TND', 'ar', 'مليم', 'mineure'), ('TND', 'ar', 'مليما', 'mineure'),
   ('TND', 'ar', 'مليمات', 'mineure'),
   ('TND', 'ar', 'تونسي', 'qualificatif'), ('TND', 'ar', 'تونسيا', 'qualificatif'),
   ('TND', 'ar', 'تونسية', 'qualificatif'),
   ('EUR', 'fr', 'euro', 'majeure'), ('EUR', 'fr', 'euros', 'majeure'),
   ('EUR', 'fr', 'centime', 'mineure'), ('EUR', 'fr', 'centimes', 'mineure'),
   ('EUR', 'ar', 'أورو', 'majeure'), ('EUR', 'ar', 'يورو', 'majeure')
 ) as m(devise, langue, mot, unite)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

-- La preuve : le montant lu en lettres égale un total prouvé.
alter table ref.grille_preuves drop constraint grille_preuves_expression_check;
alter table ref.grille_preuves add constraint grille_preuves_expression_check check (
  expression is null
  or (jsonb_typeof(expression) = 'object'
      and expression ->> 'op' in ('somme', 'produit', 'taux', 'groupe_taux', 'charge', 'egal',
                                  'format', 'ordre', 'lignes', 'parties', 'lettres')));

-- Facture : les lettres valent le TTC (timbre compris) ou le net à payer.
insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut)
select g.id, 'P13',
       'Montant en lettres = total TTC ou net à payer prouvé — preuve ajoutée par Malica ; '
       'discordant, la pièce est signalée, jamais prouvée',
       'recoupement',
       '{"op": "lettres", "champ": "montant_en_lettres", "egal_a": ["total_ttc", "net_a_payer?"]}',
       'defaut_a_valider'
  from ref.grilles g
 where g.code = 'facture';

-- Chèque : P04 était à traduire.
update ref.grille_preuves p
   set expression = '{"op": "lettres", "champ": "montant_lettres", "egal_a": ["montant_chiffres"]}',
       statut = 'defaut_a_valider'
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'cheque' and p.code = 'P04' and p.statut = 'a_traduire';

-- Les repères du montant en lettres de la facture : la formule varie (« la présente
-- pièce », « la présente facture », « Arrêté »), sa fin ne varie pas.
update ref.grille_champs c
   set reperes_fr = array['Arrêtée la présente facture à la somme de', 'à la somme de',
                          'Somme en lettres'],
       reperes_ar = array['أوقفت هذه الفاتورة على مبلغ', 'على مبلغ']
  from ref.grilles g
 where g.id = c.grille_id and g.code = 'facture' and c.code = 'montant_en_lettres';

-- « Réf. » ne nomme pas le numéro de la facture : il nomme aussi la référence TTN
-- (« Réf. TEIF:TN-… », 50/09), l'en-tête de la colonne des articles (50/22, 50/49) et
-- un contrat. Mesuré au banc des 150 factures (1er novembre 2026) : les trois lectures
-- « conformes » fausses du numéro venaient de lui. Les autres repères restent.
update ref.grille_champs c
   set reperes_fr = array_remove(c.reperes_fr, 'Réf.')
  from ref.grilles g
 where g.id = c.grille_id and g.code = 'facture' and c.code = 'numero_facture';

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_preuves p
   where p.expression ->> 'op' = 'lettres'
     and not exists (select 1 from ref.grille_champs c
                      where c.grille_id = p.grille_id and c.code = p.expression ->> 'champ');
  if n > 0 then
    raise exception 'preuve « lettres » : % preuve(s) nomment un champ absent de leur grille', n;
  end if;
end $$;

-- ================================================================ 4. CE QUI EST LU

create table ref.avertissements_de_lecture (
  code text primary key check (code ~ '^[a-z][a-z_]*$')
);

comment on table ref.avertissements_de_lecture is
  'Ce qu''un expert de lecture dit d''un champ lu sans le refuser (capture.champs_lus.avertissement).';

insert into ref.avertissements_de_lecture (code) values ('lettre_de_controle_discordante');

insert into ref.labels (ns, key, locale, value) values
  ('avertissement_lecture', 'lettre_de_controle_discordante', 'fr',
   'La lettre de contrôle du matricule ne correspond pas à ses chiffres (règle non publiée par la DGI : à vérifier).'),
  ('avertissement_lecture', 'lettre_de_controle_discordante', 'en',
   'The tax ID check letter does not match its digits (rule not published by the tax office: to be checked).'),
  ('avertissement_lecture', 'lettre_de_controle_discordante', 'ar',
   'حرف المراقبة في المعرف الجبائي لا يطابق أرقامه (قاعدة غير منشورة من الإدارة الجبائية: يجب التثبت).');

alter table capture.champs_lus
  add column avertissement text references ref.avertissements_de_lecture (code);

comment on column capture.champs_lus.avertissement is
  'Ce que l''expert dit du champ sans le refuser : la lettre de contrôle discordante d''un '
  'matricule bien formé. Nul sinon.';

create index champs_lus_avertissement_fk_idx on capture.champs_lus (avertissement);

alter table capture.champs_lus drop constraint champs_lus_issue_connue;
alter table capture.champs_lus add constraint champs_lus_issue_connue check (
  issue in ('prouvee', 'signalee', 'ambigue', 'aucune'));

-- La porte : l'issue `signalee` et l'avertissement, connu du référentiel.
create or replace function public.capture_champs_lus_inscrire(
  p_piece uuid, p_pack uuid, p_jour date, p_grille text, p_issue text, p_champs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_grille uuid;
  v_n integer;
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  select p.tenant_id into v_tenant from capture.pieces p where p.id = p_piece;
  if v_tenant is null or not app.piece_modifiable(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  -- La saisie : une issue connue, un jour, le pack du dossier, une liste non
  -- vide d'objets. Hors tentative, un statut ; une valeur, toujours citée (R2) ;
  -- un rang entier positif ; un avertissement du référentiel, sur un champ.
  if p_issue is null or p_issue not in ('prouvee', 'signalee', 'ambigue', 'aucune')
     or p_jour is null or p_grille is null
     or p_champs is null or jsonb_typeof(p_champs) <> 'array'
     or jsonb_array_length(p_champs) = 0
     or not exists (select 1 from ref.jurisdiction_packs j
                      join identity.organizations o on o.id = v_tenant
                     where j.id = p_pack and j.jurisdiction = o.jurisdiction)
     or exists (
       select 1 from jsonb_array_elements(p_champs) e
        where jsonb_typeof(e) <> 'object'
           or (e ->> 'champ' is null
               and (e ->> 'valeur' is not null or e ->> 'statut' is not null
                    or e ->> 'rang' is not null or e ->> 'instance' is not null
                    or e ->> 'avertissement' is not null))
           or (e ->> 'champ' is not null and e ->> 'statut' is null)
           or (e ->> 'valeur' is not null
               and (jsonb_typeof(e -> 'citations') is distinct from 'array'
                    or jsonb_array_length(e -> 'citations') = 0))
           or (e ->> 'rang' is not null and coalesce(e ->> 'rang' !~ '^[1-9][0-9]{0,3}$', true))
           or (e ->> 'avertissement' is not null
               and not exists (select 1 from ref.avertissements_de_lecture a
                                where a.code = e ->> 'avertissement')))
  then
    raise exception 'refus.saisie.mal_formee' using errcode = '22023';
  end if;

  select g.id into v_grille
    from ref.grilles g
   where g.pack_version_id = p_pack and g.code = p_grille
     and g.valid_from <= p_jour and (g.valid_to is null or g.valid_to >= p_jour)
   order by g.valid_from desc
   limit 1;
  if v_grille is null
     or exists (select 1 from jsonb_array_elements(p_champs) e
                 where e ->> 'champ' is not null
                   and not exists (select 1 from ref.grille_champs gc
                                    where gc.grille_id = v_grille and gc.code = e ->> 'champ'))
  then
    raise exception 'refus.lecture.champ_inconnu' using errcode = '22023';
  end if;

  insert into capture.champs_lus
    (tenant_id, piece_id, lecture_id, grille_id, grille_code, grille_champ_id, champ_code,
     rang, instance, valeur, statut, citations, issue, avertissement)
  select v_tenant, p_piece, x.lecture, v_grille, p_grille, gc.id, gc.code,
         (e ->> 'rang')::smallint, e ->> 'instance', e ->> 'valeur', e ->> 'statut',
         coalesce(e -> 'citations', '[]'::jsonb), p_issue, e ->> 'avertissement'
    from jsonb_array_elements(p_champs) e
   cross join (select gen_random_uuid() as lecture) x
    left join ref.grille_champs gc on gc.grille_id = v_grille and gc.code = e ->> 'champ';
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

-- ===================================================================== 5. LES DROITS

do $$
declare t text;
begin
  foreach t in array array['conventions_de_date', 'mois_en_lettres', 'identifiant_controles',
                           'nombres_en_lettres', 'devises_en_lettres', 'avertissements_de_lecture']
  loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('alter table ref.%I force row level security', t);
    execute format('revoke all on table ref.%I from public, anon', t);
    execute format('grant select on table ref.%I to authenticated', t);
    execute format('create policy %I on ref.%I for select to authenticated using (true)',
                   'ref_' || t || '_sel', t);
  end loop;
end $$;

commit;
