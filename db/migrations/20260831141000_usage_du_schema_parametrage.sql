-- Le droit d'entrer dans le schéma, que le helper ne donne pas.
--
-- `app.enable_tenant_rls` accorde sur la TABLE. Il ne dit rien du SCHÉMA, parce
-- que les vingt-trois schémas existants avaient reçu leur `usage` à la création.
-- `parametrage` est le premier créé après lui, et il en manquait donc.
--
-- Effet : les deux tables du paramétrage étaient inatteignables — non par la
-- RLS, qui faisait son travail, mais un cran avant, au seuil du schéma. Une
-- couche de paramétrage que personne ne peut ouvrir ne paramètre rien.
--
-- Trouvé en exerçant les quatre règles sous une vraie session plutôt qu'en
-- superutilisateur : en superutilisateur, tout passe et rien ne se voit.

grant usage on schema parametrage to authenticated;
revoke all on schema parametrage from public, anon;
