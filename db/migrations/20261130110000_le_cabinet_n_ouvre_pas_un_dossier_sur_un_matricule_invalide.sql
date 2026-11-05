-- ======================================================================
--  Le cabinet n'ouvre pas un dossier sur un matricule invalide (staging,
--  5 novembre 2026).
--
--  « Créer un dossier client » acceptait « 123 » : `cabinet_ouvrir_dossier`
--  (20260918110000) exigeait un matricule présent et unique, jamais bien
--  formé. La fiche entreprise, elle, le vérifie depuis le 22 octobre
--  (`create_organization` → `identifiant_verifier`) : un dossier ouvert par le
--  cabinet ne pouvait pas être la seule porte où un matricule faux entre — le
--  contrôle du destinataire de chaque pièce compare la fiche à ce qu'elle
--  imprime, et rejetait alors toutes les factures du client.
--
--  Le corps est celui en vigueur, avec la garde et le rangement en capitales
--  de `create_organization`. L'unicité compare déjà sans la casse.
-- ======================================================================

begin;

create or replace function public.cabinet_ouvrir_dossier(p_cabinet uuid, p_nom text, p_legal_id text, p_adresse text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_nom text := nullif(trim(coalesce(p_nom, '')), '');
  v_mf text := nullif(trim(coalesce(p_legal_id, '')), '');
  v_adresse text := nullif(trim(coalesce(p_adresse, '')), '');
  v_cab record;
  v_pme uuid;
  v_refus text;
begin
  if v_uid is null then
    raise exception 'refus.authentification_requise' using errcode = '42501';
  end if;
  select id, kind, jurisdiction, currency into v_cab
    from identity.organizations
   where id = p_cabinet and archived_at is null;
  if v_cab.id is null or v_cab.kind <> 'cabinet'
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v_nom is null then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023';
  end if;
  if v_mf is null then
    raise exception 'refus.dossier.matricule_requis' using errcode = '22023';
  end if;
  -- La même garde que la fiche entreprise (`create_organization`) : le format
  -- vit dans `ref.identifiant_formats`, par juridiction — celle du cabinet,
  -- que le dossier reçoit. Et l'on range net : la pièce imprime des capitales.
  v_refus := public.identifiant_verifier(v_cab.jurisdiction, 'matricule_fiscal', v_mf);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;
  v_mf := upper(v_mf);
  if exists (select 1 from identity.organizations o
              where o.archived_at is null and upper(trim(o.legal_id)) = upper(v_mf)) then
    raise exception 'refus.dossier.matricule_existant'
      using errcode = '23505';
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by, adresse)
  values ('pme', v_nom, v_mf, v_cab.jurisdiction, v_cab.currency, 'mandate', v_uid, v_adresse)
  returning id into v_pme;

  -- Comme createOrganization côté API : une organisation sans établissement
  -- principal serait inutilisable.
  insert into identity.entities (tenant_id, code, name, is_default)
  values (v_pme, 'PRINCIPAL', v_nom, true);

  insert into identity.engagements (pme_org_id, cabinet_org_id, status, created_by)
  values (v_pme, p_cabinet, 'actif', v_uid);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_pme, v_uid, 'dossier.ouvert', 'identity', 'organizations', v_pme,
          jsonb_build_object('cabinet', p_cabinet, 'legalId', v_mf));

  return jsonb_build_object('id', v_pme, 'name', v_nom, 'legalId', v_mf, 'adresse', v_adresse);
end
$function$;

commit;
