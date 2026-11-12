-- La fiche d'un client sait si son matricule est figé (recette du 11 novembre
-- 2026, point 5.1).
--
-- `public.cabinet_modifier_dossier` fige le matricule dès la première pièce
-- reçue, et refuse alors TOUTE la modification (`refus.dossier.matricule_fige`).
-- L'écran ne le savait pas : le champ restait modifiable, et l'enregistrement
-- butait — régime et clôture compris. Cette lecture dit, par la MÊME règle que
-- la porte, si le matricule est figé : l'écran grise le champ et dit pourquoi.
--
-- Une lecture : elle ne rend qu'un oui ou un non, à un membre de la
-- comptabilité qui tient le mandat actif de ce dossier.

create or replace function public.dossier_matricule_fige(p_cabinet uuid, p_pme uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_cabinet not in (select app.member_orgs())
     or not exists (select 1 from identity.engagements e
                     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_pme
                       and e.status = 'actif') then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '42501';
  end if;
  -- La règle de `cabinet_modifier_dossier`, mot pour mot.
  return exists (select 1 from public.pieces_v p where p.tenant_id = p_pme);
end
$$;

revoke all on function public.dossier_matricule_fige(uuid, uuid) from public, anon;
grant execute on function public.dossier_matricule_fige(uuid, uuid) to authenticated;
