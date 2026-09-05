-- Le corpus se reencode : en-tete de contexte, et encodage asymetrique.
--
-- ============================================================ POURQUOI TOUT
--
-- Deux changements touchent CE QUI EST ENCODE, donc l'index entier :
--
--   1. chaque fragment est desormais precede de la phrase qui le situe
--      (migration precedente) ;
--   2. le corpus est encode cote « document » et les questions cote « query ».
--      Mesure sur un couple question/article reel, avec ce modele : le cosinus
--      passe de 0,5755 a 0,6507. Le reglage n'existe que sur l'API native de
--      DashScope, d'ou le changement de point d'entree dans db/corpus.
--
-- Un index a moitie ancien et a moitie neuf ne donne pas un resultat degrade :
-- il donne un classement qui melange deux espaces vectoriels, donc un
-- classement qui ne veut rien dire. On efface donc TOUTES les empreintes, et
-- db/corpus/vectoriser.mjs les refait — il est reprenable, une interruption se
-- rattrape en relancant.
--
-- Le texte servi ne bouge pas d'un caractere : `legal.chunks.texte` reste
-- l'extrait exact de la version. Seul change ce qui part au modele.

begin;

update legal.chunks c
   set entete = legal.entete_de_fragment(a.corpus, a.numero, v.edition_min, a.source_code, a.statut),
       embedding = null,
       pricing_id = null,
       encode_le = null
  from legal.article_versions v
  join legal.articles a on a.id = v.article_id
 where v.id = c.article_version_id;

do $$
declare n int;
begin
  select count(*) into n from legal.chunks where entete is null;
  if n > 0 then
    raise exception '% fragments sans en-tete : la composition a echoue', n;
  end if;
end $$;

commit;
