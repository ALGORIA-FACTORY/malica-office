-- Les notes communes reprennent l'annee qu'elles portent, pas celle du portail.
--
-- ============================================================ CE QUI S'EST PASSE
--
-- L'annee d'une note commune etait lue sur la PAGE D'INDEX du portail de la
-- DGELF, pas sur la note. Or le portail indexe la meme note sous deux annees :
-- la page 2010 renvoie, pour ses numeros 1 a 12, aux PDF des notes 1 a 12 de
-- 2009 ; la page 2020 renvoie, pour son numero 28, au PDF de la note 28/2019 ;
-- le lien de la note 29/2005 sert le PDF de la note 28/2005.
--
-- Resultat : douze notes fantomes. Le meme texte range sous deux identites,
-- dont une qui n'existe pas. Une recherche « note commune 11 de 2010 » rendait
-- un texte de 2009 en le presentant comme un texte de 2010.
--
-- ============================================================ CE QUI EST CORRIGE
--
-- La cause est corrigee dans db/corpus/notes.mjs : l'identite d'une note se lit
-- desormais dans son propre en-tete (« NOTE COMMUNE N° 11/2009 »), le titre du
-- portail ne servant que de secours. Les PDF de la premiere passe n'etant plus
-- en cache, cette migration rattrape les donnees deja ecrites — sans rien
-- deviner : chaque correction est DERIVEE du texte detenu.
--
--   1. Un article dont le texte est identique (meme empreinte) a celui d'un
--      autre article, et dont l'identite CONTREDIT son propre en-tete alors que
--      celle de l'autre le CONFIRME, est le fantome : il part.
--   2. La note 8 de 2009 n'existait que sous NC-2010 ; la place est libre sous
--      son vrai millesime, elle y retourne.
--   3. Deux adresses du portail servant le meme PDF ont ecrit deux fois la meme
--      version. La deuxieme part ; notes.mjs les dedoublonne desormais par
--      empreinte du texte.
--   4. La file redit la verite : ce qui a produit un texte est « ingere », ce
--      qui n'a rien produit est « echec » avec son motif.
--
-- Les fragments suivent les versions (chunks_article_version_id_fkey cascade) ;
-- ils seront reencodes par db/corpus/vectoriser.mjs.

begin;

-- --------------------------------------------------------------- 2. le deplacement
--
-- Avant la suppression : la note 8/2009 n'a pas de jumelle, elle a une place
-- vide sous son vrai millesime. On la deplace au lieu de la perdre.
update legal.articles a
   set corpus = 'NC-2009'
 where a.corpus = 'NC-2010'
   and a.numero = '8'
   and not exists (select 1 from legal.articles b
                    where b.jurisdiction = a.jurisdiction
                      and b.corpus = 'NC-2009' and b.numero = a.numero)
   and exists (
     select 1 from legal.article_versions v
      where v.article_id = a.id
        and substring(coalesce(v.texte_fr, v.texte_ar) from 1 for 1500)
            ~* 'note\s+commune\s*n[^0-9]{0,4}8\s*/\s*2009');

-- --------------------------------------------------------------- 1. les fantomes
create temporary table fantomes on commit drop as
with lu as (
  select a.id, a.corpus, a.numero, v.source_sha256,
         regexp_match(substring(coalesce(v.texte_fr, v.texte_ar) from 1 for 1500),
                      'note\s+commune\s*n[^0-9]{0,4}(\d{1,3})\s*/\s*(\d{4})', 'i') as en_tete
    from legal.articles a
    join legal.article_versions v on v.article_id = a.id
   where a.corpus like 'NC-%'
),
conforme as (
  select id, corpus, numero, source_sha256,
         (en_tete is not null
          and 'NC-' || en_tete[2] = corpus
          and (en_tete[1]::int)::text = numero) as conforme,
         en_tete
    from lu
)
select faux.id,
       faux.corpus || ' n' || faux.numero as identite_fausse,
       vrai.corpus || ' n' || vrai.numero as identite_vraie
  from conforme faux
  join conforme vrai
    on vrai.source_sha256 = faux.source_sha256
   and vrai.id <> faux.id
   and vrai.conforme
 where not faux.conforme;

delete from legal.article_versions v using fantomes f where v.article_id = f.id;
delete from legal.articles a using fantomes f where a.id = f.id;

-- --------------------------------------------------------------- 3. les versions jumelles
--
-- Une meme note publiee sous deux adresses : un seul texte, une seule version.
-- On garde la premiere ecrite, et on renumerote pour que les versions restent
-- 1, 2, 3 sans trou.
delete from legal.article_versions v
 where exists (select 1 from legal.article_versions w
                where w.article_id = v.article_id
                  and w.source_sha256 = v.source_sha256
                  and w.source_sha256 is not null
                  and w.version_num < v.version_num);

-- En deux temps : l'index (article_id, version_num) est unique et n'est pas
-- differable ; passer par des rangs negatifs evite qu'une ligne en cours de
-- renumerotation heurte une ligne pas encore renumerotee.
create temporary table rangs on commit drop as
  select id, article_id,
         row_number() over (partition by article_id order by version_num) as rang
    from legal.article_versions;

update legal.article_versions v
   set version_num = -r.rang
  from rangs r
 where v.id = r.id and v.version_num <> r.rang;

update legal.article_versions v
   set version_num = -v.version_num
 where v.version_num < 0;

commit;
