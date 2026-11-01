-- ======================================================================
--  Relire une pièce devient une NATURE de travail (17 novembre 2026).
--
--  Mesuré sur le staging le 1er novembre 2026 (18 factures fictives, une
--  page) : 19,4 s médianes par lecture, dont ~4 s de lecture et ~13 à 15 s de
--  RATTRAPAGE synchrone par le modèle de vision, le plus souvent écarté. Le
--  dirigeant a décidé que la lecture lourde passe en différé : « la nuit, si
--  ni le client ni le cabinet n'a corrigé ». Le réglage existait, enregistré
--  et non appliqué (`lecture.relecture_nuit`, `lecture.relecture_delai_heures`,
--  20261115110000).
--
--  La relecture est un travail de `fabrique.travaux`, pris, borné et
--  journalisé comme une lecture : elle ne dure pas moins (un modèle de
--  vision), et c'est la file durable qui survit à un redémarrage.
--
--  ======================================= POURQUOI CE FICHIER NE FAIT QUE CA
--
--  PostgreSQL refuse d'EMPLOYER une valeur d'énumération ajoutée dans la même
--  transaction (précédent : 20261020170000). Tout ce qui la nomme — colonnes,
--  contrainte, portes — vit dans le fichier suivant.
-- ======================================================================

alter type fabrique.travail_nature_t add value if not exists 'relecture_piece';

comment on type fabrique.travail_nature_t is
  'Ce qu''un travail fait. « lecture_piece » lit une piece ; '
  '« generation_recette » propose un lecteur specialise pour un format dont '
  'assez d''exemples sont connus ; « relecture_piece » relit, avec un AUTRE '
  'lecteur et pas avant son heure, une piece dont la lecture n''est pas '
  'parfaite — sauf si le client ou le cabinet l''a corrigee entre-temps.';
