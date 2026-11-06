-- Ce que l'API ne dit plus à l'écran, l'étape `rpc` le garde en base.
--
-- 6 novembre 2026, règle du dirigeant : aucun texte technique ne part vers
-- l'écran. L'API rendait, à défaut de clé `refus.*`, le message brut de
-- PostgreSQL ; elle rend désormais la clé `refus.inattendu`. Une panne (500)
-- rendait déjà « erreur interne ».
--
-- Ce qui n'est plus dit doit pouvoir se relire. L'étape `rpc` porte donc :
--   - `code_pg` : le SQLSTATE de l'erreur (« 23514 », « P0001 ») ;
--   - `erreur`  : le NOM de l'erreur (« error », « ZodError »), jamais son
--                 message — un message peut citer une valeur de pièce
--                 (docs/journalisation.md, même règle que `persistance`).
--
-- REJEU (R11) : la liste est réécrite entière, à l'identique à chaque passage.

begin;

update observabilite.etapes
   set cles_autorisees = '{depot,methode,statut,code_refus,code_pg,erreur}'
 where code = 'rpc';

commit;
