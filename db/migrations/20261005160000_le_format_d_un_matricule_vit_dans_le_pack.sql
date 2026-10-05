-- Le format d'un matricule vit dans le pack, pas dans le code.
--
-- ================================================= LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 4 octobre 2026. Une facture de loyer parfaitement lue est rejetée :
--
--   « La pièce concerne 1876543W/A/M/000, pas ALGORIA FACTORY SARL
--     (1856324/A/M/000). »
--
-- Le contrôle avait raison : il avait bien lu la pièce. C'est la FICHE de
-- l'organisation qui était fausse, et elle portait `1856324/A/M/000` — sept
-- chiffres SANS la lettre de clé. Ce n'est pas un matricule tunisien valide, et
-- `create_organization` l'avait accepté sans rien dire.
--
-- Une fiche mal saisie fait échouer TOUTES les pièces du dossier, et le motif
-- affiché accuse la pièce. C'est la seule classe de défaut du diagnostic
-- qu'aucun test ne pouvait attraper — un test compare une fiche qu'il a semée à
-- une pièce qu'il a fabriquée, donc les deux concordent toujours. Ce qui PEUT
-- être tenu, c'est le format.
--
-- ============================================ POURQUOI PAS UN `check` DE COLONNE
--
-- La forme d'un matricule est une règle TUNISIENNE. L'écrire dans une
-- contrainte de colonne, ou dans du TypeScript, violerait R4 et R5 : le jour
-- où le produit sert l'UEMOA, il faudrait forker au lieu d'activer un pack.
--
-- Le motif vit donc ici, daté et versionné par juridiction, avec son exemple et
-- sa référence légale — exactement comme un taux de TVA. Une juridiction sans
-- format déclaré ne valide rien : ce n'est pas un repli implicite, c'est une
-- absence de règle, et elle se lit dans le référentiel.
--
-- ===================================================================== R11
--
-- Aucun `current_date` : `valid_from` est pris sur `effective_from` du pack,
-- qui est une donnée déjà en base. Deux machines qui jouent ce dépôt à deux
-- jours d'intervalle obtiennent le même référentiel.

-- --- 1. Les formats d'identifiants, par juridiction ----------------------------------------

create table if not exists ref.identifiant_formats (
  id              uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  jurisdiction    text not null,
  /** Quel identifiant : `matricule_fiscal` aujourd'hui, d'autres viendront. */
  kind            text not null,
  label           text not null,
  /** Expression POSIX, ancrée aux deux bouts par la fonction qui l'applique. */
  pattern         text not null,
  /** Un exemple VALIDE, montré dans le refus : « invalide » seul laisse deviner. */
  exemple         text not null,
  legal_reference text,
  valid_from      date not null,
  valid_to        date,
  unique (pack_version_id, kind, valid_from)
);

comment on table ref.identifiant_formats is
  'La forme attendue d''un identifiant légal, par juridiction et par date '
  'd''effet. Vit ici et non dans le code : R4 (aucune constante réglementaire) '
  'et R5 (un seul moteur, N juridictions).';

alter table ref.identifiant_formats enable row level security;
create policy identifiant_formats_sel on ref.identifiant_formats for select
  to authenticated using (true);
revoke all on table ref.identifiant_formats from public, anon;
grant select on table ref.identifiant_formats to authenticated;

create index identifiant_formats_lecture_idx
  on ref.identifiant_formats (jurisdiction, kind, valid_from desc);

-- --- 2. Le matricule fiscal tunisien -------------------------------------------------------
-- Sept chiffres, une lettre de clé, puis trois groupes : catégorie de TVA,
-- type d'établissement, et numéro d'établissement sur trois chiffres.
--
--   1876543W/A/M/000   ALGORIA FACTORY SUARL
--   1456987L/A/P/000   l'émetteur de la facture du 4 octobre — le troisième
--                      groupe n'est pas toujours « M »

insert into ref.identifiant_formats
  (pack_version_id, jurisdiction, kind, label, pattern, exemple, legal_reference, valid_from)
select p.id, p.jurisdiction, 'matricule_fiscal', 'Matricule fiscal',
       '[0-9]{7}[A-Za-z]/[A-Za-z]/[A-Za-z]/[0-9]{3}',
       '1876543W/A/M/000',
       'Code des droits et procédures fiscaux — identifiant unique',
       p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, kind, valid_from) do nothing;

-- --- 3. La vérification, au seul chemin d'écriture -----------------------------------------

create or replace function public.identifiant_verifier(
  p_jurisdiction text,
  p_kind text,
  p_valeur text
) returns text
language plpgsql
stable
set search_path to ''
as $$
declare
  v_pattern text;
  v_label text;
  v_exemple text;
  v_propre text := nullif(btrim(coalesce(p_valeur, '')), '');
begin
  -- Un identifiant absent n'est pas un identifiant faux. Une entreprise en
  -- cours d'immatriculation s'inscrit sans, et le renseigne ensuite : exiger la
  -- valeur ici bloquerait l'inscription (R10 — un défaut n'est pas un blocage).
  if v_propre is null then
    return null;
  end if;

  select f.pattern, f.label, f.exemple into v_pattern, v_label, v_exemple
    from ref.identifiant_formats f
   where f.jurisdiction = p_jurisdiction
     and f.kind = p_kind
     and f.valid_from <= current_date
     and (f.valid_to is null or f.valid_to > current_date)
   order by f.valid_from desc
   limit 1;

  -- Aucune règle déclarée pour cette juridiction : on ne valide pas, et on ne
  -- devine pas de format. L'absence se lit dans `ref.identifiant_formats`.
  if v_pattern is null then
    return null;
  end if;

  if v_propre ~ ('^' || v_pattern || '$') then
    return null;
  end if;

  -- Le refus porte l'exemple : « format invalide » laisse la personne deviner
  -- ce qui manque — ici, la lettre après les sept chiffres.
  return format('%s invalide : « %s ». La forme attendue est « %s ».',
                v_label, v_propre, v_exemple);
end
$$;

comment on function public.identifiant_verifier(text, text, text) is
  'Rend NULL quand la valeur est acceptable (ou qu''aucune règle ne la régit), '
  'sinon un message lisible portant la forme attendue.';

revoke all on function public.identifiant_verifier(text, text, text) from public, anon;
grant execute on function public.identifiant_verifier(text, text, text) to authenticated;

-- --- 4. La création d'organisation, qui refuse un matricule mal formé ----------------------
-- Corps repris de `20260831100000`. Un seul ajout : la vérification, placée
-- AVANT l'insertion, et le matricule enregistré débarrassé de ses espaces.

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
  v_refus text;
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

  -- Les espaces autour viennent du copier-coller et ne changent pas la valeur :
  -- refuser pour une espace apprend que le produit est tatillon, pas qu'on
  -- s'est trompé.
  p_legal_id := nullif(btrim(coalesce(p_legal_id, '')), '');

  v_refus := public.identifiant_verifier(p_jurisdiction, 'matricule_fiscal', p_legal_id);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
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
