-- La devise appartient au référentiel, et les défauts en dur disparaissent.
--
-- ========================================================== LE CONSTAT
--
-- Cinq colonnes portaient une valeur monétaire ou de juridiction en dur, et
-- `create_organization` en portait deux de plus dans sa signature :
--
--   identity.organizations.jurisdiction default 'TN'
--   identity.organizations.currency     default 'TND'
--   billing.invoices.currency           default 'TND'
--   pricing.price_lists.currency        default 'TND'
--   agents.model_pricing.currency       default 'USD'
--   create_organization(... p_jurisdiction default 'TN', p_currency default 'TND')
--
-- C'est là que la Tunisie était décidée pour toute organisation nouvelle. Rien
-- dans l'écran d'accueil ne demandait cette information ; elle tombait d'une
-- chaîne de défauts, en silence.
--
-- ========================================================== OÙ ELLE DOIT VIVRE
--
-- Nulle part le référentiel ne disait quelle monnaie va avec quelle juridiction.
-- C'est pourtant exactement son rôle : `ref.jurisdiction_packs` porte déjà la
-- juridiction, sa version et sa date d'entrée en vigueur. La devise y rejoint
-- les autres faits réglementaires.
--
-- Écrire 'TND' ICI n'est pas du code en dur : c'est une donnée de référence, à
-- l'endroit prévu, versionnée avec le pack qui la porte. La différence tient à
-- ce qu'on peut faire ensuite — une seconde juridiction s'ajoute par une ligne,
-- pas par une relecture du code.

-- --------------------------------------------------------- 1. la devise du pack
alter table ref.jurisdiction_packs add column if not exists currency text;

update ref.jurisdiction_packs set currency = 'TND'
 where jurisdiction = 'TN' and currency is null;

-- Un pack sans devise ne peut plus exister : c'est ce qui empêche la prochaine
-- juridiction d'être ajoutée à moitié.
alter table ref.jurisdiction_packs alter column currency set not null;

-- La vue publique l'expose. `create or replace` n'ajoute qu'en fin de liste.
create or replace view public.ref_packs_v with (security_invoker = true) as
select id,
       jurisdiction,
       version,
       effective_from,
       effective_to,
       source,
       validated_by is not null as ratified,
       validated_at,
       currency
  from ref.jurisdiction_packs;

-- ------------------------------------------------- 2. les défauts en dur retirés
alter table identity.organizations alter column jurisdiction drop default;
alter table identity.organizations alter column currency     drop default;
alter table billing.invoices       alter column currency     drop default;
alter table pricing.price_lists    alter column currency     drop default;
alter table agents.model_pricing   alter column currency     drop default;

-- ----------------------------------- 3. create_organization exige les deux valeurs
--
-- Les paramètres perdent leur défaut. L'appelant doit dire d'où vient
-- l'organisation ; s'il ne le sait pas, c'est l'écran qui doit le demander, pas
-- la base qui doit deviner.
--
-- Le corps est repris à l'identique : seule la signature change.
create or replace function public.create_organization(
  p_kind text,
  p_name text,
  p_validation_mode app.validation_mode_t default 'mandate'::app.validation_mode_t,
  p_legal_id text default null,
  p_jurisdiction text default null,
  p_currency text default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  if p_kind not in ('pme','cabinet') then
    raise exception 'kind invalide' using errcode = '22023';
  end if;

  -- Le défaut n'est pas supprimé, il est DÉPLACÉ vers le référentiel : à
  -- juridiction connue, la devise se déduit du pack. Ce qui disparaît, c'est la
  -- constante — pas la commodité.
  if p_jurisdiction is null then
    raise exception 'juridiction requise' using errcode = '22023';
  end if;
  if p_currency is null then
    select p.currency into p_currency
      from ref.jurisdiction_packs p
     where p.jurisdiction = p_jurisdiction
       and p.effective_from <= current_date
     order by p.effective_from desc
     limit 1;
    if p_currency is null then
      raise exception 'aucun pack en vigueur pour la juridiction %', p_jurisdiction
        using errcode = '22023';
    end if;
  end if;

  insert into identity.organizations (kind, name, legal_id, jurisdiction, currency,
                                      validation_mode, created_by)
  values (p_kind, p_name, p_legal_id, p_jurisdiction, p_currency,
          p_validation_mode, v_uid)
  returning id into v_org;

  v_role := case when p_kind = 'cabinet' then 'expert' else 'dirigeant' end;

  insert into identity.memberships (tenant_id, user_id, role)
  values (v_org, v_uid, v_role);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_org, v_uid, 'organization.created', 'identity', 'organizations', v_org,
          jsonb_build_object('kind', p_kind, 'role', v_role));

  return v_org;
end
$function$;
