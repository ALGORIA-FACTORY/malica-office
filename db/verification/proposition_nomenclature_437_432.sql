-- Le droit de timbre et la retenue à la source quittent la série de la TVA.
--
-- NON APPLIQUÉE — EN ATTENTE DE LA VALIDATION D'UN EXPERT-COMPTABLE.
--
-- Volontairement hors de `db/migrations/` : un `charger.ps1 -Recreate` ne doit
-- pas l'emporter. Le jour où les numéros sont confirmés, ce fichier est déplacé
-- dans `db/migrations/` sous un horodatage — c'est un déplacement, rien d'autre
-- n'est à changer.
--
-- Ce qu'elle fera ce jour-là n'est pas anodin : elle SUPPRIME deux lignes de
-- ref.accounts et COMPTABILISE des écritures de reclassement. Une écriture
-- comptabilisée ne se retire pas — c'est R7, et le déclencheur le refuserait.
-- D'où l'exigence de validation : ce n'est pas une précaution de forme.
--
-- Elle remplace `proposition_compte_4369.sql`, dont la conclusion était fausse :
-- 4369 porte un libellé juste dans une série fausse.
--
-- ====================================================== CE QUI EST TRANCHÉ
--
-- La série 436 est « Taxes sur le chiffre d'affaires » : elle est réservée à la
-- TVA. Deux comptes y sont rangés à tort.
--
-- Le DROIT DE TIMBRE n'est pas une taxe sur le chiffre d'affaires. C'est un
-- droit forfaitaire d'un dinar par facture, hors TVA, porté sur une ligne
-- distincte. Il relève de la série 437, « Autres impôts, taxes et versements
-- assimilés ».
--
-- La RETENUE À LA SOURCE relève de la série 432, « Impôts et taxes retenus à la
-- source ».
--
-- ================================================= CE QUI RESTE À CONFIRMER
--
-- Les NUMÉROS de sous-compte. 4371 et 4321 sont les premiers libres de leur
-- série ; un plan comptable tunisien peut les vouloir ailleurs. Ce sont les
-- deux seules valeurs de ce fichier qu'un expert doit encore confirmer.
--
-- ====================================================== ÉTAT CONSTATÉ EN BASE
--
--   4366 | 436 | Etat - TVA deductible        <- correct, série TVA
--   4367 | 436 | Etat - TVA collectee         <- correct, série TVA
--   4368 | 436 | Etat - Retenue a la source   <- MAUVAISE SÉRIE
--   4369 | 436 | Etat - Timbre fiscal         <- MAUVAISE SÉRIE
--   6654 | 665 | Droits d'enregistrement et de timbre  <- correct, côté achat
--
--   ref.fiscal_charges
--     DROIT_TIMBRE | facture_achat | 6654   <- correct, on n'y touche pas
--     DROIT_TIMBRE | facture_vente | 4367   <- le défaut : imputé sur la TVA collectée
--
--   ref.account_mappings : 4367 est le compte de TVA des cinq codes de vente.
--
-- Le vendeur a une dette envers l'État, l'acheteur a une charge : deux comptes
-- de natures différentes, c'est normal, et 6654 reste où il est.
--
-- Ni 4368 ni 4369 n'est référencé par `ref.fiscal_charges` ni par
-- `ref.account_mappings` — vérifié. Les retirer ne casse aucune imputation.

\set ON_ERROR_STOP on

-- ============================================ 0. GARDE : ne rien casser en silence
do $$
declare n integer;
begin
  select count(*) into n
    from ref.fiscal_charges where account_code in ('4368', '4369');
  if n > 0 then
    raise exception '4368/4369 sont référencés par ref.fiscal_charges : relire avant de continuer';
  end if;

  select count(*) into n
    from ref.account_mappings
   where vat_account in ('4368', '4369') or counterparty_account in ('4368', '4369')
      or main_account in ('4368', '4369');
  if n > 0 then
    raise exception '4368/4369 sont référencés par ref.account_mappings : relire avant de continuer';
  end if;
end $$;

-- ============================================ 1. LES DEUX SÉRIES ET LEURS COMPTES
--
-- Les têtes de série sont créées aussi : `parent_code` pointait jusqu'ici sur
-- « 436 », qui n'existe pas comme ligne. Une hiérarchie dont les parents sont
-- absents ne se parcourt pas.

insert into ref.accounts (pack_version_id, account_code, parent_code, account_class, label)
select p.id, v.code, v.parent, '4', v.label
  from ref.jurisdiction_packs p,
       (values
         ('432',  '43', 'Etat - Impots et taxes retenus a la source'),
         ('437',  '43', 'Etat - Autres impots, taxes et versements assimiles'),
         -- numéro à confirmer
         ('4321', '432', 'Etat - Retenue a la source'),
         -- numéro à confirmer
         ('4371', '437', 'Etat - Timbre fiscal collecte')
       ) as v(code, parent, label)
 where p.jurisdiction = 'TN'
on conflict do nothing;

-- ============================================ 2. LA RÉIMPUTATION
--
-- Le côté VENTE seulement. Le côté achat reste sur 6654.

update ref.fiscal_charges fc
   set account_code = '4371'          -- numéro à confirmer
  from ref.jurisdiction_packs p
 where fc.pack_version_id = p.id
   and p.jurisdiction = 'TN'
   and fc.code = 'DROIT_TIMBRE'
   and fc.document_kind = 'facture_vente'
   and fc.account_code = '4367';

-- ============================================ 3. LES DEUX COMPTES MAL RANGÉS
--
-- Retirés, pas renommés : un compte qui garde son numéro dans la mauvaise série
-- continue de tromper toute lecture par série. Le garde de l'étape 0 a déjà
-- établi que rien ne les référence.

delete from ref.accounts a
 using ref.jurisdiction_packs p
 where a.pack_version_id = p.id
   and p.jurisdiction = 'TN'
   and a.account_code in ('4368', '4369');

-- ============================================ 4. CE QUI EST DÉJÀ COMPTABILISÉ
--
-- État des lieux. À ce jour la base locale n'en contient aucune ligne ; la
-- production en a peut-être.

select e.tenant_id,
       date_trunc('year', e.date_ecriture)::date as exercice,
       count(*) as lignes,
       sum(l.credit::numeric) as timbre_credite_sur_4367
  from socle.ecriture_lignes l
  join socle.ecritures e on e.id = l.ecriture_id
 where l.account_code = '4367'
   and l.libelle ilike '%timbre%'
   and e.status = 'booked'
 group by 1, 2
 order by 1, 2;

-- ============================================ 5. LE RECLASSEMENT
--
-- Une écriture NOUVELLE par locataire, datée du jour, jamais un update — R7, et
-- le déclencheur `app.deny_mutation()` le refuserait de toute façon.
--
-- Elle référence la pièce d'origine quand il n'y en a qu'une ; sinon `null`,
-- parce qu'un reclassement qui agrège plusieurs pièces n'appartient à aucune.
--
-- Le journal est « OD » — opérations diverses —, qui est la place d'un
-- reclassement. Le libellé nomme l'opération et les deux comptes, pour qu'un
-- contrôleur comprenne sans avoir à ouvrir le dossier.

do $$
declare
  t        record;
  nouvelle uuid;
  v_pack   uuid;
  v_piece  uuid;
  n        integer := 0;
begin
  select id into v_pack from ref.jurisdiction_packs
   where jurisdiction = 'TN' order by effective_from desc limit 1;

  for t in
    select e.tenant_id, e.devise, sum(l.credit::numeric) as montant,
           min(e.piece_id) as piece_unique, count(distinct e.piece_id) as pieces
      from socle.ecriture_lignes l
      join socle.ecritures e on e.id = l.ecriture_id
     where l.account_code = '4367' and l.libelle ilike '%timbre%'
       and e.status = 'booked'
     group by e.tenant_id, e.devise
     having sum(l.credit::numeric) > 0
  loop
    -- La pièce d'origine n'est référencée que s'il n'y en a qu'une : un
    -- reclassement qui agrège plusieurs pièces n'appartient à aucune.
    v_piece := case when t.pieces = 1 then t.piece_unique else null end;

    nouvelle := public.socle_ecriture_propose(
      v_piece, 'OD', current_date,
      'Reclassement du droit de timbre - 4367 vers 4371',
      v_pack,
      jsonb_build_array(
        jsonb_build_object('ordinal', 1, 'account_code', '4367',
                           'libelle', 'Timbre extrait de la TVA collectee',
                           'debit', t.montant, 'credit', 0),
        jsonb_build_object('ordinal', 2, 'account_code', '4371',
                           'libelle', 'Timbre fiscal collecte',
                           'debit', 0, 'credit', t.montant)),
      t.devise);
    perform public.socle_ecriture_book(nouvelle);
    n := n + 1;
  end loop;

  raise notice '% ecriture(s) de reclassement passee(s)', n;
end $$;
