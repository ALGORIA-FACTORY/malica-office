-- ======================================================================
--  Le portier appelle les aides de la place « comptable » (revue de #369).
--
--  `comptable_interne_inviter` et `place_comptable_lire` (portier, migration
--  20261221110000) appellent les fonctions de la place comptable, révoquées à
--  `public` au moment de leur création. Le droit est donné au seul portier :
--  aucune n'est ouverte à `authenticated`, qui passe par les portes.
--
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

grant execute on function facturation.place_comptable_exiger(uuid, uuid, text) to portier;
grant execute on function facturation.places_comptable_engagees(uuid) to portier;
grant execute on function facturation.places_comptable_incluses(uuid) to portier;
