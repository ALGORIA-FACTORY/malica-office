-- Trois colonnes que le corpus porte et que la table n'avait pas.
--
-- `legal.article_versions` a été créée par le socle fiscal du paquet ; le corpus
-- ingéré, lui, est postérieur et porte trois informations de plus :
--
--   edition_min / edition_max  l'intervalle d'éditions du code où cette version
--                              du texte s'applique — un article amendé en 2021
--                              vaut pour les éditions 2021 à 2025 ;
--   amendements                les références des textes qui l'ont modifié.
--
-- Sans elles, le chargement du corpus s'arrête à la première ligne. Les ajouter
-- ne change rien à ce qui existe : elles sont nulles pour toute version déjà
-- enregistrée, et il n'y en a aucune.

alter table legal.article_versions
  add column if not exists edition_min  integer,
  add column if not exists edition_max  integer,
  add column if not exists amendements  text[];

comment on column legal.article_versions.edition_min is
  'Première édition du code où cette version du texte s''applique.';
comment on column legal.article_versions.amendements is
  'Références des textes qui ont modifié cet article, telles qu''extraites.';

-- Et une contrainte de trop : `source_url` était NOT NULL.
--
-- Le corpus prouve le contraire. Un article issu d'un texte SCANNÉ — une loi de
-- finances de 1994, un Journal officiel d'avant la publication en ligne — n'a
-- pas d'URL. Il a une empreinte SHA-256 du fichier, et c'est elle qui fait foi ;
-- `source_sha256` reste donc NOT NULL, à juste titre.
--
-- Exiger une URL revenait à interdire d'ingérer tout ce qui précède le web. La
-- contrainte disait quelque chose de faux sur le monde.
alter table legal.article_versions alter column source_url drop not null;
