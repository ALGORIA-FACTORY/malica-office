-- ============================================================================
-- Les conventions fiscales entrent dans la recherche.
-- ============================================================================
--
-- CE QUI SE PASSAIT AVANT
--
-- Malica ne voyait AUCUNE des 43 conventions fiscales que la Tunisie a
-- signées. Pas parce qu'elle oubliait de les consulter : parce qu'elles
-- étaient structurellement exclues de sa recherche.
--
-- Conséquence concrète : dès qu'un paiement franchit la frontière — une
-- redevance, une assistance technique, des honoraires versés à un
-- non-résident — elle répondait avec le seul droit interne. Or une convention
-- prime sur la loi et plafonne le taux de retenue. Sa réponse pouvait donc
-- être exacte au regard du code, et fausse pour le client.
--
-- CE QUI CAUSAIT CELA
--
-- La recherche ne retenait, par défaut, que les corpus marqués
-- « CODE_CONSOLIDE » dans la file d'ingestion. Or :
--
--     CODE_CONSOLIDE    51 documents      ← les seuls visibles
--     CONVENTION        48 documents      ← jamais
--     NORME_COMPTABLE   42 documents      ← jamais
--
-- Une convention n'est pas un code consolidé, et n'a aucune raison de l'être.
-- Le filtre confondait « ce document est un code » avec « ce document dit le
-- droit en vigueur ».
--
-- CE QUE CETTE MIGRATION FAIT
--
-- Elle nomme la vraie question — ce corpus DIT-IL le droit en vigueur ? — et
-- la pose sur le corpus lui-même, une fois pour toutes.
--
--   les codes            oui, c'est leur fonction
--   les conventions      oui, elles sont en vigueur et priment sur la loi
--   les lois autonomes   oui
--   les notes communes   non — de la doctrine, avec son propre commutateur
--   les lois de finances non — elles MODIFIENT le droit, elles ne l'énoncent
--                        pas. Les mêler aux codes noierait l'état du droit
--                        sous les textes qui l'ont fait
--
-- Un corpus pas encore nommé — Cowork en ajoute pendant que j'écris — garde
-- l'ancien comportement plutôt que de disparaître. Rien ne régresse.
-- ============================================================================

alter table legal.corpus_noms
  add column if not exists porte_le_droit boolean not null default false;

comment on column legal.corpus_noms.porte_le_droit is
  'Ce corpus énonce-t-il le droit en vigueur ? Un code et une convention, oui. '
  'Une loi de finances modifie le droit sans l''énoncer : non. Une note commune '
  'l''interprète : non, elle a son propre commutateur.';

update legal.corpus_noms
   set porte_le_droit = (famille in ('code', 'convention', 'loi'))
 where porte_le_droit is distinct from (famille in ('code', 'convention', 'loi'));

-- Les corpus arrivés depuis le premier nommage. Ceux dont le titre n'a pas été
-- relu dans leur propre texte restent sans nom — le code s'affiche à la place,
-- ce qui est vrai, là où un nom deviné serait faux.
insert into legal.corpus_noms (code, nom_fr, nom_ar, famille, porte_le_droit)
select distinct a.corpus,
       case
         when a.corpus like 'LF-%'  then 'loi de finances ' || right(a.corpus, 4)
         when a.corpus like 'LFC-%' then 'loi de finances complémentaire ' || right(a.corpus, 4)
         when a.corpus like 'DECRET_LOI_FINANCES-%'
                                    then 'décret-loi de finances ' || right(a.corpus, 4)
         when a.corpus like 'NC-%'  then 'notes communes ' || right(a.corpus, 4)
         when a.corpus like 'CONV-%'
           then 'convention fiscale Tunisie–' ||
                initcap(replace(lower(substring(a.corpus from 6)), '-', ' '))
       end,
       case
         when a.corpus like 'LF-%'  then 'قانون المالية ' || right(a.corpus, 4)
         when a.corpus like 'LFC-%' then 'قانون المالية التكميلي ' || right(a.corpus, 4)
         when a.corpus like 'DECRET_LOI_FINANCES-%'
                                    then 'مرسوم قانون المالية ' || right(a.corpus, 4)
         when a.corpus like 'NC-%'  then 'المذكرات العامة ' || right(a.corpus, 4)
         when a.corpus like 'CONV-%' then 'اتفاقية جبائية'
       end,
       case
         when a.corpus like 'NC-%'   then 'doctrine'
         when a.corpus like 'CONV-%' then 'convention'
         else 'loi_finances'
       end,
       a.corpus like 'CONV-%'
  from legal.articles a
 where a.corpus like 'LF-%' or a.corpus like 'LFC-%'
    or a.corpus like 'DECRET_LOI_FINANCES-%' or a.corpus like 'NC-%'
    or a.corpus like 'CONV-%'
on conflict (code) do nothing;

create index if not exists corpus_noms_porte_le_droit_idx
  on legal.corpus_noms (code) where porte_le_droit;
