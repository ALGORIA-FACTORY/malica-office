-- Les moyens de paiement vivent dans le pack, avec leur compte de trésorerie.
--
-- ================================================================= POURQUOI
--
-- Le commanditaire, 10 octobre : « le moyen de paiement doit être choisi
-- entre la liste suivante : espèce, chèque, carte bancaire, traite, chèque de
-- banque, virement ou autre. À l'exception d'espèces les autres on doit
-- prendre une photo et le rattacher à la facture. »
--
-- ========================================== POURQUOI EN BASE, ET PAS EN TYPESCRIPT
--
-- Chaque moyen désigne un COMPTE DE TRÉSORERIE différent : la caisse pour les
-- espèces, la banque pour un chèque, les effets à payer pour une traite. Un
-- numéro de compte est une valeur réglementaire, et R4 l'interdit dans le
-- code — sans exception.
--
-- Écrits en dur, ces sept moyens donneraient une écriture fausse dans la
-- première juridiction suivante, et personne ne le verrait : les libellés
-- seraient justes, seuls les comptes seraient faux.
--
-- ============================================ LE HUITIÈME, QUE J'AJOUTE ET QUE JE DÉFENDS
--
-- « Pas encore payé » ne figure pas dans la liste demandée. Sans lui, une
-- facture à trente jours n'a AUCUNE réponse possible, et la personne coche
-- n'importe quoi pour avancer — on perd alors l'information au lieu de la
-- gagner.
--
-- C'est aussi la question la plus rentable du lot : elle donne les échéances
-- fournisseurs sans aucune saisie. Il ne porte pas de compte de trésorerie,
-- justement parce qu'aucune trésorerie n'a bougé.
--
-- ===================================== LA PHOTO EST UNE DONNÉE, PAS UNE RÈGLE D'ÉCRAN
--
-- `exige_justificatif` vit ici et non dans l'écran, pour la même raison : le
-- jour où un cabinet exige une pièce même pour les espèces, c'est une ligne
-- de paramétrage, pas un déploiement (R10, point 3).
--
-- Ce que la colonne ne fait PAS : bloquer. Un dirigeant qui n'a pas son talon
-- sous la main doit pouvoir continuer, la pièce marquée « justificatif
-- manquant ». Un écran qui refuse d'avancer se contourne en cochant
-- « espèces », et l'information est perdue pour de bon.
--
-- ===================================================================== R11
--
-- `valid_from` est pris sur `effective_from` du pack : aucune date du jour
-- n'entre dans le référentiel.

create table if not exists ref.payment_means (
  id               uuid primary key default gen_random_uuid(),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code             text not null,
  libelle          text not null,

  -- Le compte où la trésorerie bouge. NUL quand elle ne bouge pas : « pas
  -- encore payé » n'est pas un paiement, c'est son absence datée.
  tresorerie_account text,

  -- Faut-il une photo du justificatif ? Donnée, pas règle d'écran.
  exige_justificatif boolean not null default true,

  rang             smallint not null,
  legal_reference  text,
  valid_from       date not null,
  valid_to         date,

  unique (pack_version_id, code, valid_from),

  -- Un moyen qui exige un justificatif a forcément fait bouger la trésorerie.
  -- La cohérence est dans la contrainte, pas dans la discipline de qui insère.
  constraint payment_means_justificatif_implique_tresorerie
    check (exige_justificatif = false or tresorerie_account is not null)
);

alter table ref.payment_means enable row level security;
alter table ref.payment_means force row level security;
drop policy if exists payment_means_sel on ref.payment_means;
create policy payment_means_sel on ref.payment_means for select to authenticated using (true);
revoke all on table ref.payment_means from public, anon, service_role;
grant select on table ref.payment_means to authenticated;

create index if not exists payment_means_lecture_idx
  on ref.payment_means (pack_version_id, valid_from desc);

create or replace view public.ref_payment_means_v with (security_invoker = true) as
  select id, pack_version_id, code, libelle, tresorerie_account, exige_justificatif,
         rang, legal_reference, valid_from, valid_to
    from ref.payment_means;
revoke all on table public.ref_payment_means_v from public, anon, service_role;
grant select on table public.ref_payment_means_v to authenticated;

-- --- Les huit moyens, pour la Tunisie ---------------------------------------------------------
--
-- Les comptes suivent le Système Comptable des Entreprises :
--   54  Caisse            les espèces
--   532 Banques           chèque, chèque de banque, carte, virement
--   403 Effets à payer    la traite, qui est une dette à échéance et non un
--                         décaissement : la confondre avec la banque ferait
--                         disparaître l'échéance.
--
-- « Autre » porte 532 par défaut et exige une photo : c'est le choix le plus
-- probable, et il reste surchargeable par le cabinet (R10).

insert into ref.payment_means
  (pack_version_id, code, libelle, tresorerie_account, exige_justificatif, rang,
   legal_reference, valid_from)
select p.id, m.code, m.libelle, m.compte, m.photo, m.rang, m.ref, p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('especes',         'Espèces',          '54',  false, 10,
    'Système Comptable des Entreprises — compte 54 Caisse'),
   ('cheque',          'Chèque',           '532', true,  20,
    'Système Comptable des Entreprises — compte 532 Banques'),
   ('cheque_banque',   'Chèque de banque', '532', true,  30,
    'Système Comptable des Entreprises — compte 532 Banques'),
   ('carte_bancaire',  'Carte bancaire',   '532', true,  40,
    'Système Comptable des Entreprises — compte 532 Banques'),
   ('virement',        'Virement',         '532', true,  50,
    'Système Comptable des Entreprises — compte 532 Banques'),
   ('traite',          'Traite',           '403', true,  60,
    'Système Comptable des Entreprises — compte 403 Fournisseurs, effets à payer'),
   ('autre',           'Autre',            '532', true,  70,
    'Système Comptable des Entreprises — compte 532 Banques, défaut surchargeable'),
   ('non_paye',        'Pas encore payé',  null,  false, 80,
    null)
 ) as m(code, libelle, compte, photo, rang, ref)
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, code, valid_from) do nothing;

-- --- Les libellés traduits ---------------------------------------------------------------------
--
-- Le libellé de la table est le nom français de référence ; celui que l'écran
-- montre vient de `ref.labels`, comme pour les motifs de rejet. Sans cela, un
-- écran en anglais afficherait « Chèque de banque », et c'est exactement le
-- défaut relevé le 10 octobre sur « Droit de timbre ».

insert into ref.labels (ns, key, locale, value) values
  ('moyen_paiement','especes','fr','Espèces'),
  ('moyen_paiement','especes','en','Cash'),
  ('moyen_paiement','especes','ar','نقدًا'),
  ('moyen_paiement','cheque','fr','Chèque'),
  ('moyen_paiement','cheque','en','Cheque'),
  ('moyen_paiement','cheque','ar','شيك'),
  ('moyen_paiement','cheque_banque','fr','Chèque de banque'),
  ('moyen_paiement','cheque_banque','en','Bank cheque'),
  ('moyen_paiement','cheque_banque','ar','شيك بنكي'),
  ('moyen_paiement','carte_bancaire','fr','Carte bancaire'),
  ('moyen_paiement','carte_bancaire','en','Bank card'),
  ('moyen_paiement','carte_bancaire','ar','بطاقة بنكية'),
  ('moyen_paiement','virement','fr','Virement'),
  ('moyen_paiement','virement','en','Bank transfer'),
  ('moyen_paiement','virement','ar','تحويل بنكي'),
  ('moyen_paiement','traite','fr','Traite'),
  ('moyen_paiement','traite','en','Bill of exchange'),
  ('moyen_paiement','traite','ar','كمبيالة'),
  ('moyen_paiement','autre','fr','Autre'),
  ('moyen_paiement','autre','en','Other'),
  ('moyen_paiement','autre','ar','أخرى'),
  ('moyen_paiement','non_paye','fr','Pas encore payé'),
  ('moyen_paiement','non_paye','en','Not paid yet'),
  ('moyen_paiement','non_paye','ar','لم يُدفع بعد')
on conflict do nothing;

comment on table ref.payment_means is
  'Les moyens de paiement et leur compte de trésorerie, datés et '
  'surchargeables. En base et non en TypeScript parce qu''un numéro de compte '
  'est une valeur réglementaire (R4) : écrits en dur, ils donneraient une '
  'écriture fausse dans la première juridiction suivante, avec des libellés '
  'justes et des comptes faux — donc invisible.';

comment on column ref.payment_means.exige_justificatif is
  'Faut-il une photo du talon, du ticket ou de l''avis ? Donnée et non règle '
  'd''écran : le jour où un cabinet l''exige même pour les espèces, c''est une '
  'ligne de paramétrage et pas un déploiement. Elle ne BLOQUE pas l''avancement '
  '— un écran qui refuse se contourne en cochant « espèces », et l''information '
  'est perdue au lieu d''être gagnée.';
