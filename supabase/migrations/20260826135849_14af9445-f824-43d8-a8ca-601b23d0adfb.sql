-- 017 — Droit de timbre : comptes NCT dédiés (reprise en migration d'une correction
-- appliquée hors migration ; idempotent).
insert into ref.accounts (pack_version_id, account_code, label, parent_code, account_class)
select p.id, v.code, v.label, v.parent, v.classe
from ref.jurisdiction_packs p
cross join (values
  ('6654', 'Droits d''enregistrement et de timbre', '665', 6),
  ('4367', 'État — autres impôts, taxes et versements assimilés', '436', 4)
) as v(code, label, parent, classe)
where p.jurisdiction = 'TN'
  and not exists (
    select 1 from ref.accounts a
    where a.pack_version_id = p.id and a.account_code = v.code
  );

update ref.fiscal_charges set account_code = '6654'
where code = 'DROIT_TIMBRE' and document_kind = 'facture_achat' and account_code <> '6654';

update ref.fiscal_charges set account_code = '4367'
where code = 'DROIT_TIMBRE' and document_kind = 'facture_vente' and account_code <> '4367';