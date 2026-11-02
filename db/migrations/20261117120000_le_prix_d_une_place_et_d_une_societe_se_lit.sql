-- Le prix d'une place et d'une société en plus se lit (2 novembre 2026).
--
-- Décisions de Wissem : une place de propriétaire coûte une place — le rôle
-- est donné par le propriétaire principal — et une société au-delà de
-- l'offre coûte `prix_organisation_sup` (29 DT HT dans la grille du
-- 19 octobre). Les écrans « Inviter » et « Sociétés » disent ce prix AVANT le
-- geste ; ils le lisaient nulle part : `mes_offres` ne le rend pas.
--
-- Une lecture, sans écriture : la grille de l'offre EN COURS de la licence
-- (figée par `offre_depuis`), pour son seul titulaire — comme le prix de la
-- licence dans `mon_forfait`. Aucun montant n'est calculé ici (R3, R4).
--
-- REJEU (R11) : `create or replace`.

begin;

create or replace function public.mes_prix_en_plus(p_tenant uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'prix_siege_sup', o.prix_siege_sup,
           'prix_organisation_sup', o.prix_organisation_sup,
           'sieges_inclus', o.sieges_inclus,
           'organisations_incluses', o.organisations_incluses)
    from facturation.licences l
    join facturation.licence_organisations lo on lo.licence_id = l.id and lo.tenant_id = p_tenant
    join facturation.forfait_courant_v c on c.licence_id = l.id
    cross join lateral ref.offre_a(c.offre_code, c.offre_depuis) o
   where l.titulaire = auth.uid()
   limit 1
$$;

revoke all on function public.mes_prix_en_plus(uuid) from public, anon;
grant execute on function public.mes_prix_en_plus(uuid) to authenticated;

comment on function public.mes_prix_en_plus(uuid) is
  'Le prix d''une place et d''une société au-delà de l''offre en cours, et ce '
  'que l''offre en comprend ; pour le titulaire de la licence seul, sinon vide.';

commit;
