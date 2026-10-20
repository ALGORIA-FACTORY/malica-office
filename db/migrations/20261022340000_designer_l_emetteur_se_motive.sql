-- Désigner l'émetteur se motive (20 octobre 2026).
--
-- Recette de la tour : un seul clic sur « Désigner » changeait l'émetteur des
-- factures de la plateforme, sans motif ni trace lisible ; et le bouton
-- restait offert pour l'émetteur déjà en vigueur.
--
-- `emetteur_designer` prend un MOTIF, exigé, et l'inscrit au journal
-- (`audit.event_log`, action `emetteur.designe`). Désigner l'émetteur déjà
-- en vigueur, à la même date, est refusé : ce n'est pas un changement.
--
-- La signature change : `drop` puis `create`, droits remis à l'identique.
-- REJEU (R11) : `drop function if exists`.

begin;

drop function if exists plateforme.emetteur_designer(uuid, date);
drop function if exists plateforme.emetteur_designer(uuid, date, text);

create function plateforme.emetteur_designer(p_organisation uuid, p_valide_des date, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'Le motif de la désignation est requis.' using errcode = 'check_violation';
  end if;
  if p_valide_des is null or p_valide_des < current_date then
    raise exception 'un emetteur se designe pour aujourd''hui ou plus tard'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from identity.organizations o
                  where o.id = p_organisation and o.archived_at is null) then
    raise exception 'organisation inconnue' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from facturation.emetteurs e
              where e.organisation_id = p_organisation and e.valide_des = p_valide_des) then
    raise exception 'Cette organisation est déjà l''émetteur à cette date.'
      using errcode = 'check_violation';
  end if;

  insert into facturation.emetteurs (organisation_id, valide_des, designe_par)
  values (p_organisation, p_valide_des, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_organisation, auth.uid(), 'emetteur.designe', 'facturation', 'emetteurs', v_id,
          jsonb_build_object('valide_des', p_valide_des, 'motif', p_motif));

  return jsonb_build_object('emetteur_id', v_id, 'organisation_id', p_organisation,
                            'valide_des', p_valide_des);
end
$function$;

revoke all on function plateforme.emetteur_designer(uuid, date, text) from public;
grant execute on function plateforme.emetteur_designer(uuid, date, text) to authenticated;

commit;
