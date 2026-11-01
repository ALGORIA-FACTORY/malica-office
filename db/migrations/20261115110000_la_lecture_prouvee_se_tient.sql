-- La lecture prouvée se tient (15 novembre 2026).
--
-- Un audit indépendant a EXÉCUTÉ ce que `20261105110000` (le sudoku lit toutes
-- les pièces) laissait passer. Cette migration ne la réécrit pas : elle la
-- complète, et chaque point a son épreuve (`le-sudoku-s-inscrit-par-sa-porte`,
-- `sudoku.test.ts`, `les-reglages-comptables-du-cabinet`).
--
-- ====================================================== 1. CE QUE LE MOTEUR A LU
--
-- `capture.champs_lus` acceptait une valeur « prouve » sans citation, une
-- grille qui n'existe pas, un statut nul, et codait le rang d'une ligne et le
-- taux d'une instance DANS le nom du champ (`quantite#3`, `base_tva_par_taux:TVA19`).
-- Désormais :
--   * chaque ligne nomme sa grille (`grille_id`) et, hors tentative, son champ
--     (`grille_champ_id`), résolus par la porte à la date de la PIÈCE dans le
--     pack de son dossier ; un champ inconnu est refusé. Les codes lisibles
--     (`grille_code`, `champ_code`) restent pour l'œil, et des clés étrangères
--     composées les tiennent égaux aux identifiants : aucun doublon de vérité ;
--   * le rang (`rang`, la n-ième ligne d'un tableau) et l'instance (`instance`,
--     le code du taux) ont leur colonne ;
--   * `lecture_id` est commun à toutes les lignes d'une inscription : « la plus
--     récente fait foi » ne repose plus sur `created_at` seul ;
--   * une ligne de tentative a champ, valeur et statut nuls ; toute autre a un
--     statut ; une valeur exige au moins une citation (R2).
-- La porte lève des clés `refus.*` (fr, en, ar) et appartient au `portier`,
-- comme celles de #154.
--
-- Les lignes déjà inscrites (mode observation) gardent leurs valeurs : seuls
-- l'identifiant d'inscription, la grille, le champ, le rang et l'instance —
-- des faits qu'elles portaient déjà dans leur nom — sont posés, garde R7
-- suspendue le temps de cette migration seulement (précédent :
-- 20261022490000). Les contraintes de contenu sont posées NOT VALID puis
-- validées : si une ligne ancienne les viole, elle reste telle quelle (on ne
-- réécrit pas une lecture), la contrainte vaut pour toute ligne nouvelle, et
-- la migration le dit (NOTICE).
--
-- ============================================= 2. LES ATTRIBUTS DES PREUVES
--
-- L'adaptateur ne porte plus de codes de champs (contrat du moteur, §2) :
--   * la preuve `somme` dont le total est le TTC que la chaîne reçoit porte
--     `"role": "ttc"` — P04 (variante ttc_avec_timbre), M04 (ttc_hors_timbre :
--     c'est le net à payer qui ferme HT + TVA + droits) ;
--   * la charge d'assiette (le FODEC) nomme le barème dont elle majore la base :
--     `"assiette": "tva"` (le moteur écrivait `BAREME_ASSIETTE = "tva"`).
--
-- ============================================= 3. LE RÉGLAGE DE LA LECTURE
--
-- `SUDOKU_DESIGNE=1` n'était même pas transmis par infra/compose.yml. Le
-- passage de l'observation à la désignation devient un réglage du mécanisme
-- de #154, que le cabinet voit et arrête comme les autres : sujet `lecture`,
-- `lecture.sudoku` (observe — défaut —, designe), `lecture.relecture_nuit`
-- (active, coupee — défaut —) et `lecture.relecture_delai_heures` (12). Les
-- deux derniers sont ENREGISTRÉS, pas appliqués : `applique` le dit.
--
-- REJEU (R11) : dates en littéral ; aucune horloge n'écrit dans `ref`.

begin;

-- --- 1. La clé lisible d'une grille et d'un champ ----------------------------------------------

-- Les clés étrangères composées de `capture.champs_lus` s'y appuient : un code
-- lisible ne peut pas dire autre chose que l'identifiant qu'il accompagne.
alter table ref.grilles add constraint grilles_id_code_key unique (id, code);
alter table ref.grille_champs add constraint grille_champs_id_code_key unique (id, code);
alter table ref.grille_champs add constraint grille_champs_grille_id_id_key unique (grille_id, id);

-- --- 2. Les colonnes de ce qui est lu -----------------------------------------------------------

alter table capture.champs_lus
  add column lecture_id uuid,
  add column grille_id uuid references ref.grilles (id),
  add column grille_champ_id uuid references ref.grille_champs (id),
  add column rang smallint check (rang is null or rang > 0),
  add column instance text check (instance is null or length(btrim(instance)) > 0);

comment on column capture.champs_lus.lecture_id is
  'L''inscription : toutes les lignes d''un même passage du sudoku la partagent. La plus récente '
  'fait foi, inscription par inscription.';
comment on column capture.champs_lus.rang is
  'La n-ième ligne d''un tableau (anneau 1), à partir de 1 ; nul hors tableau.';
comment on column capture.champs_lus.instance is
  'L''instance d''un champ de groupe : le code du taux du barème (TVA19). Nulle sinon.';

-- Les lignes déjà inscrites : ce qu'elles portaient dans leur nom passe dans
-- ses colonnes. Une inscription = une transaction de la porte = un `created_at`.
alter table capture.champs_lus disable trigger capture_champs_lus_no_upd;

update capture.champs_lus c
   set lecture_id = md5(c.piece_id::text || '|' || c.created_at::text)::uuid,
       rang = case when c.champ_code ~ '#[0-9]+$'
                   then substring(c.champ_code from '#([0-9]+)$')::smallint end,
       instance = case when c.champ_code ~ ':.+$'
                       then substring(c.champ_code from ':(.+)$') end,
       champ_code = regexp_replace(regexp_replace(c.champ_code, '#[0-9]+$', ''), ':.+$', '')
 where c.lecture_id is null;

update capture.champs_lus c
   set grille_id = g.id
  from capture.pieces p
  join identity.organizations o on o.id = p.tenant_id
  join ref.jurisdiction_packs j on j.jurisdiction = o.jurisdiction
  join ref.grilles g on g.pack_version_id = j.id
 where p.id = c.piece_id and c.grille_id is null and g.code = c.grille_code
   and j.effective_from <= c.created_at::date
   and (j.effective_to is null or j.effective_to >= c.created_at::date)
   and g.valid_from <= c.created_at::date
   and (g.valid_to is null or g.valid_to >= c.created_at::date);

update capture.champs_lus c
   set grille_champ_id = gc.id
  from ref.grille_champs gc
 where gc.grille_id = c.grille_id and gc.code = c.champ_code and c.grille_champ_id is null;

alter table capture.champs_lus enable trigger capture_champs_lus_no_upd;

alter table capture.champs_lus alter column lecture_id set not null;

-- Les codes lisibles disent la même chose que les identifiants (MATCH SIMPLE :
-- une ligne de tentative, sans champ, n'est pas contrainte sur le champ).
alter table capture.champs_lus
  add constraint champs_lus_grille_code_fkey
    foreign key (grille_id, grille_code) references ref.grilles (id, code),
  add constraint champs_lus_champ_code_fkey
    foreign key (grille_champ_id, champ_code) references ref.grille_champs (id, code),
  add constraint champs_lus_champ_de_la_grille_fkey
    foreign key (grille_id, grille_champ_id) references ref.grille_champs (grille_id, id);

-- Le contenu d'une ligne : NOT VALID, puis validé si les lignes anciennes le permettent.
alter table capture.champs_lus
  add constraint champs_lus_tentative_ou_champ check (
    (champ_code is null and grille_champ_id is null and valeur is null and statut is null
     and rang is null and instance is null)
    or (champ_code is not null and grille_champ_id is not null and grille_id is not null
        and statut is not null)) not valid,
  add constraint champs_lus_valeur_citee check (
    valeur is null
    or (jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) > 0)) not valid,
  add constraint champs_lus_issue_connue check (
    issue in ('prouvee', 'ambigue', 'aucune')) not valid;

do $$
declare c text;
begin
  foreach c in array array['champs_lus_tentative_ou_champ', 'champs_lus_valeur_citee',
                           'champs_lus_issue_connue'] loop
    begin
      execute format('alter table capture.champs_lus validate constraint %I', c);
    exception when check_violation then
      raise notice 'capture.champs_lus : % reste NOT VALID — des lignes anciennes la violent '
                   '(elles ne se réécrivent pas) ; elle vaut pour toute ligne nouvelle.', c;
    end;
  end loop;
end $$;

create index champs_lus_tenant_lecture_idx
  on capture.champs_lus (tenant_id, piece_id, created_at desc, lecture_id);
create index champs_lus_grille_id_fk_idx on capture.champs_lus (grille_id);
create index champs_lus_grille_champ_id_fk_idx on capture.champs_lus (grille_champ_id);

-- --- 3. La porte -----------------------------------------------------------------------------------
--
-- Le serveur seul ; une pièce que l'appelant peut modifier ; le pack de la
-- juridiction du dossier ; la grille et ses champs À LA DATE DE LA PIÈCE. Elle
-- appartient au portier : elle s'exécute sous les politiques de son appelant,
-- qui n'insère que dans un dossier dont il est membre.

drop function if exists public.capture_champs_lus_inscrire(uuid, text, text, jsonb);

create function public.capture_champs_lus_inscrire(
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
  -- un rang entier positif.
  if p_issue is null or p_issue not in ('prouvee', 'ambigue', 'aucune')
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
                    or e ->> 'rang' is not null or e ->> 'instance' is not null))
           or (e ->> 'champ' is not null and e ->> 'statut' is null)
           or (e ->> 'valeur' is not null
               and (jsonb_typeof(e -> 'citations') is distinct from 'array'
                    or jsonb_array_length(e -> 'citations') = 0))
           or (e ->> 'rang' is not null and coalesce(e ->> 'rang' !~ '^[1-9][0-9]{0,3}$', true)))
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
     rang, instance, valeur, statut, citations, issue)
  select v_tenant, p_piece, x.lecture, v_grille, p_grille, gc.id, gc.code,
         (e ->> 'rang')::smallint, e ->> 'instance', e ->> 'valeur', e ->> 'statut',
         coalesce(e -> 'citations', '[]'::jsonb), p_issue
    from jsonb_array_elements(p_champs) e
   cross join (select gen_random_uuid() as lecture) x
    left join ref.grille_champs gc on gc.grille_id = v_grille and gc.code = e ->> 'champ';
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

alter function public.capture_champs_lus_inscrire(uuid, uuid, date, text, text, jsonb)
  owner to portier;
revoke all on function public.capture_champs_lus_inscrire(uuid, uuid, date, text, text, jsonb)
  from public, anon;
grant execute on function public.capture_champs_lus_inscrire(uuid, uuid, date, text, text, jsonb)
  to authenticated;
-- Le portier n'écrit que ce que sa porte écrit, et ne vérifie que ce qu'elle vérifie.
grant insert on table capture.champs_lus to portier;
grant execute on function app.piece_modifiable(uuid) to portier;

-- --- 4. Les attributs des preuves (contrat du moteur, §2) -----------------------------------------

update ref.grille_preuves p
   set expression = p.expression || '{"role": "ttc"}'::jsonb
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'facture' and p.code in ('P04', 'M04')
   and p.expression ->> 'op' = 'somme';

update ref.grille_preuves p
   set expression = p.expression || '{"assiette": "tva"}'::jsonb
 where p.expression ->> 'op' = 'charge'
   and p.expression ->> 'code' in (select c.code from ref.fiscal_charges c where c.taxable);

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where g.code = 'facture' and p.expression ->> 'role' = 'ttc';
  if n <> 2 * (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : % preuve(s) « role ttc », 2 par grille attendues', n;
  end if;
end $$;

-- --- 5. Le réglage de la lecture -----------------------------------------------------------------

insert into ref.reglages_comptables_sujets
  (code, ordre, droit_hors_tva, categories_d_immobilisation, incertain, natures_de_vente) values
  ('lecture', 12, null, false, true, false);

insert into ref.reglages_comptables (code, sujet, ordre, nature, porte, applique) values
  ('lecture.sudoku', 'lecture', 1, 'option', 'reglages_comptables', true),
  ('lecture.relecture_nuit', 'lecture', 2, 'option', 'reglages_comptables', false),
  ('lecture.relecture_delai_heures', 'lecture', 3, 'nombre', 'reglages_comptables', false);

insert into ref.reglages_comptables_options (reglage, code, ordre, applique) values
  ('lecture.sudoku', 'observe', 1, true),
  ('lecture.sudoku', 'designe', 2, true),
  ('lecture.relecture_nuit', 'active', 1, false),
  ('lecture.relecture_nuit', 'coupee', 2, false);

insert into ref.reglages_comptables_sources (sujet, ordre, titre, url, datee_du, consultee_le) values
  ('lecture', 1, 'Contrat du moteur du sudoku (Malica Office, docs/sudoku/contrat-du-moteur.md)',
   'https://github.com/ALGORIA-FACTORY/malica-office/blob/main/docs/sudoku/contrat-du-moteur.md',
   date '2026-10-31', date '2026-11-01');

insert into ref.socle_params (pack_version_id, code, value_text, value_num, legal_reference, valid_from)
select p.id, v.code, v.texte, v.nombre,
       'Défaut livré par Malica (pas une règle fiscale). ' || v.reference,
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('lecture.sudoku', 'observe', null::numeric,
    'Le sudoku observe tant que le dirigeant ne le branche pas sur les mesures de l''observation '
    '(contrat du moteur, §5).'),
   ('lecture.relecture_nuit', 'coupee', null::numeric,
    'La relecture de nuit des pièces non prouvées est coupée.'),
   ('lecture.relecture_delai_heures', null, 12::numeric,
    'Délai avant la relecture de nuit d''une pièce non prouvée.')
 ) as v(code, texte, nombre, reference)
 where p.jurisdiction = 'TN' and p.version = '2026.1';

insert into ref.labels (ns, key, locale, value) values
  ('reglage_sujet', 'lecture', 'fr', 'Lecture prouvée des pièces'),
  ('reglage_sujet', 'lecture', 'en', 'Proven reading of documents'),
  ('reglage_sujet', 'lecture', 'ar', 'القراءة المُثبَتة للوثائق'),
  ('reglage_sujet_texte', 'lecture', 'fr',
   'Aucun texte fiscal : c''est un réglage de Malica. Le sudoku désigne les montants d''une pièce '
   'par la preuve — HT + TVA + droits = TTC, base × taux = TVA, droits du barème à la date de la '
   'pièce. Il ne juge pas la conformité : le Socle le fait ensuite.'),
  ('reglage_sujet_texte', 'lecture', 'en',
   'No tax text: this is a Malica setting. The sudoku designates the amounts of a document by '
   'proof — net + VAT + duties = gross, base × rate = VAT, duties from the scale on the document '
   'date. It does not judge compliance: the Core does that afterwards.'),
  ('reglage_sujet_texte', 'lecture', 'ar',
   'لا يوجد نص جبائي: هذا إعداد من مليكة. يعيّن السودوكو مبالغ الوثيقة بالبرهان — المبلغ دون '
   'أداء + الأداء + المعاليم = المبلغ الجملي، الأساس × النسبة = الأداء، معاليم الجدول بتاريخ '
   'الوثيقة. لا يحكم على المطابقة: النواة تفعل ذلك بعده.'),
  ('reglage_sujet_pratique', 'lecture', 'fr',
   'En observation, il lit chaque pièce et inscrit ce qu''il a prouvé, sans rien changer à la '
   'lecture. Désignant, une pièce prouvée prend ses montants ; une pièce non prouvée garde la '
   'lecture de la chaîne et ses contrôles.'),
  ('reglage_sujet_pratique', 'lecture', 'en',
   'When observing, it reads every document and records what it proved, without changing the '
   'reading. When designating, a proven document takes its amounts; an unproven one keeps the '
   'chain''s reading and its checks.'),
  ('reglage_sujet_pratique', 'lecture', 'ar',
   'في وضع الملاحظة، يقرأ كل وثيقة ويسجّل ما أثبته دون تغيير القراءة. في وضع التعيين، تأخذ '
   'الوثيقة المُثبَتة مبالغه؛ وتحتفظ الوثيقة غير المُثبَتة بقراءة السلسلة ومراقباتها.'),
  ('reglage_sujet_risque', 'lecture', 'fr',
   'Une seule affectation doit fermer toute l''arithmétique de la pièce : sinon rien ne change. '
   'Le risque est une fausse preuve, mesurée à zéro sur les bancs sauf une pièce imprimée à deux '
   'décimales (les valeurs imprimées, arrondies, sont rendues).'),
  ('reglage_sujet_risque', 'lecture', 'en',
   'A single assignment must close all of the document''s arithmetic: otherwise nothing changes. '
   'The risk is a false proof, measured at zero on the benches except for one document printed '
   'with two decimals (the printed, rounded values are returned).'),
  ('reglage_sujet_risque', 'lecture', 'ar',
   'يجب أن يُغلق تعيين واحد كامل حساب الوثيقة، وإلا فلا شيء يتغيّر. الخطر هو برهان خاطئ، قيس '
   'بالصفر على المقاعد باستثناء وثيقة مطبوعة برقمين عشريين (تُعاد القيم المطبوعة المقرّبة).'),
  ('reglage_sujet_incertain', 'lecture', 'fr',
   'Non appliqués : la relecture de nuit et son délai sont enregistrés, pas encore exécutés. Le '
   'passage en désignation se décide sur les mesures de l''observation des vraies pièces.'),
  ('reglage_sujet_incertain', 'lecture', 'en',
   'Not applied: the night re-reading and its delay are recorded, not yet carried out. Switching '
   'to designation is decided on the measurements of observing real documents.'),
  ('reglage_sujet_incertain', 'lecture', 'ar',
   'غير مطبّق: إعادة القراءة الليلية ومهلتها مسجّلتان ولم تُنفّذا بعد. يُقرَّر المرور إلى التعيين '
   'على أساس قياسات ملاحظة الوثائق الحقيقية.'),
  ('reglage_comptable', 'lecture.sudoku', 'fr', 'Le sudoku'),
  ('reglage_comptable', 'lecture.sudoku', 'en', 'The sudoku'),
  ('reglage_comptable', 'lecture.sudoku', 'ar', 'السودوكو'),
  ('reglage_comptable', 'lecture.relecture_nuit', 'fr', 'Relecture de nuit'),
  ('reglage_comptable', 'lecture.relecture_nuit', 'en', 'Night re-reading'),
  ('reglage_comptable', 'lecture.relecture_nuit', 'ar', 'إعادة القراءة الليلية'),
  ('reglage_comptable', 'lecture.relecture_delai_heures', 'fr', 'Délai avant relecture (heures)'),
  ('reglage_comptable', 'lecture.relecture_delai_heures', 'en', 'Delay before re-reading (hours)'),
  ('reglage_comptable', 'lecture.relecture_delai_heures', 'ar', 'المهلة قبل إعادة القراءة (ساعات)'),
  ('reglage_comptable_option', 'lecture.sudoku:observe', 'fr',
   'Observe : inscrit ce qu''il prouve, ne change rien'),
  ('reglage_comptable_option', 'lecture.sudoku:observe', 'en',
   'Observe: records what it proves, changes nothing'),
  ('reglage_comptable_option', 'lecture.sudoku:observe', 'ar',
   'ملاحظة: يسجّل ما يثبته ولا يغيّر شيئا'),
  ('reglage_comptable_option', 'lecture.sudoku:designe', 'fr',
   'Désigne : une pièce prouvée prend ses montants'),
  ('reglage_comptable_option', 'lecture.sudoku:designe', 'en',
   'Designate: a proven document takes its amounts'),
  ('reglage_comptable_option', 'lecture.sudoku:designe', 'ar',
   'تعيين: تأخذ الوثيقة المُثبَتة مبالغه'),
  ('reglage_comptable_option', 'lecture.relecture_nuit:active', 'fr', 'Active'),
  ('reglage_comptable_option', 'lecture.relecture_nuit:active', 'en', 'On'),
  ('reglage_comptable_option', 'lecture.relecture_nuit:active', 'ar', 'مفعّلة'),
  ('reglage_comptable_option', 'lecture.relecture_nuit:coupee', 'fr', 'Coupée'),
  ('reglage_comptable_option', 'lecture.relecture_nuit:coupee', 'en', 'Off'),
  ('reglage_comptable_option', 'lecture.relecture_nuit:coupee', 'ar', 'موقوفة');

commit;
