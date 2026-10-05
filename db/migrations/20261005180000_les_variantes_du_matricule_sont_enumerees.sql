-- Les variantes du matricule sont énumérées, et le matricule se range en capitales.
--
-- ================================================= CE QUI CLOCHAIT CE MATIN
--
-- Le motif posé par `20261005160000` était :
--
--   [0-9]{7}[A-Za-z]/[A-Za-z]/[A-Za-z]/[0-9]{3}
--
-- Il couvrait les variantes PAR ACCIDENT — n'importe quelle lettre passait aux
-- deux positions du milieu — et acceptait donc aussi « /Z/Q/ », qui n'existe
-- pas. Permissif et faux à la fois : l'apparence d'une validation.
--
-- Signalé par le commanditaire le 5 octobre 2026. La forme complète d'un
-- matricule fiscal tunisien :
--
--   7 chiffres + lettre de contrôle / code de TVA / catégorie / établissement
--                                     A B P D N     M C P N E     3 chiffres
--
-- Énumérer les deux séries est ce qui distingue une validation d'une apparence
-- de validation. Une faute de frappe sur la catégorie est précisément le genre
-- d'erreur qui bloque ensuite TOUTES les pièces du dossier — et dont le motif
-- affiché accuse la pièce, pas la fiche.
--
-- Les deux casses sont dans les classes plutôt que confiées à un opérateur
-- insensible à la casse : le motif est une DONNÉE, et il ne doit pas dépendre
-- de la façon dont on le lit.
--
-- Si une série s'élargit, elle s'élargit ici — daté, versionné, sans
-- déploiement. C'est tout l'intérêt d'avoir sorti le motif du code (R4).
--
-- ============================================ POURQUOI LES CAPITALES À L'ÉCRITURE
--
-- La validation accepte la minuscule, parce qu'une OCR rend « 1876543w » aussi
-- souvent que « 1876543W » et qu'un refus pour une casse n'apprend rien à la
-- personne. Mais ENREGISTRER la minuscule prépare un défaut silencieux : le
-- contrôle `destinataire` compare la fiche au matricule lu sur la pièce, qui
-- est imprimé en capitales. Une fiche en minuscules ferait donc rejeter toutes
-- les pièces d'un dossier, pour une différence invisible à l'œil.
--
-- On accepte large, et on range net.
--
-- ===================================================================== R11
--
-- `valid_from` reste pris sur `effective_from` du pack : aucune date du jour
-- n'entre dans le référentiel.

-- --- 1. Le motif complet, avec ses deux séries ---------------------------------------------

insert into ref.identifiant_formats
  (pack_version_id, jurisdiction, kind, label, pattern, exemple, legal_reference, valid_from)
select p.id, p.jurisdiction, 'matricule_fiscal', 'Matricule fiscal',
       '[0-9]{7}[A-Za-z]/[ABPDNabpdn]/[MCPNEmcpne]/[0-9]{3}',
       '1876543W/A/M/000',
       'Code des droits et procédures fiscaux — identifiant unique',
       p.effective_from
  from ref.jurisdiction_packs p
 where p.jurisdiction = 'TN'
on conflict (pack_version_id, kind, valid_from) do update
   set pattern = excluded.pattern,
       exemple = excluded.exemple,
       legal_reference = excluded.legal_reference;

comment on column ref.identifiant_formats.pattern is
  'Expression POSIX, ancrée aux deux bouts par `identifiant_verifier`. Les deux '
  'casses sont énumérées dans les classes : le motif est une donnée, il ne doit '
  'pas dépendre de la sensibilité à la casse de l''opérateur qui le lit.';

-- --- 2. La création, qui range le matricule en capitales ------------------------------------
-- Corps repris de `20261005160000`. Un seul ajout : `upper()` après la
-- vérification, pour que la fiche enregistrée se compare à ce que la pièce
-- imprime.

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

  -- On accepte large, on range net : la pièce imprime des capitales, et le
  -- contrôle du destinataire compare la fiche à ce qu'elle imprime.
  p_legal_id := upper(p_legal_id);

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
