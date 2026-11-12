-- Une société déjà dans Malica se reconnaît dès que son matricule est complet
-- (recette du 11 novembre 2026, 3.8).
--
-- CE QUI ÉTAIT FAUX. Dans « Ajouter un client », le matricule d'une société
-- déjà inscrite ne se reconnaissait qu'après avoir saisi une raison sociale
-- et cliqué : c'est l'ouverture du dossier qui échouait
-- (`matricule_existant`), et le message s'affichait deux fois.
--
-- CE QUE POSE CETTE MIGRATION.
--
--   1. `app.lettre_de_controle_du_matricule` : la lettre attendue d'un
--      matricule, calculée par la règle du pack de la juridiction
--      (`ref.identifiant_controles` : poids, modulo, alphabet, effet). Aucune
--      règle écrite ici (R4) ; sans règle au pack, rien n'est jugé. C'est le
--      même calcul que `lettreDeControle` du Socle, que la lecture applique
--      aux pièces : la base l'applique à la saisie.
--   2. `public.matricule_examiner` : pour l'expert d'une comptabilité, ce
--      qu'un matricule saisi est — incomplet ou complet (le format du pack,
--      `identifiant_verifier`), sa lettre de contrôle, et s'il désigne une
--      société déjà dans Malica, déjà cliente ou non. Rien d'autre de la
--      société ne sort.
--
-- REJEU (R11) : `create or replace`. Rien n'est daté ; aucune donnée de
-- référence n'est écrite.

begin;

create or replace function app.lettre_de_controle_du_matricule(p_jurisdiction text,
                                                                p_valeur text)
returns table (attendue text, lue text, effet text)
language sql
stable
security definer
set search_path = ''
as $$
  with regle as (
    select c.poids, c.modulo, c.alphabet, c.effet
      from ref.identifiant_controles c
      join ref.jurisdiction_packs p on p.id = c.pack_version_id
     where p.jurisdiction = p_jurisdiction
       and c.kind = 'matricule_fiscal'
       and p.effective_from <= current_date
       and (p.effective_to is null or p.effective_to >= current_date)
       and c.valid_from <= current_date
       and (c.valid_to is null or c.valid_to >= current_date)
     order by p.effective_from desc, c.valid_from desc
     limit 1
  ),
  lu as (
    select substring(upper(btrim(p_valeur)) from '^([0-9]+)') as chiffres,
           substring(upper(btrim(p_valeur)) from '^[0-9]+([A-Z])') as lettre
  )
  select substr(r.alphabet,
                (select sum(substr(lu.chiffres, i, 1)::int * r.poids[i])::int
                   from generate_subscripts(r.poids, 1) i) % r.modulo + 1, 1),
         lu.lettre,
         r.effet
    from regle r, lu
   where lu.chiffres is not null and lu.lettre is not null
     and length(lu.chiffres) = cardinality(r.poids)
$$;
revoke all on function app.lettre_de_controle_du_matricule(text, text) from public;

create or replace function public.matricule_examiner(p_cabinet uuid, p_valeur text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_mf text := upper(nullif(btrim(coalesce(p_valeur, '')), ''));
  v_lettre record;
  v_societe uuid;
begin
  select o.jurisdiction into v_juridiction
    from identity.organizations o
   where o.id = p_cabinet and o.kind = 'cabinet' and o.archived_at is null;
  if v_juridiction is null or not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert' using errcode = '42501';
  end if;
  if v_mf is null
     or public.identifiant_verifier(v_juridiction, 'matricule_fiscal', v_mf) is not null then
    return jsonb_build_object('complet', false);
  end if;

  select * into v_lettre from app.lettre_de_controle_du_matricule(v_juridiction, v_mf);
  select o.id into v_societe
    from identity.organizations o
   where o.kind = 'pme' and o.archived_at is null and upper(btrim(o.legal_id)) = v_mf
   order by o.created_at
   limit 1;

  return jsonb_build_object(
    'complet', true,
    'lettre', case when v_lettre.attendue is null then null
                   when v_lettre.attendue = v_lettre.lue then 'conforme'
                   else 'discordante' end,
    'societe', case
      when v_societe is null then 'nouvelle'
      when exists (select 1 from identity.engagements e
                    where e.cabinet_org_id = p_cabinet and e.pme_org_id = v_societe
                      and e.status in ('propose', 'actif')) then 'deja_cliente'
      else 'existante' end);
end
$$;
revoke all on function public.matricule_examiner(uuid, text) from public;
grant execute on function public.matricule_examiner(uuid, text) to authenticated;

commit;
