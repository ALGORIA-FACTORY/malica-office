-- L'ordre dans lequel le conseil lit les textes : en base, et non dans le code.
--
-- Stratégie confirmée par le dirigeant le 11 novembre 2026
-- (`docs/validation-chat-malica/strategie-corpus-2026-11-11.md`) : le code
-- consolidé d'abord, puis la loi, puis la loi de finances, puis la note
-- commune. Mesuré le même jour : sur « la retenue sur les honoraires » et sur
-- « le timbre d'une facture », la recherche ne remettait au modèle que des
-- notes communes, alors que l'article du code existait.
--
-- CE QUE CET ORDRE N'EST PAS. Ce n'est pas la hiérarchie des normes : une loi
-- de finances a le rang de la loi et l'emporte par sa date (`legal.sources.
-- fondement` le dit déjà), et la règle du temps reste portée par les versions
-- d'article. C'est un ordre de LECTURE : à pertinence voisine, quel texte le
-- modèle lit en premier et cite pour la règle. Le code consolidé passe devant
-- parce qu'il porte déjà les modifications des lois de finances à leur date.
--
-- R10 : ce sont des valeurs de départ. Elles se changent par une ligne, sans
-- déploiement ; un expert-comptable peut les contester.
--
--   1. `legal.sources.ordre_de_lecture` : l'ordre d'une nature de texte.
--   2. `legal.corpus_noms.ordre_de_lecture` : celui d'un corpus, quand il
--      diffère de sa nature. Un code consolidé (`porte_le_droit`) se lit avant
--      la loi dont il est fait.

begin;

alter table legal.sources
  add column if not exists ordre_de_lecture smallint
    check (ordre_de_lecture between 1 and 99);

comment on column legal.sources.ordre_de_lecture is
  'Ordre de lecture du conseil, le plus petit d''abord. Pas la hiérarchie des normes : à '
  'pertinence voisine, le texte que le modèle lit et cite en premier. Vide : lu en dernier.';

update legal.sources s
   set ordre_de_lecture = v.ordre
  from (values
    ('LOI', 2),
    ('DECRET_LOI', 2),
    ('CONVENTION', 2),
    ('LF', 3),
    ('DECRET', 4),
    ('ARRETE', 5),
    ('NOTE_COMMUNE', 6),
    ('PRISE_POSITION', 7)
  ) as v(code, ordre)
 where s.code = v.code
   and s.ordre_de_lecture is null;

alter table legal.corpus_noms
  add column if not exists ordre_de_lecture smallint
    check (ordre_de_lecture between 1 and 99);

comment on column legal.corpus_noms.ordre_de_lecture is
  'Ordre de lecture propre à ce corpus ; vide, celui de la nature du texte (legal.sources). '
  'Un code consolidé se lit avant la loi : il porte déjà les modifications à leur date.';

update legal.corpus_noms
   set ordre_de_lecture = 1
 where porte_le_droit
   and ordre_de_lecture is null;

commit;
