-- L'index vectoriel se reconstruit apres un reencodage.
--
-- ============================================================ POURQUOI
--
-- Un index HNSW n'est pas une table triee : c'est un graphe de voisinages,
-- construit vecteur par vecteur au moment ou chaque vecteur est ecrit. Remplacer
-- les 31 863 empreintes par d'autres — ce que vient de faire le reencodage avec
-- l'en-tete de contexte et l'encodage asymetrique — laisse un graphe dont les
-- aretes ont ete tracees pour des vecteurs QUI N'EXISTENT PLUS.
--
-- L'index continue de repondre, et c'est le piege : il repond mal, sans rien
-- signaler. On mesurerait alors une recherche abimee et on en tirerait de
-- fausses conclusions sur l'en-tete et sur le type de tache.
--
-- La regle, donc : TOUT REENCODAGE DU CORPUS SE TERMINE PAR CETTE MIGRATION.
--
-- ============================================================ LES PARAMETRES
--
-- On reconstruit avec les parametres explicites plutot qu'avec les defauts :
-- m = 16 voisins par noeud, ef_construction = 128 candidats examines pendant la
-- construction. Ce sont les valeurs recommandees par pgvector pour un rappel
-- eleve sur quelques dizaines de milliers de vecteurs ; les laisser implicites
-- rendait la qualite de l'index dependante d'un defaut susceptible de changer.
--
-- La construction est temporairement gourmande en memoire : sans quoi pgvector
-- bascule sur disque et la construction dure des heures au lieu de minutes.

begin;

set local maintenance_work_mem = '512MB';

drop index if exists legal.chunks_hnsw;

create index chunks_hnsw on legal.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 128);

commit;

analyze legal.chunks;
