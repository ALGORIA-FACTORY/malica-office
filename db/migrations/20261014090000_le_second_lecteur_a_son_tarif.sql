-- Le second lecteur a son tarif, donc il se journalise.
--
-- ================================================================== POURQUOI
--
-- R8 : les modèles viennent de la table qui les tarife. Et ce n'est pas une
-- formalité — `read-flow.ts` le dit depuis septembre : un organe appelé sans
-- ligne de tarif en vigueur NE SE JOURNALISE PAS, parce que le journal des
-- exécutions refuse un coût sans origine. Un second lecteur sans cette ligne
-- tournerait donc en silence, et le plafond de `agents.budgets` ne mordrait
-- sur rien.
--
-- Pire pour ce cas précis : on ne saurait pas combien de pièces l'ont
-- déclenché. Or c'est exactement le chiffre qui décidera, dans trois mois,
-- s'il mérite de rester — ou de passer en premier.
--
-- ======================================================= POURQUOI UN PRIX NUL
--
-- Zéro au jeton, comme `pdf-text` : ce lecteur ne consomme aucun jeton de
-- modèle. Son coût réel est le loyer de la machine qui le fait tourner, et
-- cette table compte des jetons — y inscrire un prix par page serait mentir
-- sur l'unité.
--
-- Ce qui compte ici est donc le NOMBRE d'appels, et c'est ce que la ligne
-- rend possible. Le loyer, lui, se lit sur la facture Hetzner.
--
-- =================================================== POURQUOI CE NOM, EXACTEMENT
--
-- `PP-OCRv5_mobile_det+latin_PP-OCRv5_mobile_rec` : les deux modèles, par
-- leur nom complet, parce que ce sont eux qui ont été mesurés le 13 octobre
-- (docs/mesure-paddleocr-2026-10-13.md). Les modèles `medium` font tomber le
-- conteneur sur une machine à 8 Go, et un « dernier en date » changerait le
-- relevé sans qu'une ligne de code bouge — c'est précisément ce que R8
-- interdit.
--
-- R11 : `effective_from` en littéral, jamais `current_date`. La ligne de
-- `pdf-text` est l'une des deux exceptions nommées dans AGENTS.md ; on ne la
-- prend pas pour modèle sur ce point.

begin;

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
values
  ('interne', 'PP-OCRv5_mobile_det+latin_PP-OCRv5_mobile_rec', 'vision',
   0, 0, 'EUR', true, date '2026-10-14')
on conflict do nothing;

commit;
