-- ======================================================================
--  L'espace privé se trouve par son auteur (8 novembre 2026).
--
--  Mesuré : `public.mon_espace_hors_societe()`, appelé à CHAQUE ouverture de
--  l'application, parcourait toutes les pièces de la base (74 277 dans la
--  base de recette) pour trouver les papiers privés de l'appelant — 224 ms,
--  et autant de plus à chaque pièce déposée par n'importe qui.
--
--  Un index partiel sur les papiers privés vivants, par auteur : la lecture
--  ne touche plus que les siens.
-- ======================================================================

begin;

create index if not exists pieces_privees_par_auteur
  on capture.pieces (created_by, created_at desc)
  where vis = 'personnel'::app.vis_t and archivee_le is null;

commit;
