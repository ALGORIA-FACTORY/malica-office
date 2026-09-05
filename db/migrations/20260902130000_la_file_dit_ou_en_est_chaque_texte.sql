-- La file d'ingestion dit ou en est chaque texte — et elle le dit d'apres la base.
--
-- ============================================================ CE QUI CLOCHAIT
--
-- Le statut de la file etait ecrit par les scripts au fil des passes. Les
-- premieres passes ne l'ecrivaient pas : quatre-vingt-seize documents restaient
-- « a faire » alors que leurs articles etaient en base depuis longtemps, et
-- une vingtaine se disaient « ingeres » alors qu'ils n'avaient rien produit.
-- Une file qui ment sur son propre etat ne sert plus a rien : on ne sait plus
-- ce qui reste a faire.
--
-- ============================================================ LA REGLE
--
-- Le statut se DEDUIT de la base, il ne se saisit pas :
--
--   ingere  le document a produit du texte, et ce texte est encore la ;
--   ignore  le portail sert ici un PDF deja lu sous une autre adresse ;
--   echec   le document n'a rien produit, et on dit pourquoi.
--
-- « A produit » se lit de deux facons, selon le type. Une note commune et une
-- norme comptable portent l'adresse de leur PDF sur chacune de leurs versions :
-- l'adresse suffit. Un code ou une loi de finances existe en plusieurs
-- editions dont les versions se recouvrent : on demande alors si le corpus
-- detient, dans la langue de ce document, une version qui couvre son millesime.
--
-- Les motifs d'echec sont nommes un par un : « echec » sans motif est une
-- tache oubliee qui se deguise en fait acquis.

begin;

create temporary table lecture on commit drop as
select q.id, q.type_document, q.sha256_source, q.statut, q.titre,
       exists (select 1 from legal.article_versions v where v.source_url = q.url_fichier)
         as par_adresse,
       exists (
         select 1 from legal.articles a
           join legal.article_versions v on v.article_id = a.id
          where a.corpus = case when q.type_document = 'LOI_FINANCES'
                                then q.corpus || '-' || q.annee else q.corpus end
            and v.langue_faisant_foi = q.langue
            and (q.annee is null or q.annee between v.edition_min and v.edition_max)
       ) as par_edition
  from legal.ingestion_queue q;

alter table lecture add column lu boolean;
update lecture
   set lu = par_adresse
         or (type_document not in ('NOTE_COMMUNE', 'NORME_COMPTABLE') and par_edition);

-- 1. Ce qui tient : ingere.
update legal.ingestion_queue q
   set statut = 'ingere',
       ingere_le = coalesce(q.ingere_le, now())
  from lecture l
 where l.id = q.id and l.lu and q.statut <> 'ingere';

-- 2. Ce que le portail sert deux fois : ignore, en nommant l'autre.
--
-- Deux lignes designent le meme document quand elles portent la meme empreinte
-- de fichier — ou, quand l'empreinte manque, le meme titre : le portail de la
-- DGELF publie certaines notes sous deux adresses, l'une nommee en arabe.
update legal.ingestion_queue q
   set statut = 'ignore',
       echec_motif = 'doublon d''adresse : le portail sert ici le PDF deja lu sous '
                     || quote_literal(autre.titre)
  from lecture l
  join lecture autre
    on autre.id <> l.id
   and autre.lu
   and (autre.sha256_source = l.sha256_source
        or ((l.sha256_source is null or autre.sha256_source is null)
            and autre.type_document = l.type_document
            and autre.titre = l.titre))
 where l.id = q.id and not l.lu;

-- 3. Ce qui n'a rien produit : echec, avec son motif.
--
-- Chaque motif a ete verifie sur le document lui-meme, pas suppose.
update legal.ingestion_queue set statut = 'echec', echec_motif =
  'PDF numerise et trop degrade : la reconnaissance optique n''en tire ni numeros d''articles ni date.'
 where corpus = 'CONV-COTE-IVOIRE';

update legal.ingestion_queue set statut = 'echec', echec_motif =
  'l''edition arabe du portail ne porte aucune date, ni de signature ni de ratification : elle ne peut pas etre datee.'
 where corpus = 'CONV-SINGAPOUR';

update legal.ingestion_queue set statut = 'echec', echec_motif =
  'le PDF du portail est un projet non signe : il porte « Fait a ......... le ......... » en blanc.'
 where corpus = 'CONV-VIETNAM';

update legal.ingestion_queue set statut = 'echec', echec_motif =
  'microfilm du Journal Officiel trop degrade pour la reconnaissance optique.'
 where corpus = 'LF' and annee = 1979 and langue = 'fr';

update legal.ingestion_queue set statut = 'echec', echec_motif =
  'le PDF est un numero entier du Journal Officiel, pas le texte de la loi.'
 where corpus = 'LFC' and annee = 2008 and langue = 'fr';

-- 4. Rien ne doit rester sans explication.
do $$
declare n int;
begin
  select count(*) into n
    from legal.ingestion_queue q
    join lecture l on l.id = q.id
   where not l.lu and q.statut = 'ingere';
  if n > 0 then
    raise exception 'la file compte % documents dits ingeres qui n''ont rien produit', n;
  end if;
  select count(*) into n
    from legal.ingestion_queue
   where statut in ('echec', 'ignore') and echec_motif is null;
  if n > 0 then
    raise exception 'la file compte % echecs sans motif', n;
  end if;
end $$;

commit;
