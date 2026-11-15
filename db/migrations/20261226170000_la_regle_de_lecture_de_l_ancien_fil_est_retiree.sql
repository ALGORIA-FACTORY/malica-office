-- La règle de lecture de l'ancien fil est retirée.
--
-- `app.notification_lisible` n'existait que pour la politique de lecture de
-- `collab.notifications`, retirée avec elle (20261226160000). Elle restait
-- appelable par un client, et rien ne l'appelait plus : une porte sans appelant.
-- La règle qu'elle portait vit maintenant dans `notif.audience`, jouée à
-- l'écriture, et dans `notif.centre`, qui borne la lecture à la personne.

begin;

drop function if exists app.notification_lisible(uuid, uuid, jsonb);

commit;
