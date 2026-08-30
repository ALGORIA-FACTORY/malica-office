-- PROPOSITION — NON APPLIQUÉE, EN ATTENTE DE VALIDATION COMPTABLE.
--
-- Ce fichier est volontairement hors de `db/migrations/` : il ne doit pas partir
-- avec un `charger.ps1 -Recreate`. Le jour où l'expert valide, il est déplacé
-- dans `db/migrations/` sous un horodatage, et pas avant.
--
-- ============================================================== LE CONSTAT
--
-- Le droit de timbre sur les factures de VENTE est imputé sur le compte 4367,
-- qui est le compte de TVA collectée. Vérifié en base :
--
--   ref.fiscal_charges
--     DROIT_TIMBRE | facture_achat | 6654  « Droits d'enregistrement et de timbre »
--     DROIT_TIMBRE | facture_vente | 4367  « Etat - TVA collectee »        <-- ici
--
--   ref.account_mappings — 4367 est AUSSI le compte de TVA des cinq codes de vente
--     facture_vente | EXO    | vat_account = 4367
--     facture_vente | EXPORT | vat_account = 4367
--     facture_vente | TVA07  | vat_account = 4367
--     facture_vente | TVA13  | vat_account = 4367
--     facture_vente | TVA19  | vat_account = 4367
--
-- Conséquence : le timbre et la TVA collectée s'accumulent dans le même solde.
-- Toute déclaration de TVA bâtie sur le solde de 4367 est fausse du montant des
-- timbres de la période.
--
-- Le compte destiné à cela existe déjà dans la nomenclature du pack :
--     4369  « Etat - Timbre fiscal »
--
-- ============================================= CE QUI DOIT ÊTRE VALIDÉ
--
-- Je ne suis pas comptable, et le choix d'un compte n'est pas une question
-- technique. Trois points appellent votre décision :
--
--   1. 4369 « Etat - Timbre fiscal » est-il bien le compte attendu pour le
--      timbre COLLECTÉ sur une facture de vente ? Le timbre facturé au client
--      est une dette envers l'État, donc un compte de classe 4 — 4369 en a la
--      forme. Mais certains plans le logent ailleurs.
--
--   2. Faut-il, symétriquement, revoir le côté ACHAT ? Il est aujourd'hui sur
--      6654 « Droits d'enregistrement et de timbre », un compte de charge —
--      ce qui est cohérent pour un timbre supporté. Je ne propose pas d'y
--      toucher.
--
--   3. Les écritures DÉJÀ passées. R7 interdit de modifier une écriture. Le
--      reclassement doit donc être une écriture NOUVELLE, datée du jour de la
--      correction, et non une réécriture du passé. Le bloc 3 ci-dessous la
--      prépare — mais son journal, sa date et son libellé sont des choix
--      comptables, pas techniques.
--
-- ============================================================ 1. LE RÉFÉRENTIEL

update ref.fiscal_charges
   set account_code = '4369'
 where code = 'DROIT_TIMBRE'
   and document_kind = 'facture_vente'
   and account_code = '4367';

-- ================================================== 2. CE QUI EST DÉJÀ COMPTABILISÉ
--
-- État des lieux avant tout reclassement : combien de lignes, pour quel montant,
-- sur quels exercices. À ce jour la base locale n'en contient aucune — mais la
-- production, elle, en a peut-être.

select e.tenant_id,
       date_trunc('year', e.date_ecriture)::date as exercice,
       count(*) as lignes,
       sum(l.credit::numeric) as timbre_credite
  from socle.ecriture_lignes l
  join socle.ecritures e on e.id = l.ecriture_id
 where l.account_code = '4367'
   and l.libelle ilike '%timbre%'
   and e.status = 'booked'
 group by 1, 2
 order by 1, 2;

-- ================================================ 3. L'ÉCRITURE DE RECLASSEMENT
--
-- Une écriture NOUVELLE par locataire concerné : débit de 4367 (on retire le
-- timbre de la TVA collectée), crédit de 4369 (on le porte où il doit être).
-- Le passé n'est pas touché — c'est R7, et c'est aussi ce qu'un contrôleur
-- attend de voir : la trace de la correction, pas sa dissimulation.
--
-- Laissé en commentaire : le journal, la date et le libellé sont à fixer par
-- l'expert, et le montant doit être arrêté sur les chiffres du bloc 2.
--
-- do $$
-- declare t record; nouvelle uuid;
-- begin
--   for t in
--     select e.tenant_id, sum(l.credit::numeric) as montant
--       from socle.ecriture_lignes l
--       join socle.ecritures e on e.id = l.ecriture_id
--      where l.account_code = '4367' and l.libelle ilike '%timbre%'
--        and e.status = 'booked'
--      group by e.tenant_id
--      having sum(l.credit::numeric) > 0
--   loop
--     nouvelle := public.socle_ecriture_propose(
--       null, 'OD', current_date,
--       'Reclassement du droit de timbre — 4367 vers 4369',
--       (select id from ref.jurisdiction_packs where jurisdiction = 'TN'
--         order by effective_from desc limit 1),
--       jsonb_build_array(
--         jsonb_build_object('ordinal', 1, 'account_code', '4367',
--                            'libelle', 'Timbre extrait de la TVA collectee',
--                            'debit', t.montant, 'credit', 0),
--         jsonb_build_object('ordinal', 2, 'account_code', '4369',
--                            'libelle', 'Timbre fiscal collecte',
--                            'debit', 0, 'credit', t.montant)),
--       'TND');
--     perform public.socle_ecriture_book(nouvelle);
--   end loop;
-- end $$;
