-- Chaque version dit de quel fichier elle a ete tiree.
--
-- ============================================================ CE QUI MANQUAIT
--
-- db/corpus/reconstruire.mjs n'ecrivait pas `source_url`. Les versions issues de
-- l'archive d'origine la portaient ; toutes celles reconstruites depuis ne la
-- portaient plus. 2 265 versions citaient leur article, leur page au Journal
-- Officiel, leur empreinte — et pas l'adresse du document lu. Devant un
-- controle, c'est la piece justificative qui manque au dossier.
--
-- La cause est corrigee dans reconstruire.mjs : l'adresse de l'edition la plus
-- ancienne ou la version apparait est desormais ecrite avec elle.
--
-- ============================================================ LE RATTRAPAGE
--
-- Les PDF de la premiere passe ne sont plus en cache et plusieurs sources ne
-- sont plus telechargeables ; tout relire ferait perdre les microfilms lus par
-- reconnaissance optique. On RETROUVE donc l'adresse au lieu de la relire :
-- une version de millesime N, dans le corpus C et la langue L, vient de
-- l'edition (C, N, L) de la file. Quand cette edition n'est pas unique, on
-- n'ecrit rien : une adresse approchee vaudrait moins que pas d'adresse.

begin;

with cible as (
  select q.id, q.langue, q.url_fichier,
         case when q.type_document = 'LOI_FINANCES' then q.corpus || '-' || q.annee
              else q.corpus end as corpus,
         q.annee
    from legal.ingestion_queue q
   where q.url_fichier is not null
),
unique_par_edition as (
  select corpus, annee, langue, min(url_fichier) as url
    from cible
   group by 1,2,3
  having count(*) = 1
)
update legal.article_versions v
   set source_url = u.url
  from legal.articles a, unique_par_edition u
 where a.id = v.article_id
   and v.source_url is null
   and u.corpus = a.corpus
   and u.langue = v.langue_faisant_foi
   and (u.annee = v.edition_min
        or (u.annee is null and v.edition_min is not null));

commit;
