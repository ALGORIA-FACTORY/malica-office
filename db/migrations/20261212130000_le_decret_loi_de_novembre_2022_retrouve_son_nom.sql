-- Le décret-loi de finances de novembre 2022 est nommé sous un code que
-- aucun article ne porte (défaut C10b du relevé du 11 novembre 2026).
--
-- Les articles sont rangés sous le corpus `DECRET_LOI_FINANCES_NOV-2022` ; la
-- ligne de `legal.corpus_noms` s'appelait `DECRET_LOI_FINANCES_NOV`, sans
-- l'année. Six articles s'affichaient donc sans libellé. Le nom, lui, était
-- juste (« décret-loi n° 2022-69 du 22 novembre 2022 », celui de la file
-- d'ingestion) : on corrige la clé, on n'invente rien.
--
-- Non traité ici : le recueil des textes non incorporés reste sans nom, parce
-- que son titre n'a pas été relu dans son propre texte (règle de
-- 20260901180000). INCERTAIN : à vérifier sur la première page du fascicule.
--
-- Retour arrière : update legal.corpus_noms set code = 'DECRET_LOI_FINANCES_NOV'
-- where code = 'DECRET_LOI_FINANCES_NOV-2022';

update legal.corpus_noms
   set code = 'DECRET_LOI_FINANCES_NOV-2022'
 where code = 'DECRET_LOI_FINANCES_NOV'
   and not exists (select 1 from legal.corpus_noms where code = 'DECRET_LOI_FINANCES_NOV-2022');
