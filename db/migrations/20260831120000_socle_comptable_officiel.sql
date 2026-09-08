-- Le pont vers le référentiel officiel : ce que `ref.accounts` doit porter avant lui.
--
-- ========================================================== CE QUI ARRIVE
--
-- Le paquet `docs/Base de connaissance` apporte la nomenclature NC 01 verbatim —
-- 611 comptes — plus quinze extensions Malica justifiées une par une, 160 rôles
-- comptables, 182 schémas d'écriture, 454 paramètres fiscaux datés et sourcés, et
-- 43 obligations déclaratives.
--
-- Nos vingt comptes actuels sont des approximations : « Etat - TVA collectee » là
-- où NC 01 écrit « Taxes sur le chiffre d'affaires collectées par l'entreprise »,
-- « Banque » pour « Banques », un compte 540 qui n'existe pas dans la norme. Elles
-- ont servi à démarrer ; elles ne peuvent pas cohabiter avec le verbatim.
--
-- ========================================================== POURQUOI ON EFFACE
--
-- Les semences officielles sont gardées par `not exists` : elles n'écrasent rien.
-- Laisser nos vingt lignes en place les ferait donc SURVIVRE au chargement, avec
-- leurs libellés approximatifs et `is_official = false` — c'est-à-dire le pire des
-- deux mondes : un plan qui se dit officiel et ne l'est pas.
--
-- On les retire donc d'abord. Vérifié avant, et non supposé :
--   — aucune clé étrangère ne pointe `ref.accounts` ; les imputations référencent
--     un CODE, pas une ligne ;
--   — dix-neuf des vingt codes sont fournis à l'identique par le paquet, donc les
--     imputations existantes restent valides après rechargement ;
--   — le vingtième, 540, n'existe pas dans NC 01 (la norme a 54, 541, 5411) et
--     n'est référencé par rien.
--
-- ============================================== ET 4321, QUE J'AVAIS INVENTÉ
--
-- Hier j'ai créé 4321 « Etat - Retenue a la source » comme sous-compte de 432.
-- Le travail officiel dit autre chose, et il a raison : NC 01 ne subdivise pas
-- 432, et la liaison du rôle RETENUE_SOURCE_OPEREE pointe 432 directement. 4321
-- disparaît avec les autres.
--
-- Mon 4371 pour le timbre, lui, est confirmé — et pour le même motif que celui
-- que j'avais écrit : la série 436 est fermée au timbre, seul 437 l'accueille.
-- Le paquet le fournit comme extension, avec sa justification.
--
-- ========================================================== R10 EN ACTE
--
-- C'est exactement ce que R10 décrit : Malica avait livré un défaut pour que le
-- produit tourne, l'expert a fait le travail, le défaut cède. La colonne
-- `is_official` rend désormais la frontière lisible — ce qui est verbatim NC 01
-- ne se modifie pas, ce que Malica a ouvert reste ajustable.

-- ------------------------------------------------- 1. les colonnes du socle
--
-- `normal_side`, `is_collective` et `requires_auxiliary` ne figurent PAS dans le
-- texte officiel : ce sont des conventions de saisie, paramétrables, et elles ne
-- peuvent jamais être opposées comme une règle normative.
alter table ref.accounts
  add column if not exists normal_side        text
    check (normal_side in ('debit', 'credit')),
  add column if not exists is_collective      boolean not null default false,
  add column if not exists requires_auxiliary boolean not null default false,
  add column if not exists is_official        boolean not null default false,
  add column if not exists source_ref         text;

comment on column ref.accounts.is_official is
  'true = verbatim NC 01 (nomenclature officielle SCE), non modifiable. '
  'false = subdivision ouverte par Malica, ajustable par l''expert.';

comment on column ref.accounts.normal_side is
  'Convention produit, absente du texte officiel : sens usuel du solde, pour '
  'l''ergonomie de saisie. Jamais opposable comme règle normative. null = '
  'indifféremment débiteur ou créditeur.';

-- --------------------------------------- 2. les approximations sont retirées
--
-- Un garde plutôt qu'une confiance : si une clé étrangère apparaissait un jour,
-- cette migration doit s'arrêter au lieu de casser en cascade.
do $$
declare n integer;
begin
  select count(*) into n from pg_constraint where confrelid = 'ref.accounts'::regclass;
  if n > 0 then
    raise exception 'ref.accounts est désormais référencé par % clé(s) étrangère(s) : relire avant d''effacer', n;
  end if;
end $$;

delete from ref.accounts a
 using ref.jurisdiction_packs p
 where a.pack_version_id = p.id
   and p.jurisdiction = 'TN'
   and not a.is_official;

-- ------------------------------------ 3. un compte officiel ne se modifie pas
--
-- La protection vaut pour le chemin de paramétrage comme pour la main : c'est un
-- déclencheur, pas une convention.
create or replace function ref.proteger_comptes_officiels() returns trigger
language plpgsql as $$
begin
  if OLD.is_official and (
       NEW.account_code  is distinct from OLD.account_code or
       NEW.label         is distinct from OLD.label        or
       NEW.parent_code   is distinct from OLD.parent_code  or
       NEW.account_class is distinct from OLD.account_class or
       NEW.is_official   is distinct from OLD.is_official)
  then
    raise exception
      'Le compte % est officiel (NC 01) : son code, son libellé et son rattachement sont '
      'verbatim et ne peuvent pas être modifiés. Ouvrez une subdivision d''extension.',
      OLD.account_code
      using errcode = 'insufficient_privilege';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_proteger_comptes_officiels on ref.accounts;
create trigger trg_proteger_comptes_officiels
  before update on ref.accounts
  for each row execute function ref.proteger_comptes_officiels();
