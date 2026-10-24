-- Correction des comptes du pack TN 2026.1. Les anciens défauts contenaient
-- des subdivisions absentes du plan et confondaient terrains / constructions.
-- NC 01, nomenclature : https://oect.org.tn/wp-content/uploads/2023/01/NC_01.pdf
-- Les durées et méthodes ne sont pas modifiées. Aucune écriture passée n'est réécrite.
begin;
update ref.immo_categories c set
 account_immo = v.immo,
 account_amort = v.amort,
 account_dotation = v.dotation,
 account_deprec = v.depreciation,
 account_deprec_dotation = v.charge,
 account_deprec_reprise = v.reprise,
 legal_reference = coalesce(c.legal_reference, '') ||
   ' ; Imputation corrigée le 24/10/2026 selon NC 01 (comptes 21/22, 281/282, 291/292, 6811/6816, 7816).'
from ref.jurisdiction_packs p,
 (values
  ('constructions', '2221', '282', '68112', '292', '68162', '78162'),
  ('materiel', '2234', '282', '68112', '292', '68162', '78162'),
  ('informatique', '2282', '282', '68112', '292', '68162', '78162'),
  ('mobilier', '2282', '282', '68112', '292', '68162', '78162'),
  ('vehicules', '224', '282', '68112', '292', '68162', '78162'),
  ('agencements', '2281', '282', '68112', '292', '68162', '78162'),
  ('logiciels', '213', '281', '68111', '291', '68161', '78161')
 ) v(code, immo, amort, dotation, depreciation, charge, reprise)
where c.pack_version_id = p.id and p.jurisdiction = 'TN' and p.version = '2026.1'
 and c.code = v.code
 and (c.account_immo, c.account_amort, c.account_dotation, c.account_deprec,
      c.account_deprec_dotation, c.account_deprec_reprise)
   is distinct from (v.immo, v.amort, v.dotation, v.depreciation, v.charge, v.reprise);

-- Le référentiel ne peut plus livrer un compte absent de son propre plan.
do $$
declare v_col text;
begin
 foreach v_col in array array['account_immo', 'account_amort', 'account_dotation',
    'account_deprec', 'account_deprec_dotation', 'account_deprec_reprise'] loop
   if not exists (select 1 from pg_constraint where conname = 'immo_categorie_plan_' || v_col) then
     execute format('alter table ref.immo_categories add constraint %I foreign key (pack_version_id, %I) references ref.accounts(pack_version_id, account_code)',
       'immo_categorie_plan_' || v_col, v_col);
   end if;
 end loop;
end $$;
commit;
