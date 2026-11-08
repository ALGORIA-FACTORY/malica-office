-- ======================================================================
--  La relecture ciblée par Claude devient une NATURE de travail (8 novembre 2026).
--
--  Décision du dirigeant : quand le Sudoku n'a pas prouvé une pièce, ses cases de montant
--  sont relues par Claude (Haiku) EN ARRIÈRE-PLAN, juste après la lecture — la personne voit
--  la pièce tout de suite, « en vérification ». C'est un travail de `fabrique.travaux`, pris,
--  borné et journalisé comme une lecture : la file durable survit à un redémarrage, et la
--  pièce ne reste jamais « en vérification » pour un processus mort.
--
--  PostgreSQL refuse d'EMPLOYER une valeur d'énumération ajoutée dans la même transaction
--  (précédent : 20261117100000) : tout ce qui la nomme vit dans le fichier suivant.
-- ======================================================================

alter type fabrique.travail_nature_t add value if not exists 'relecture_cases';

comment on type fabrique.travail_nature_t is
  'Ce qu''un travail fait. « lecture_piece » lit une piece ; « generation_recette » propose '
  'un lecteur specialise ; « relecture_piece » relit la nuit, avec un AUTRE lecteur ; '
  '« relecture_cases » fait relire par Claude les cases de montant d''une piece que le Sudoku '
  'n''a pas prouvee, juste apres sa lecture — la relecture n''est qu''un candidat, la piece '
  'n''est prouvee que si le Sudoku referme toutes ses contraintes avec elle.';
