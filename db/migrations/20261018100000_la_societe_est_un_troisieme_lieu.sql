-- La société est un troisième lieu, entre moi et le cabinet.
--
-- ================================================================== POURQUOI
--
-- `app.vis_t` ne connaît que deux valeurs : `personnel` et `partage`. Elles
-- ont suffi tant qu'une organisation n'avait qu'un membre — le dirigeant
-- décidait, et « partagé » voulait dire « parti au cabinet ».
--
-- Team et Premium cassent cette équivalence. Un siège saisit une pièce ; elle
-- doit quitter son espace sans pour autant partir chez le cabinet, parce que
-- c'est le propriétaire qui transmet. Il manque donc un lieu, et la règle de
-- centralisation est aujourd'hui inexprimable en base : on ne peut écrire ni
-- « chez Wissem, pas encore chez Mondher », ni l'écran qui en découle.
--
-- =============================================== POURQUOI CE N'EST PAS COSMÉTIQUE
--
-- Sans ce troisième état, le produit n'a que deux issues, toutes deux
-- fausses : soit la pièce d'un siège part directement au cabinet — et le
-- propriétaire perd le contrôle qu'on lui a vendu —, soit elle reste
-- `personnel` — et elle quitte l'entreprise avec le collaborateur qui part,
-- ce qui contredit la règle 1 (« l'entité appartient au client »).
--
-- ====================================================== POURQUOI DEUX MIGRATIONS
--
-- PostgreSQL refuse d'UTILISER une valeur d'énumération dans la même
-- transaction que celle qui l'ajoute. Cette migration ne fait donc QUE
-- l'ajouter ; `20261018103000` s'en sert. Les séparer n'est pas une
-- précaution de style : jouées ensemble, elles échouent.

begin;

alter type app.vis_t add value if not exists 'entite' after 'personnel';

commit;
