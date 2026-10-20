-- Les réglages du cabinet sont à l'expert (20 octobre 2026).
--
-- Recette : un collaborateur (rôle « collaborateur », sans rôle d'expert) a
-- porté le seuil de validation en lot de 90 à 95 % — « Réglages enregistrés. »
-- Les politiques de `collab.reglages_cabinet` n'exigeaient que l'appartenance
-- au cabinet. Ce seuil décide de ce qui part en lot SANS regard humain : il
-- engage la responsabilité de l'expert-comptable, pas celle d'un
-- collaborateur.
--
-- L'écriture (insertion, mise à jour, suppression) est réservée à l'expert ;
-- la lecture ne change pas. `cabinet_reglages_definir` est `security invoker`
-- et passe donc par ces politiques.
--
-- REJEU (R11) : `drop policy if exists`.

begin;

drop policy if exists collab_reglages_cabinet_ins on collab.reglages_cabinet;
create policy collab_reglages_cabinet_ins on collab.reglages_cabinet
  for insert to authenticated
  with check ((select app.has_org_role(tenant_id, array['expert'])));

drop policy if exists collab_reglages_cabinet_upd on collab.reglages_cabinet;
create policy collab_reglages_cabinet_upd on collab.reglages_cabinet
  for update to authenticated
  using ((select app.has_org_role(tenant_id, array['expert'])))
  with check ((select app.has_org_role(tenant_id, array['expert'])));

drop policy if exists collab_reglages_cabinet_del on collab.reglages_cabinet;
create policy collab_reglages_cabinet_del on collab.reglages_cabinet
  for delete to authenticated
  using ((select app.has_org_role(tenant_id, array['expert'])));

-- La fonction le dit en clair avant que la base ne refuse en termes de RLS :
-- le collaborateur lit « réservé à l'expert-comptable », pas un message SQL.
create or replace function public.cabinet_reglages_definir(
  p_tenant uuid,
  p_seuil_lot numeric,
  p_seuil_revue numeric,
  p_double_validation numeric,
  p_proactives boolean,
  p_capacite integer,
  p_ton text,
  p_seuil_conseil numeric
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if not app.has_org_role(p_tenant, array['expert']) then
    raise exception 'Les réglages de supervision sont réservés à l''expert-comptable du cabinet.'
      using errcode = '42501';
  end if;
  if p_seuil_lot is null or p_seuil_lot < 0 or p_seuil_lot > 1
     or p_seuil_revue is null or p_seuil_revue < 0 or p_seuil_revue > 1 then
    raise exception 'Les seuils de confiance sont des proportions : entre 0 et 1.'
      using errcode = 'check_violation';
  end if;
  if p_seuil_revue > p_seuil_lot then
    raise exception
      'Le seuil de revue (%) ne peut pas dépasser le seuil de lot (%) : ce qui part en lot '
      'a été jugé plus sûr que ce qui attend une revue.', p_seuil_revue, p_seuil_lot
      using errcode = 'check_violation';
  end if;
  if p_double_validation is not null and p_double_validation < 0 then
    raise exception 'Le montant de double validation ne peut pas être négatif.'
      using errcode = 'check_violation';
  end if;
  if p_capacite is null or p_capacite <= 0 then
    raise exception 'La capacité par collaborateur est un nombre de dossiers : au moins un.'
      using errcode = 'check_violation';
  end if;
  if p_seuil_conseil is null or p_seuil_conseil < 0 or p_seuil_conseil > 1 then
    raise exception 'Le seuil de certitude du conseil est une proportion : entre 0 et 1.'
      using errcode = 'check_violation';
  end if;
  if p_ton is null or p_ton not in ('sobre', 'chaleureux') then
    raise exception 'Le ton des restitutions est « sobre » ou « chaleureux ».'
      using errcode = 'check_violation';
  end if;

  insert into collab.reglages_cabinet
    (tenant_id, seuil_confiance_lot, seuil_confiance_revue, double_validation_au_dela,
     propositions_proactives, capacite_dossiers_par_collaborateur, ton_restitutions,
     seuil_certitude_conseil)
  values (p_tenant, p_seuil_lot, p_seuil_revue, p_double_validation, p_proactives, p_capacite, p_ton,
          p_seuil_conseil)
  on conflict (tenant_id) do update
    set seuil_confiance_lot = excluded.seuil_confiance_lot,
        seuil_confiance_revue = excluded.seuil_confiance_revue,
        double_validation_au_dela = excluded.double_validation_au_dela,
        propositions_proactives = excluded.propositions_proactives,
        capacite_dossiers_par_collaborateur = excluded.capacite_dossiers_par_collaborateur,
        ton_restitutions = excluded.ton_restitutions,
        seuil_certitude_conseil = excluded.seuil_certitude_conseil,
        updated_by = auth.uid(),
        updated_at = now();

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'cabinet.reglages', 'collab', 'reglages_cabinet', p_tenant,
          jsonb_build_object('seuil_lot', p_seuil_lot, 'seuil_revue', p_seuil_revue,
                             'double_validation', p_double_validation, 'proactives', p_proactives,
                             'capacite', p_capacite, 'ton', p_ton,
                             'seuil_conseil', p_seuil_conseil));

  return public.cabinet_reglages_lire(p_tenant);
end $$;

revoke all on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text, numeric) from public, anon;
grant execute on function public.cabinet_reglages_definir(uuid, numeric, numeric, numeric, boolean, integer, text, numeric) to authenticated;

commit;
