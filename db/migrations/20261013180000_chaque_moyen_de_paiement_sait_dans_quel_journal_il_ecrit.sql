-- Chaque moyen de paiement sait dans quel journal il écrit.
--
-- ================================================== POURQUOI CETTE COLONNE MANQUAIT
--
-- 13 octobre 2026. Le dirigeant : « l'écriture comptable et le rapprochement
-- dépendent énormément du moyen de paiement ».
--
-- Le référentiel portait déjà le compte de trésorerie de chaque moyen — 54
-- Caisse, 532 Banques, 403 Effets à payer — depuis le 11 octobre. Vérifié :
-- `tresorerie_account` n'était lu par AUCUN code de production. Et pour écrire
-- un règlement, il manquait encore le JOURNAL : `ref.account_mappings`
-- n'en porte un que pour la facture (ACH, VEN), c'est-à-dire pour la dette,
-- jamais pour son extinction.
--
-- Un règlement ne s'écrit pas au journal des achats : il touche la
-- trésorerie, et c'est elle qu'un rapprochement bancaire relit.
--
-- ====================================================== CE QUE LE PACK LIVRE
--
-- Des défauts, au sens de R10 : raisonnables, visibles, et que l'expert
-- change sans déploiement.
--
--   espèces                        → CA, journal de caisse
--   chèque, chèque de banque,
--   carte bancaire, virement       → BQ, journal de banque
--   traite                         → OD : à son acceptation, une traite
--                                    reclasse une dette (401 → 403) et ne
--                                    décaisse rien. La ranger en banque
--                                    ferait apparaître un mouvement de
--                                    trésorerie qui n'a pas eu lieu.
--   autre                          → BQ, défaut surchargeable
--   pas encore payé                → aucun : il n'y a rien à écrire.

begin;

-- Le journal de caisse n'existait pas : le pack ne portait que ACH, VEN, BQ
-- et OD. Sans lui, un paiement en espèces s'écrirait en banque.
insert into ref.journals (code, libelle) values ('CA', 'Journal de caisse')
on conflict (code) do nothing;

alter table ref.payment_means
  add column if not exists journal_code text references ref.journals(code);

comment on column ref.payment_means.journal_code is
  'Le journal dans lequel ce moyen écrit son règlement. Nul pour « pas '
  'encore payé », qui n''écrit rien. Défaut livré, surchargeable (R10).';

update ref.payment_means set journal_code = 'CA' where code = 'especes';
update ref.payment_means set journal_code = 'BQ'
 where code in ('cheque', 'cheque_banque', 'carte_bancaire', 'virement', 'autre');
update ref.payment_means set journal_code = 'OD' where code = 'traite';

-- Un moyen qui ouvre un compte de trésorerie écrit forcément quelque part :
-- la cohérence est dans la contrainte, pas dans la discipline de qui insère.
--
-- APRÈS les valeurs, et non avant : une contrainte posée sur une table dont
-- les lignes ne la respectent pas encore refuse la migration entière. C'est
-- ce qui s'est passé au premier essai, et c'est la bonne erreur — elle dit
-- que la contrainte mord.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_means_tresorerie_implique_journal') then
    alter table ref.payment_means
      add constraint payment_means_tresorerie_implique_journal
        check (tresorerie_account is null or journal_code is not null);
  end if;
end $$;


-- La vue porte la colonne, sinon le moteur ne peut pas la lire. Appendue en
-- fin : `create or replace view` ne sait ni retirer ni réordonner.
create or replace view public.ref_payment_means_v with (security_invoker = true) as
  select id, pack_version_id, code, libelle, tresorerie_account, exige_justificatif,
         rang, legal_reference, valid_from, valid_to, exige_reference, journal_code
    from ref.payment_means;
revoke all on table public.ref_payment_means_v from public, anon, service_role;
grant select on table public.ref_payment_means_v to authenticated;

commit;
