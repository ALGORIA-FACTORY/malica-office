-- ======================================================================
--  Un logiciel acheté se reconnaît (5 novembre 2026).
--
--  Relevé sur staging (SOFT-INTEGRA, facture SI-26-0045) : une licence
--  perpétuelle d'ERP, son paramétrage et sa reprise de données, une
--  formation et une maintenance annuelle partaient en entier au 601 —
--  achats stockés de matières premières. Deux trous du référentiel, comblés
--  par des DÉFAUTS que l'expert-comptable confirme (R10) :
--
--   1. le paramétrage, la reprise des données, l'implémentation ou
--      l'intégration d'un logiciel n'avaient pas de famille de charge : ils
--      vont aux études et services extérieurs (617, famille ETUDES) ;
--   2. une licence perpétuelle ou un logiciel de gestion acquis ne se
--      signalait pas comme bien susceptible d'être immobilisé (213
--      Logiciels) : il reçoit la réserve « immobilisation ou charge : à
--      trancher », comme un ordinateur. Le Socle ne décide pas
--      d'immobiliser ; il dit que la question se pose.
--
--  INCERTAIN (à confirmer par un expert-comptable) : les deux listes. Les
--  coûts directement attribuables à la mise en service d'un logiciel
--  immobilisé (paramétrage, reprise des données) s'immobilisent avec lui
--  selon la norme des immobilisations incorporelles ; le défaut les range en
--  charge, et la réserve de la licence pose la question pour la facture
--  entière.
--
--  REJEU (R11) : `valid_from` en littéral ; aucune horloge n'écrit dans `ref`.
-- ======================================================================

begin;

insert into ref.charge_famille_rules (pack_version_id, famille_code, match_kind, pattern, priority,
                                      valid_from)
select p.id, 'ETUDES', 'designation_pattern',
       '(param[eé]trage|reprise +des +donn[eé]es|migration +des +donn[eé]es|impl[eé]mentation'
       '|int[eé]gration +(du +|d.)?(logiciel|progiciel|erp)|d[eé]ploiement +(du +|d.)?(logiciel|progiciel|erp))',
       4, date '2026-01-01'
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN' and p.version = '2026.1';

insert into ref.biens_immobilisables
  (pack_version_id, motif, famille, langue, incertain, source, valid_from)
select p.id, v.motif, 'LOGICIEL', 'fr', true,
       'Liste INCERTAINE posée le 5 novembre 2026 (staging, facture SI-26-0045 : une licence '
       'perpétuelle d''ERP partait en charge, au 601, sans réserve) : elle signale, elle ne décide '
       'pas. À confirmer par un expert-comptable.',
       date '2026-01-01'
  from ref.jurisdiction_packs p
 cross join (values
   ('(?<!\p{L})licences?\s+perp[ée]tuelles?(?!\p{L})'),
   ('(?<!\p{L})(acquisition|achat)\s+(de\s+|d[''’]\s*)?(logiciels?|progiciels?)(?!\p{L})'),
   ('(?<!\p{L})(logiciels?|progiciels?)\s+(de\s+gestion|comptables?|erp)(?!\p{L})')
 ) as v(motif)
 where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict do nothing;

commit;
