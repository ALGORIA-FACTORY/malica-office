-- L'en-tete pese plus que le corps dans l'index lexical.
--
-- ============================================================ CE QU'ON A MESURE
--
-- A la question « convention fiscale entre la Tunisie et l'Arabie saoudite :
-- imposition des dividendes », la recherche rendait vingt conventions — Suede,
-- Pays-Bas, Italie, Etats-Unis... — et PAS celle avec l'Arabie saoudite.
--
-- La raison tient a une propriete de ts_rank_cd : il compte les occurrences,
-- il ne pondere pas par la RARETE des mots. C'est ce qui le separe de BM25.
-- « convention », « fiscale », « imposition », « dividendes » reviennent des
-- dizaines de fois dans le corps de chaque convention ; « Arabie saoudite »
-- n'apparait qu'une fois, dans l'en-tete de la bonne. Le bruit gagnait contre
-- le signal.
--
-- ============================================================ LE REMEDE
--
-- PostgreSQL sait ponderer par POSITION dans le document : quatre poids, A a D.
-- On range donc l'en-tete en A et le corps en D, et le classement multiplie par
-- dix ce qui est trouve dans l'en-tete. L'en-tete porte l'identite du texte —
-- son code, son numero, son millesime, sa nature — c'est-a-dire exactement ce
-- qu'un praticien tape quand il cherche un texte precis.
--
-- Ce n'est pas BM25, et cela ne le remplace pas : c'est une ponderation par
-- position, pas par rarete. Mais sur ce corpus, l'identite EST dans l'en-tete,
-- et la ponderation par position y produit l'effet qu'on attendait de la rarete.

begin;

drop index if exists legal.chunks_recherche_idx;
alter table legal.chunks drop column if exists recherche;

alter table legal.chunks
  add column recherche tsvector
  generated always as (
    setweight(
      to_tsvector(
        case when langue = 'ar' then 'simple'::regconfig else 'french'::regconfig end,
        coalesce(entete, '')
      ), 'A')
    ||
    setweight(
      to_tsvector(
        case when langue = 'ar' then 'simple'::regconfig else 'french'::regconfig end,
        texte
      ), 'D')
  ) stored;

create index chunks_recherche_idx on legal.chunks using gin (recherche);

comment on column legal.chunks.recherche is
  'Index lexical du fragment : l''en-tête en poids A, le texte en poids D. Le classement doit passer le tableau de poids {0.1, 0.2, 0.4, 1.0} à ts_rank_cd, sinon la pondération ne sert à rien.';

commit;

analyze legal.chunks;
