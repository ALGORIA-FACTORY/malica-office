-- Le dirigeant d'ALGORIA Factory opère la tour du pilote (décidé le 27 novembre 2026).
--
-- Le pilote a été monté en novembre sur une base neuve : les migrations du
-- 20 octobre (20261022210000, 20261022220000, 20261022240000) y ont joué avant
-- qu'aucun compte n'existe, et 20261022250000 a refermé les attentes. Personne
-- n'y est opérateur ; la tour ne s'ouvre à personne.
--
-- Le compte nommé est celui que le dirigeant a donné : w.barouni@algoria-factory.com.
--
-- GARDE. Le produit ne vérifie pas les adresses : nommer « le compte qui porte
-- cette adresse » donnerait la tour à quiconque l'aurait créé le premier (la
-- faille fermée par 20261022250000). Le compte n'est donc nommé que s'il EXISTE
-- quand la migration joue ET qu'il a été créé AVANT le 28 novembre 2026, date
-- à laquelle le dirigeant l'a créé lui-même sur le pilote. Sur une base plus
-- tardive (la production), aucun compte ne remplit la condition : rien n'est
-- accordé, et un opérateur s'y nommera par sa propre migration.
--
-- REJEU (R11) : date en littéral, `on conflict do nothing`.

begin;

insert into app.platform_operators (user_id, note)
select u.id,
       'Dirigeant d''ALGORIA Factory — opère la tour du pilote (décision du 27 novembre 2026)'
  from auth.users u
 where lower(btrim(u.email)) = 'w.barouni@algoria-factory.com'
   and u.created_at < timestamptz '2026-11-28 00:00:00+01'
on conflict (user_id) do nothing;

commit;
