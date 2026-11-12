-- ======================================================================
--  Le portier lit le nom de la personne qu'une porte nomme (revue de #369).
--
--  `place_comptable_lire` et `comptabilite_invitation_*` appartiennent au
--  portier (migration 20261221110000) ; elles appellent `app.nom_au_moment`,
--  qui n'était accordée qu'au propriétaire d'administration. Le droit est
--  donné au SEUL portier : il ne rend un nom qu'à travers une porte qui en a
--  besoin, et `authenticated` ne le reçoit pas (un nom lu par identifiant
--  n'est pas une lecture ouverte à tous les comptes).
--
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

grant execute on function app.nom_au_moment(uuid) to portier;
