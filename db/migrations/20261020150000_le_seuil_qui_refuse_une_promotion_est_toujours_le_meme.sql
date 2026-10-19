-- Le seuil qui refuse une promotion est toujours le même.
--
-- ================================================================== POURQUOI
--
-- `fabrique.verifier_promotion()` parcourt `fabrique.seuils_exiges(tenant)` et
-- LÈVE au PREMIER seuil franchi. Le message nomme ce seuil-là, et c'est ce
-- message que l'expert lit pour savoir ce qui manque à sa recette.
--
-- Or `fabrique.seuils_exiges` n'avait aucun `order by` sur sa requête finale.
-- Son CTE `livres` est bien ordonné par code, mais la jointure externe avec
-- `parametrage.fabrique_seuils` ne garantit RIEN : PostgreSQL choisit une
-- boucle imbriquée quand la table de surcharge est petite, et une jointure de
-- hachage quand elle grossit — ce qui renverse l'ordre des lignes rendues.
--
-- LA FAUTE N'EST PAS THÉORIQUE, ET ELLE S'EST MANIFESTÉE. Le 20 octobre 2026,
-- `socle-de-donnees.test.ts` a viré au rouge sur une assertion juste : une
-- évaluation sous TROIS seuils à la fois recevait tantôt « seuil
-- exactitude_champs_critiques », tantôt « seuil montants_faux_acceptes ». Rien
-- n'avait changé dans la fonction ni dans le test : seule la table de
-- surcharge avait grossi, parce que des exécutions successives y laissent des
-- lignes. Le même refus, deux messages — et un banc qui échoue sans qu'aucun
-- code fautif n'ait bougé.
--
-- Ce que cela coûterait en production est pire que le banc : deux cabinets
-- avec le même défaut de recette lisent deux raisons différentes, et celui qui
-- corrige la mesure nommée découvre ensuite la seconde. L'ordre n'est pas une
-- commodité de test, c'est la reproductibilité d'un message d'erreur.
--
-- L'ordre retenu est celui de la MESURE, et non celui du code. Les deux sont
-- déterministes ; celui-ci est en plus celui que l'expert lit, puisque c'est
-- le nom de la mesure qui apparaît dans le refus. Trier par code mettrait
-- « max.montants_faux_acceptes » avant « min.exactitude_champs_critiques »,
-- c'est-à-dire le préfixe `min`/`max` — un détail de nommage interne —
-- devant ce que la ligne dit vraiment.
--
-- `create or replace` conserve les droits accordés. Le corps est inchangé à
-- l'`order by` près.

begin;

create or replace function fabrique.seuils_exiges(p_tenant uuid)
returns table (code text, mesure text, sens text, exigence numeric, arrete_par_le_cabinet boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with livres as (
    select distinct on (s.code) s.code, s.value_num
      from ref.socle_params s
     where s.code like 'fabrique.seuil.promotion.%'
       and s.valid_from <= current_date
       and (s.valid_to is null or s.valid_to >= current_date)
     order by s.code, s.valid_from desc
  )
  select l.code,
         substring(l.code from '^fabrique\.seuil\.promotion\.(?:min|max)\.(.+)$') as mesure,
         split_part(l.code, '.', 4) as sens,
         coalesce(c.value_num, l.value_num) as exigence,
         c.value_num is not null as arrete_par_le_cabinet
    from livres l
    left join parametrage.fabrique_seuils c
      on c.tenant_id = p_tenant and c.code = l.code
   order by mesure
$$;

comment on function fabrique.seuils_exiges(uuid) is
  'Les seuils de promotion en vigueur pour une organisation : ce que le '
  'cabinet a arrêté, puis le défaut du pack. La colonne '
  '« arrete_par_le_cabinet » répond à « qui a décidé » sans lire un historique. '
  'Rendus dans l''ordre des mesures : le déclencheur de promotion lève au PREMIER '
  'seuil franchi, et sans ordre le même refus nommait deux mesures différentes '
  'selon le plan choisi pour la jointure.';

commit;
