-- ======================================================================
--  Generer une recette devient une NATURE de travail.
--
--  CE QUI CLOCHAIT. `docs/fabrique-de-lecteurs/02-ce-qui-est-livre.md`,
--  limite 6 : « Rien ne declenche une generation en production. La forme
--  juste est un travail de la file, a cote de la lecture. » La fabrique
--  entiere etait donc inerte : les sept briques marchent, et aucune recette
--  ne nait sans qu'un humain lance un script a la main.
--
--  Une generation dure des dizaines de secondes et coute un appel paye. Ce
--  n'est donc ni un appel synchrone au bout d'une route, ni un declencheur
--  de base : c'est un travail de `fabrique.travaux`, pris, journalise et
--  borne comme une lecture.
--
--  ======================================= POURQUOI CE FICHIER NE FAIT QUE CA
--
--  PostgreSQL refuse d'EMPLOYER une valeur d'enumeration ajoutee dans la
--  meme transaction. Le lanceur (db/migrer.mjs) joue chaque fichier dans sa
--  propre transaction : la valeur s'ajoute ici, et tout ce qui la nomme —
--  colonne, contrainte, fonction de proposition — vit dans le fichier
--  suivant. Les deux ne se fusionnent pas.
-- ======================================================================

-- Le lanceur (db/migrer.mjs) ouvre deja la transaction : on n'en ouvre pas une seconde.

alter type fabrique.travail_nature_t add value if not exists 'generation_recette';

comment on type fabrique.travail_nature_t is
  'Ce qu''un travail fait. « lecture_piece » lit une piece ; '
  '« generation_recette » propose un lecteur specialise pour un format dont '
  'assez d''exemples sont connus. Les deux passent par la meme file, les '
  'memes bornes et le meme journal — une generation n''est pas un chemin a '
  'part, c''est un travail.';
