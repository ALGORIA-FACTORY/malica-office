-- La fonction `app.notification_du_cabinet` servait l'ancien fil (`collab.notifications`
-- et sa politique) et `app.notifications_des_societes`, retirés par
-- 20261223110000. Plus aucun appelant : le test de l'intégrité (« aucune porte morte »)
-- la signalait. On la retire ici, à la racine, sans rien garder en liste.

begin;

drop function if exists app.notification_du_cabinet(uuid, uuid, timestamptz);

commit;
