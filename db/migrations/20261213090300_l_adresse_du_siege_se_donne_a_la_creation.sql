-- L'adresse du siège se donne à la création de la société (recette du
-- 11 novembre 2026, point 4.2).
--
-- L'écran de création demandait un « Établissement principal » : on y tapait
-- l'adresse, elle devenait le NOM de l'établissement, et le siège restait
-- « — » partout. L'écran demande désormais l'adresse du siège ; cette porte
-- la pose sur l'organisation. Seuls ses dirigeants (ou l'expert d'une
-- comptabilité, pour la sienne) l'écrivent ; la comptabilité qui tient le
-- dossier d'un client garde sa porte (`cabinet_modifier_dossier`).

begin;

create or replace function public.organisation_adresse_poser(p_org uuid, p_adresse text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adresse text := nullif(btrim(coalesce(p_adresse, '')), '');
  v_avant   text;
begin
  if not app.has_org_role(p_org, array['dirigeant', 'expert']) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  select adresse into v_avant from identity.organizations where id = p_org;
  update identity.organizations set adresse = v_adresse where id = p_org;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_org, auth.uid(), 'organization.updated', 'identity', 'organizations', p_org,
          jsonb_build_object('adresse', jsonb_build_object('avant', v_avant, 'apres', v_adresse)));
  return jsonb_build_object('id', p_org, 'adresse', v_adresse);
end
$$;

comment on function public.organisation_adresse_poser(uuid, text) is
  'Pose (ou efface, avec null) l''adresse du siège d''une organisation, pour ses dirigeants ou son expert.';

alter function public.organisation_adresse_poser(uuid, text) owner to portier;
revoke all on function public.organisation_adresse_poser(uuid, text) from public, anon;
grant execute on function public.organisation_adresse_poser(uuid, text) to authenticated;

commit;
