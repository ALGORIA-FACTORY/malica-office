-- La TVA d'une voiture de tourisme ne se déduit pas : le Socle le dit
-- (8 novembre 2026).
--
-- ================================================================= LE DÉFAUT
--
-- `ref.fiscal_parameters` porte l'exclusion (Code de la TVA, art. 10-1) depuis
-- le 31 août 2026 : les voitures de tourisme servant au transport de personnes
-- autres que celles objet de l'exploitation, leur location et les frais de
-- leur marche et de leur entretien. Rien ne la lisait : l'achat d'une voiture
-- ou un plein de carburant proposait la TVA au débit du compte déductible.
--
-- ================================================================== LA RÈGLE
--
-- Une table de MOTS, comme `ref.biens_immobilisables` : un article d'achat qui
-- en porte un reçoit la réserve `tva_exclue_a_trancher`. L'écriture reste
-- proposée, et le cabinet tranche : un même plein peut servir un camion de
-- livraison, dont la TVA se déduit, et l'exclusion ne joue pas pour une
-- entreprise dont le transport de personnes est l'objet.
--
-- INCERTAIN (à confirmer par un expert-comptable) : la liste des mots. Le texte
-- de l'exclusion, lui, est cité par `ref.fiscal_parameters`.
--
-- REJEU (R11) : `valid_from` pris sur `effective_from` du pack ; aucune date
-- du jour ; `on conflict do nothing` sur la clé.

begin;

create table ref.exclusions_de_deduction (
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  motif           text not null check (length(btrim(motif)) > 0),
  famille         text not null check (famille ~ '^[A-Z][A-Z0-9_]*$'),
  langue          text not null check (langue in ('fr', 'ar')),
  -- L'article qui fonde l'exclusion : il se dit dans la réserve.
  base_legale     text not null check (length(btrim(base_legale)) > 0),
  incertain       boolean not null,
  source          text not null check (length(btrim(source)) > 0),
  valid_from      date not null,
  valid_to        date,
  check (valid_to is null or valid_to >= valid_from),
  primary key (pack_version_id, motif, valid_from)
);

comment on table ref.exclusions_de_deduction is
  'Les mots qui désignent un achat dont la TVA peut être exclue du droit à déduction : un article '
  'd''achat qui en porte un reçoit la réserve « TVA exclue à trancher ». Le cabinet tranche.';

insert into ref.exclusions_de_deduction
  (pack_version_id, motif, famille, langue, base_legale, incertain, source, valid_from)
select p.id, v.motif, v.famille, v.langue, 'Code de la TVA, art. 10-1', true,
       'Liste INCERTAINE posée le 8 novembre 2026 : elle signale, elle ne décide pas. '
       'Exclusion citée par ref.fiscal_parameters (exclusion_deduction_voitures).',
       p.effective_from
  from ref.jurisdiction_packs p
 cross join (values
   ('(?<!\p{L})(voitures?|v[ée]hicules?)\s+(de\s+tourisme|particuli[èe]re?s?)(?!\p{L})', 'VOITURE_TOURISME', 'fr'),
   ('(?<!\p{L})location\s+(de\s+|d[''’]une?\s+)?(voitures?|v[ée]hicules?)(?!\p{L})', 'VOITURE_TOURISME', 'fr'),
   ('(?<!\p{L})(carburants?|gasoil|gazole|essence\s+sans\s+plomb)(?!\p{L})', 'FRAIS_DE_VEHICULE', 'fr'),
   ('(?<!\p{L})(entretien|r[ée]paration|vidange)\s+(de\s+|d[''’]une?\s+|du\s+)?(voitures?|v[ée]hicules?)(?!\p{L})', 'FRAIS_DE_VEHICULE', 'fr'),
   ('سيار(ة|ات)\s+(ال)?سياحية', 'VOITURE_TOURISME', 'ar'),
   ('كراء\s+(ال)?سيار(ة|ات)', 'VOITURE_TOURISME', 'ar'),
   ('(ال)?وقود|(ال)?مازوط', 'FRAIS_DE_VEHICULE', 'ar')
 ) as v(motif, famille, langue)
 where p.jurisdiction = 'TN'
on conflict do nothing;

-- La TVA déductible d'une proposition va au sous-compte du plan NC 01 : 43666,
-- « TVA sur autres biens et services ». Une proposition n'impute qu'en charge
-- (classe 6) ; une immobilisation se pose à la main, au 43662. Un rôle, donc
-- surchargeable par le cabinet (R10). `TVA_DEDUCTIBLE` reste la rubrique que
-- lisent la déclaration et les écritures déjà inscrites.
insert into ref.account_roles (code, libelle, famille, classes_admises, resolution, auxiliaire, note)
values ('TVA_DEDUCTIBLE_AUTRES_BIENS', 'TVA déductible sur autres biens et services', 'etat', '{4}',
        'fixe', null, null)
on conflict do nothing;

insert into ref.role_bindings (pack_version_id, role_code, account_code, perimetre, justification)
select p.id, 'TVA_DEDUCTIBLE_AUTRES_BIENS', '43666', null, null
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
   and exists (select 1 from ref.accounts a where a.pack_version_id = p.id and a.account_code = '43666')
on conflict do nothing;

alter table ref.exclusions_de_deduction enable row level security;
alter table ref.exclusions_de_deduction force row level security;
revoke all on table ref.exclusions_de_deduction from public, anon;
grant select on table ref.exclusions_de_deduction to authenticated;
create policy ref_exclusions_de_deduction_sel on ref.exclusions_de_deduction
  for select to authenticated using (true);

commit;
