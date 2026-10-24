-- Les catégories d'immobilisations du pack TN 2026.1 prennent les comptes NC 01,
-- par une VERSION datée, jamais par une réécriture.
--
-- Les défauts du 25 août contenaient des subdivisions absentes du plan
-- (2813, 2834, 2882…) et confondaient terrains et constructions (2213).
-- NC 01, nomenclature : https://oect.org.tn/wp-content/uploads/2023/01/NC_01.pdf
--
-- ===================================================== POURQUOI UNE VERSION
--
-- Revue du 24 octobre 2026 : la première forme de cette migration faisait un
-- `update` des lignes en vigueur. Or un bien pointe sa catégorie par son
-- identifiant, et la dotation relit les comptes de CETTE ligne à chaque
-- exercice (20261022570000). Réécrite sur place, la catégorie aurait envoyé
-- les dotations futures d'un bien sur 282 quand les passées sont sur 2813 :
-- un amortissement cumulé coupé en deux, sans écriture qui l'explique.
--
-- La ligne du 1er janvier est donc close la veille, et une ligne nouvelle
-- porte les comptes NC 01 à partir du 24 octobre 2026 (R4, R10 : une valeur
-- réglementaire vit datée). Un bien déjà enregistré garde sa catégorie et
-- ses comptes : rien ne bouge sous lui. Si ses comptes sont absents du plan,
-- la garde du plan (20261024150000) refuse sa prochaine dotation avec le
-- motif : son reclassement est une décision d'expert, pas une migration.
-- Les durées, méthodes et coefficients ne changent pas.
--
-- REJEU (R11) : dates écrites en littéral ; insertion `on conflict do
-- nothing` ; la clôture ne touche que les lignes encore ouvertes ; clés
-- étrangères posées une fois.
begin;

update ref.immo_categories c
   set valid_to = date '2026-10-23'
  from ref.jurisdiction_packs p
 where c.pack_version_id = p.id and p.jurisdiction = 'TN' and p.version = '2026.1'
   and c.valid_from = date '2026-01-01' and c.valid_to is null
   and c.code in ('constructions', 'materiel', 'informatique', 'mobilier',
                  'vehicules', 'agencements', 'logiciels');

insert into ref.immo_categories
  (pack_version_id, code, label, method, duree_annees, coefficient,
   account_immo, account_amort, account_dotation,
   account_deprec, account_deprec_dotation, account_deprec_reprise,
   legal_reference, valid_from)
select c.pack_version_id, c.code, c.label, c.method, c.duree_annees, c.coefficient,
       v.immo, v.amort, v.dotation, v.depreciation, v.charge, v.reprise,
       coalesce(c.legal_reference || ' ; ', '') ||
         'NC 01 : comptes 21/22, 281/282, 291/292, 6811/6816, 7816',
       date '2026-10-24'
  from ref.immo_categories c
  join ref.jurisdiction_packs p on p.id = c.pack_version_id
  join (values
    ('constructions', '2221', '282', '68112', '292', '68162', '78162'),
    ('materiel',      '2234', '282', '68112', '292', '68162', '78162'),
    ('informatique',  '2282', '282', '68112', '292', '68162', '78162'),
    ('mobilier',      '2282', '282', '68112', '292', '68162', '78162'),
    ('vehicules',     '224',  '282', '68112', '292', '68162', '78162'),
    ('agencements',   '2281', '282', '68112', '292', '68162', '78162'),
    ('logiciels',     '213',  '281', '68111', '291', '68161', '78161')
  ) v(code, immo, amort, dotation, depreciation, charge, reprise) on v.code = c.code
 where p.jurisdiction = 'TN' and p.version = '2026.1'
   and c.valid_from = date '2026-01-01'
on conflict (pack_version_id, code, valid_from) do nothing;

-- Une catégorie NOUVELLE ne peut plus livrer un compte absent de son plan.
-- `not valid` : la contrainte vaut pour toute ligne insérée ou modifiée, sans
-- réécrire ni refuser les lignes closes, qui restent l'histoire des biens
-- déjà enregistrés.
do $$
declare v_col text;
begin
  foreach v_col in array array['account_immo', 'account_amort', 'account_dotation',
     'account_deprec', 'account_deprec_dotation', 'account_deprec_reprise'] loop
    if not exists (select 1 from pg_constraint where conname = 'immo_categorie_plan_' || v_col) then
      execute format('alter table ref.immo_categories add constraint %I foreign key (pack_version_id, %I) references ref.accounts(pack_version_id, account_code) not valid',
        'immo_categorie_plan_' || v_col, v_col);
    end if;
  end loop;
end $$;

commit;
