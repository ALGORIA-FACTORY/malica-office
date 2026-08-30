-- Une fonction alignée sur les autres.
--
-- `app.email_du_membre` avait `search_path = pg_catalog, public` là où les six
-- autres fonctions `security definer` ont `search_path = ''`. Le chemin était
-- figé, donc non détournable par l'appelant : ce n'était pas une faille. Mais
-- dans un projet où six fonctions sur sept disent la même chose, la septième qui
-- dit autre chose invite à se demander si c'était voulu — et une question sans
-- réponse dans du code de sécurité finit par recevoir une mauvaise réponse.
--
-- Ses trois références sont déjà qualifiées (`auth.users`, `identity.memberships`,
-- `app.member_orgs`) : le chemin vide ne change rien à son exécution.

alter function app.email_du_membre(uuid) set search_path = '';
