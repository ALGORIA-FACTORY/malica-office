-- La porte de retrait du comptable interne appartient au portier (revue Codex de #372, P1).
--
-- Une porte qui écrit est une porte du portier (AGENTS.md, R6) : sans cela, elle
-- s'exécute comme le rôle qui a appliqué la migration et contourne la RLS de l'appelant.
-- Le portier reçoit le seul droit que cette porte exerce : supprimer une affectation
-- de comptable (`role = 'comptable'`). Les politiques de `identity.memberships`
-- restent celles de l'appelant : seul le propriétaire de la société peut retirer.

alter function public.comptable_interne_retirer(uuid, uuid) owner to portier;

grant delete on identity.memberships to portier;
