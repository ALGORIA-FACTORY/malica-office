-- L'import en masse signale une lettre de contrôle fausse (recette du
-- 11 novembre 2026, 3.4).
--
-- CE QUI ÉTAIT FAUX. `dossiers_verifier` ne jugeait que le FORMAT du
-- matricule : sept chiffres et une lettre quelconque passaient. Une lettre qui
-- ne répond pas aux chiffres — le signe d'un matricule mal recopié — n'était
-- pas signalée.
--
-- La règle vient du pack de la juridiction (`ref.identifiant_controles`, par
-- `app.lettre_de_controle_du_matricule`, posée par 20261215130000) : jamais du
-- code (R4). Son effet aussi : `avertit` (le défaut livré du pack TN, la DGI ne
-- publiant pas l'algorithme) se dit sur la ligne sans l'arrêter ; `bloque` la
-- rendrait « à corriger ».
--
-- La fonction gagne une colonne (`avertissement`) : elle se recrée.
--
-- REJEU (R11) : `drop function if exists` puis `create`. Rien n'est daté.

begin;

drop function if exists public.dossiers_verifier(uuid, jsonb);

create function public.dossiers_verifier(p_cabinet uuid, p_lignes jsonb)
returns table (ligne integer, statut text, motif text, organisation text, avertissement text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cab   record;
  r       record;
  v_mf    text;
  v_nom   text;
  v_mail  text;
  v_refus text;
  v_org   record;
  v_vus   text[] := array[]::text[];
  v_lettre record;
begin
  select id, kind, jurisdiction into v_cab
    from identity.organizations where id = p_cabinet and archived_at is null;
  if v_cab.id is null or v_cab.kind <> 'cabinet'
     or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) > 500 then
    raise exception 'refus.import.trop_de_lignes' using errcode = '22023';
  end if;
  for r in select e.value as v, e.ordinality::int as n
             from jsonb_array_elements(p_lignes) with ordinality e loop
    ligne := r.n;
    organisation := null;
    avertissement := null;
    v_mf := upper(nullif(trim(coalesce(r.v ->> 'matricule', '')), ''));
    v_nom := nullif(trim(coalesce(r.v ->> 'raison_sociale', '')), '');
    v_mail := lower(nullif(trim(coalesce(r.v ->> 'email', '')), ''));
    if v_mf is null then
      statut := 'a_corriger'; motif := 'refus.dossier.matricule_requis'; return next; continue;
    end if;
    v_refus := public.identifiant_verifier(v_cab.jurisdiction, 'matricule_fiscal', v_mf);
    if v_refus is not null then
      statut := 'a_corriger'; motif := v_refus; return next; continue;
    end if;
    -- La lettre de contrôle, par la règle du pack (3.4) : elle avertit, ou
    -- bloque si le pack le dit ; sans règle au pack, rien n'est jugé.
    select * into v_lettre from app.lettre_de_controle_du_matricule(v_cab.jurisdiction, v_mf);
    if v_lettre.attendue is not null and v_lettre.attendue is distinct from v_lettre.lue then
      if v_lettre.effet = 'bloque' then
        statut := 'a_corriger'; motif := 'refus.identifiant.lettre_de_controle';
        return next; continue;
      end if;
      avertissement := 'cab.cli.matricule.lettre';
    end if;
    if v_mf = any(v_vus) then
      statut := 'a_corriger'; motif := 'refus.import.matricule_en_double'; return next; continue;
    end if;
    v_vus := v_vus || v_mf;
    select o.id, o.name into v_org
      from identity.organizations o
     where o.archived_at is null and upper(trim(o.legal_id)) = v_mf;
    if v_org.id is not null then
      organisation := v_org.name;
      if exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = v_org.id
                    and e.status in ('propose', 'actif')) then
        statut := 'deja_client'; motif := null;
      else
        statut := 'existant'; motif := null;
      end if;
      return next; continue;
    end if;
    if v_nom is null then
      statut := 'a_corriger'; motif := 'refus.dossier.raison_sociale_requise'; return next; continue;
    end if;
    if v_mail is null or v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      statut := 'a_corriger'; motif := 'refus.invitation.adresse'; return next; continue;
    end if;
    statut := 'pret'; motif := null;
    return next;
  end loop;
end
$$;
revoke all on function public.dossiers_verifier(uuid, jsonb) from public;
grant execute on function public.dossiers_verifier(uuid, jsonb) to authenticated;

commit;
