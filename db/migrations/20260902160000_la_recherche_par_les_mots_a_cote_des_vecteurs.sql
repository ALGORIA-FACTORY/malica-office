-- La recherche par les mots, a cote de la recherche par le sens.
--
-- ============================================================ POURQUOI LES DEUX
--
-- La recherche vectorielle est faite pour le SENS. Elle est mauvaise sur les
-- identifiants exacts — et nos utilisateurs cherchent « article 7 », « note
-- commune n° 12 de 2015 », « loi 96-112 », « CSC art. 14 ». Une recherche
-- lexicale les trouve au caractere pres, la ou le vecteur les approche.
--
-- On garde donc DEUX listes et on les fusionne par rang reciproque : chaque
-- resultat vaut 1/(60 + son rang) dans chaque liste, on additionne, on trie.
-- Un texte bien classe dans une seule des deux listes remonte ; un texte bien
-- classe dans les deux gagne.
--
-- ============================================================ CE QUE C'EST, ET PAS
--
-- C'est la recherche plein texte native de PostgreSQL (`tsvector` + ts_rank_cd),
-- pas BM25. La difference tient a la formule de ponderation ; elle ne change
-- pas ce qui compte ici — retrouver un identifiant exact. Installer une
-- extension BM25 sur ce poste serait une dependance de plus pour un gain que
-- rien ne mesure encore. On le dit plutot que de laisser croire.
--
-- La configuration suit la langue du fragment : « french » lemmatise le
-- francais, « simple » se contente de decouper — c'est ce qu'il faut pour
-- l'arabe, qu'aucune configuration livree avec PostgreSQL ne sait lemmatiser.
--
-- L'en-tete entre dans l'index lexical avec le texte : c'est lui qui porte
-- « code de la taxe sur la valeur ajoutee », « article 7 » et « note commune
-- n° 12 de 2015 » — les mots memes que l'on tape.

begin;

alter table legal.chunks
  add column recherche tsvector
  generated always as (
    to_tsvector(
      case when langue = 'ar' then 'simple'::regconfig else 'french'::regconfig end,
      coalesce(entete, '') || ' ' || texte
    )
  ) stored;

create index chunks_recherche_idx on legal.chunks using gin (recherche);

comment on column legal.chunks.recherche is
  'Index lexical du fragment, en-tête comprise. Sert la moitié « mots » de la recherche hybride ; la moitié « sens » vient de embedding.';

commit;
