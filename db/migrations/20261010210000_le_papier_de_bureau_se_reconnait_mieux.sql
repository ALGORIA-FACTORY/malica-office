-- Le papier de bureau se reconnaît mieux, et « non classé » reste assumé.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 10 octobre 2026, 21 h 58. Facture PAPETERIE NOUR, deux lignes :
--
--     Fournitures   467,000   ← reconnu
--     Non classée    47,700   ← « Post-it 76×76 (lot de 12) »
--
-- « Non classé revient encore une fois. »
--
-- La règle de libellé `FOURNITURES` énumère papeterie, ramette, cartouche,
-- stylo, classeur, agrafeuse, enveloppe… et pas le post-it. Rien n'était
-- cassé : le motif ne couvrait pas le mot.
--
-- ===================================================== CE QUE CETTE MIGRATION N'EST PAS
--
-- Ce n'est pas la correction d'un défaut, c'est l'élargissement d'un DÉFAUT
-- LIVRÉ (R10). Et il faut le dire, parce que la tentation inverse est forte :
-- élargir le motif jusqu'à ce que plus rien ne tombe en « non classé ».
--
-- Ce serait une faute. `NON_CLASSE` est le dernier recours ASSUMÉ : « je ne
-- sais pas » est une réponse honnête, et un produit qui range tout quelque
-- part range forcément des choses au mauvais endroit — en silence. Mieux vaut
-- une ligne visiblement non classée qu'une ligne faussement classée : la
-- première se corrige en un geste, la seconde ne se voit jamais.
--
-- Les termes ajoutés sont donc ceux d'un consommable de bureau tunisien
-- ordinaire, et rien de plus large. La règle reste surchargeable par le
-- cabinet.
--
-- ============================================ POURQUOI CLORE PLUTÔT QUE RÉÉCRIRE
--
-- L'ancienne règle a servi à ranger des pièces. On doit pouvoir expliquer un
-- classement ancien — c'est la raison qui a fait clore « syndic → LOYER » le
-- 7 octobre, et c'est la même ici.
--
-- ===================================================================== R11
--
-- `valid_from` et `valid_to` sont pris sur `effective_from` du pack : aucune
-- date du jour n'entre dans le référentiel.

-- --- 1. L'ancienne règle de libellé est CLOSE ------------------------------------------------

update ref.charge_famille_rules r
   set valid_to = (select p.effective_from from ref.jurisdiction_packs p where p.id = r.pack_version_id)
 where r.match_kind = 'designation_pattern'
   and r.famille_code = 'FOURNITURES'
   and r.pattern like '%agrafeuse%'
   and r.valid_to is null;

-- --- 2. Celle qui la remplace ----------------------------------------------------------------
--
-- Ajouts, et la raison de chacun :
--
--   post-it / post it, bloc-notes, chemise, intercalaire, trombone, pochette, registre,
--   cahier, marqueur, surligneur, correcteur, colle, ciseaux, perforateur,
--   calculatrice, parapheur, bloc    — le consommable de bureau courant ;
--   scotch, ruban adhésif, adhésif   — vendus sous trois noms en Tunisie ;
--   gobelet, essuie-main, savon      — l'entretien de bureau, déjà couvert par
--                                      « produit d'entretien » mais pas sous
--                                      ces noms-là ;
--   قرطاسية                          — « papeterie » en arabe, à côté de لوازم.
--
-- Le séparateur est « [- ]? » et non « -? » : une facture écrit « Post it »
-- aussi souvent que « Post-it », et un motif qui n'accepte que le trait
-- d'union laisse passer une ligne sur deux. Relevé par l'épreuve, pas deviné.
--
-- « lot de » n'est PAS ajouté : il qualifie un conditionnement, pas une
-- nature, et rangerait un lot de n'importe quoi en fournitures.

insert into ref.charge_famille_rules
  (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, 'FOURNITURES', 'designation_pattern', v.motif, 5, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('(fourniture|papeterie|ramette|papier +a4|cartouche|toner|encre|stylo|classeur|agrafeuse|enveloppe|post[- ]?it|bloc[- ]?note|bloc +de +papier|cahier|registre|chemise +(cartonn|[aà] +sangle)|intercalaire|trombone|pochette|marqueur|surligneur|correcteur|colle|ciseaux|perforateur|calculatrice|parapheur|scotch|ruban +adh[eé]sif|adh[eé]sif|gobelet|essuie[- ]?main|savon|c[aâ]ble|prise|interrupteur|disjoncteur|ampoule|lampe|bo[iî]te +app|visserie|quincaillerie|outillage|consommable|produit +d.entretien|لوازم|قرطاسية)')
 ) as v(motif)
 where p.jurisdiction = 'TN'
on conflict do nothing;
