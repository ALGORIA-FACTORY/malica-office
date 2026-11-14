-- Le matricule fiscal se saisit après l'inscription, une seule fois (recette du 14 novembre 2026, point 3).
--
-- Constat : le matricule est facultatif à l'inscription, et aucun écran de la PME ne pouvait
-- l'écrire ensuite. `organisation_definir` (RPC `identite.definirOrganisation`) ne contrôlait ni
-- le format du pack, ni le caractère figé du matricule. Désormais :
--   - le format se vérifie par `identifiant_verifier`, comme à la création ;
--   - un matricule déjà inscrit ne change plus (« je l'inscris une seule fois ») ;
--   - le doublon reste refusé par le déclencheur `un_matricule_une_societe` ;
--   - un appel qui repasse le matricule déjà inscrit reste sans effet.
-- Le corps reprend la version `security definer` de `20261110090100`, qui lit les droits de
-- l'appelant à la main (`app.has_org_role`) : l'appelant n'a pas le droit d'écrire la table.

create or replace function public.organisation_definir(
  p_org uuid, p_name text, p_legal_id text, p_jurisdiction text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text;
  v_name text := trim(p_name);
  v_legal text := nullif(trim(coalesce(p_legal_id, '')), '');
  v_refus text;
  v_lignes integer;
begin
  if not app.has_org_role(p_org, array['dirigeant', 'expert']) then
    raise exception 'refus.introuvable.organisation' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'refus.dossier.raison_sociale_requise' using errcode = '22023';
  end if;
  select p.currency into v_currency
    from ref.jurisdiction_packs p
   where p.jurisdiction = p_jurisdiction and p.effective_from <= current_date
   order by p.effective_from desc limit 1;
  if v_currency is null then
    raise exception 'refus.referentiel.pack_absent' using errcode = '22023';
  end if;

  v_refus := public.identifiant_verifier(p_jurisdiction, 'matricule_fiscal', v_legal);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;
  v_legal := upper(v_legal);

  -- Figé une fois inscrit : la ligne ne se met à jour que si son matricule est vide ou le même.
  -- Une ligne non touchée dit donc le changement refusé.
  update identity.organizations
     set name = v_name, legal_id = v_legal, jurisdiction = p_jurisdiction, currency = v_currency
   where id = p_org and (legal_id is null or upper(legal_id) = v_legal);
  get diagnostics v_lignes = row_count;
  if v_lignes = 0 then
    raise exception 'refus.organisation.matricule_fige' using errcode = '22023';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_org, auth.uid(), 'organization.updated', 'identity', 'organizations', p_org,
          jsonb_build_object('name', v_name, 'legal_id', v_legal, 'jurisdiction', p_jurisdiction));

  return jsonb_build_object('id', p_org, 'name', v_name, 'legalId', v_legal,
                            'jurisdiction', p_jurisdiction, 'currency', v_currency);
end $$;
