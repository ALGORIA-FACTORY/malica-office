-- Rattacher chaque article a son autorite, a son statut et a sa publication.
--
-- ================================================== POURQUOI
--
-- La table legal.sources dit, pour chaque type de texte, ce qu'il vaut et a qui
-- il est opposable : une note commune de la DGELF n'oblige que l'administration,
-- ni le contribuable ni le juge, en vertu de l'article 54 de la LFC 2012. Cette
-- table etait juste, et debranchee : aucun article n'y renvoyait. Malica
-- pouvait donc citer un texte sans savoir s'il oblige le contribuable.
--
-- Trois manques, trois colonnes :
--
--   1. legal.articles.source_code  — de quel type de texte l'article releve,
--      donc son autorite et son opposabilite, lues dans legal.sources.
--   2. legal.articles.statut       — l'article est-il encore debout.
--   3. legal.article_versions.jort_reference existait deja et restait vide :
--      elle se remplit desormais depuis l'entete de page du Journal Officiel.
--
-- ================================================== LE VOCABULAIRE DU STATUT
--
-- Les mots ne sont pas interchangeables, et leurs effets non plus :
--
--   en_vigueur           l'article s'applique.
--   abroge               une loi posterieure l'a supprime. L'effet vaut pour
--                        l'avenir : les faits anterieurs restent regis par lui.
--   annule               le juge administratif l'a efface RETROACTIVEMENT ; il
--                        est repute n'avoir jamais existe.
--   caduc                il s'est eteint seul, son terme etant echu.
--   non_entre_en_vigueur il est publie mais sa date d'effet n'est pas atteinte.
--   indetermine          nous ne savons pas. C'est le cas des articles des lois
--                        de finances anciennes : le texte a modifie un code il y
--                        a trente ans, nous ne detenons pas de quoi dire s'il
--                        tient encore.
--
-- 'annule', 'caduc' et 'non_entre_en_vigueur' ne sont produits par aucun script
-- aujourd'hui : rien dans les editions consolidees ne les porte. Ils sont dans
-- le domaine parce qu'ecrire 'abroge' a la place serait faux, et qu'un jour une
-- decision du Tribunal administratif entrera dans le corpus.

begin;

-- Un decret-loi porte force de loi. Il manquait au referentiel : les lois de
-- finances 2011, 2021, 2022 et 2023 ont ete prises sous cette forme.
insert into legal.sources (code, libelle, autorite, opposable_a, fondement)
values ('DECRET_LOI', 'Decret-loi', 'normative',
        array['administration','contribuable','juge'], '')
on conflict (code) do nothing;

alter table legal.articles
  add column if not exists source_code text references legal.sources (code),
  add column if not exists statut text not null default 'indetermine',
  add column if not exists abroge_par text;

alter table legal.articles drop constraint if exists articles_statut_check;
alter table legal.articles add constraint articles_statut_check
  check (statut in ('en_vigueur', 'abroge', 'annule', 'caduc',
                    'non_entre_en_vigueur', 'indetermine'));

-- Un article abroge doit dire par quoi : sans la citation, l'affirmation ne se
-- verifie pas.
alter table legal.articles drop constraint if exists articles_abrogation_citee;
alter table legal.articles add constraint articles_abrogation_citee
  check (statut <> 'abroge' or abroge_par is not null);

create index if not exists articles_source_code_idx on legal.articles (source_code);
create index if not exists articles_statut_idx on legal.articles (statut)
  where statut <> 'en_vigueur';

comment on column legal.articles.source_code is
  'Type de texte dont releve l''article ; donne son autorite et son opposabilite via legal.sources.';
comment on column legal.articles.statut is
  'en_vigueur, abroge, annule, caduc, non_entre_en_vigueur, indetermine. Voir la migration 20260901143000.';
comment on column legal.articles.abroge_par is
  'Citation, verbatim, de la mention d''abrogation relevee dans le texte.';
comment on column legal.article_versions.jort_reference is
  'Numero et date du Journal Officiel, et page, releves sur l''entete de page de l''edition.';

commit;
