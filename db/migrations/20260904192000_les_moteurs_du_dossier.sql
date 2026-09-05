-- =====================================================================================
--  Regalica Office — Un bien constaté ne se recalcule pas.
--
--  POURQUOI : la dotation d'un exercice est constatée avec son écriture (R7 :
--  l'écriture ne se réécrit pas). Or rien n'empêchait, ensuite, de changer la
--  valeur brute, la durée, la méthode ou la date de mise en service du bien.
--  Le plan d'amortissement affiché ne correspondait alors plus aux dotations
--  déjà passées en comptabilité — et rien ne le disait.
--
--  Dès qu'une dotation, une dépréciation ou une cession existe, les valeurs
--  qui fondent le plan sont figées. Le libellé reste libre ; l'état (cédé,
--  rebuté) reste libre, parce que c'est précisément ce qu'une cession change.
--
--  Idempotent.
-- =====================================================================================

create or replace function immo.bien_constate_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.category_id      is distinct from old.category_id
      or new.mise_en_service  is distinct from old.mise_en_service
      or new.valeur_brute     is distinct from old.valeur_brute
      or new.valeur_residuelle is distinct from old.valeur_residuelle
      or new.method           is distinct from old.method
      or new.duree_annees     is distinct from old.duree_annees
      or new.coefficient      is distinct from old.coefficient
      or new.devise           is distinct from old.devise)
     and (exists (select 1 from immo.dotations d where d.asset_id = old.id)
          or exists (select 1 from immo.depreciations p where p.asset_id = old.id)
          or exists (select 1 from immo.cessions c where c.asset_id = old.id)) then
    raise exception
      'Le bien « % » a déjà une dotation, une dépréciation ou une cession constatée : '
      'sa valeur, sa durée, sa méthode et sa date de mise en service ne se modifient plus. '
      'Seuls le libellé et l''état restent ouverts.', old.label
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists immo_assets_constate_fige on immo.assets;
create trigger immo_assets_constate_fige
  before update on immo.assets
  for each row execute function immo.bien_constate_fige();

comment on function immo.bien_constate_fige() is
  'Refuse de modifier les valeurs qui fondent le plan d''amortissement d''un bien dès qu''une dotation, une dépréciation ou une cession a été constatée.';

-- =====================================================================================
--  Le calendrier dit à qui s'applique chaque obligation.
--
--  POURQUOI : le pack porte trois « Déclaration mensuelle TVA » — personne
--  physique, personne morale sur papier, personne morale en télédéclaration —
--  et le calendrier du cabinet les rendait sous le même libellé, avec trois
--  quantièmes différents et rien pour les distinguer. La forme juridique, le
--  mode de dépôt et le régime que l'obligation vise font partie de ce qu'elle
--  est : ils sortent avec elle. Une obligation propre au cabinet n'en vise
--  aucun.
--
--  Les clés nouvelles s'AJOUTENT à l'objet ; rien de ce qui était lu ne change.
-- =====================================================================================
create or replace function public.cabinet_calendrier_lire(p_cabinet uuid, p_exercice integer, p_secteur text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_resultat    jsonb;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  select jurisdiction into v_juridiction from identity.organizations where id = p_cabinet;

  with mandats as (
    select e.pme_org_id, f.forme_juridique, f.mode_depot, f.regime_imposition, f.secteur
      from identity.engagements e
      left join lateral (
        select forme_juridique, mode_depot, regime_imposition, secteur
          from identity.fiches_fiscales x
         where x.tenant_id = e.pme_org_id and x.valid_to is null
         order by x.valid_from desc limit 1) f on true
     where e.cabinet_org_id = p_cabinet and e.status = 'actif'
       and e.starts_on <= current_date and (e.ends_on is null or e.ends_on >= current_date)
  ),
  du_pack as (
    select o.code, o.libelle, o.periodicite, o.echeance_jour, null::integer as echeance_mois,
           o.echeance_regle as regle, o.texte_source, o.article, false as propre,
           '*'::text as secteur,
           o.forme_juridique, o.mode_depot, o.regime,
           (select count(*) from mandats m
             where (o.forme_juridique is null or o.forme_juridique = m.forme_juridique)
               and (o.mode_depot is null or o.mode_depot = m.mode_depot)
               and (o.regime is null or o.regime = m.regime_imposition)
               and (p_secteur = '*' or m.secteur = p_secteur)) as mandats
      from ref.fiscal_obligations o
     where o.jurisdiction = v_juridiction
       and o.periodicite in ('mensuelle', 'trimestrielle', 'annuelle')
       and o.echeance_jour is not null
       and o.valid_from <= make_date(p_exercice, 12, 31)
       and (o.valid_to is null or o.valid_to >= make_date(p_exercice, 1, 1))
  ),
  propres as (
    select 'CAB:' || p.id::text as code, p.libelle, p.periodicite, p.echeance_jour, p.echeance_mois,
           p.regle, null::text as texte_source, null::text as article, true as propre,
           p.secteur,
           null::text as forme_juridique, null::text as mode_depot, null::text as regime,
           (select count(*) from mandats m
             where (p.secteur = '*' or m.secteur = p.secteur)
               and (p_secteur = '*' or m.secteur = p_secteur)) as mandats
      from collab.obligations_propres p
     where p.tenant_id = p_cabinet and p.active
       and (p.secteur = '*' or p.secteur = p_secteur)
  ),
  toutes as (
    select * from du_pack union all select * from propres
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', t.code,
           'libelle', t.libelle,
           'periodicite', t.periodicite,
           'echeanceJour', t.echeance_jour,
           'echeanceMois', t.echeance_mois,
           'regle', t.regle,
           'texteSource', t.texte_source,
           'article', t.article,
           'propre', t.propre,
           'secteur', t.secteur,
           'formeJuridique', t.forme_juridique,
           'modeDepot', t.mode_depot,
           'regime', t.regime,
           'mandats', t.mandats,
           'active', coalesce(r.active, true),
           'rappelJours', coalesce(r.rappel_jours,
             (select column_default::integer from information_schema.columns
               where table_schema = 'collab' and table_name = 'obligations_cabinet'
                 and column_name = 'rappel_jours')),
           'regle_par_le_cabinet', r.tenant_id is not null)
           order by t.propre, t.periodicite, t.libelle, t.forme_juridique, t.mode_depot), '[]'::jsonb)
    into v_resultat
    from toutes t
    left join collab.obligations_cabinet r
      on r.tenant_id = p_cabinet and r.obligation_code = t.code
     and r.exercice = p_exercice and r.secteur = p_secteur;

  return v_resultat;
end $$;

revoke all on function public.cabinet_calendrier_lire(uuid, integer, text) from public, anon;
grant execute on function public.cabinet_calendrier_lire(uuid, integer, text) to authenticated;

-- =====================================================================================
--  La dérivation écoute le cabinet — pour de bon.
--
--  POURQUOI : la migration du calendrier (20260904150000, section 7) définit
--  une dérivation qui écarte les obligations désactivées par le cabinet et
--  ajoute ses obligations propres. La base éprouvée portait encore la version
--  précédente : une obligation écartée restait dans les échéances du dossier,
--  et une obligation propre n'y entrait jamais. On repose ici la définition,
--  à l'identique, et la vue qui connaît les obligations propres.
-- =====================================================================================
-- --- 7. La dérivation écoute le cabinet ----------------------------------------------------
-- Une obligation que le cabinet mandaté a désactivée pour l'exercice et le
-- secteur du dossier n'entre pas ; ses obligations propres entrent.
create or replace function public.echeances_deriver(
  p_tenant uuid,
  p_jusqua date default (current_date + interval '4 months')::date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_juridiction text;
  v_fiche       record;
  v_pack        uuid;
  v_cabinet     uuid;
  v_depuis      date := date_trunc('month', current_date)::date;
  v_n           int  := 0;
  v_ob          record;
  v_mois        date;
  v_periode     text;
  v_echeance    date;
begin
  if not (p_tenant in (select app.member_orgs())
          or p_tenant in (select app.engaged_orgs())
          or app.is_platform()) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;

  select jurisdiction into v_juridiction from identity.organizations where id = p_tenant;

  select forme_juridique, mode_depot, regime_imposition, secteur
    into v_fiche
    from identity.fiches_fiscales
   where tenant_id = p_tenant and valid_to is null
   order by valid_from desc
   limit 1;
  if not found then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.absente');
  end if;
  if v_fiche.forme_juridique is null or v_fiche.mode_depot is null then
    return jsonb_build_object('generees', 0, 'raison', 'fiche.incomplete');
  end if;

  select id into v_pack
    from ref.jurisdiction_packs
   where jurisdiction = v_juridiction
     and effective_from <= current_date
     and (effective_to is null or effective_to > current_date)
   order by effective_from desc
   limit 1;
  if v_pack is null then
    return jsonb_build_object('generees', 0, 'raison', 'pack.absent');
  end if;

  -- Le cabinet qui tient ce dossier, s'il y en a un.
  select cabinet_org_id into v_cabinet
    from identity.engagements
   where pme_org_id = p_tenant and status = 'actif'
     and starts_on <= current_date and (ends_on is null or ends_on >= current_date)
   order by starts_on desc
   limit 1;

  for v_ob in
    with applicables as (
      select o.code, o.libelle, o.periodicite, o.echeance_jour, null::integer as echeance_mois,
             split_part(o.code, '_', 1) as famille,
             (case when o.forme_juridique is not null then 2 else 0 end
              + case when o.mode_depot is not null then 1 else 0 end
              + case when o.regime is not null then 4 else 0 end) as precision
        from ref.fiscal_obligations o
       where o.jurisdiction = v_juridiction
         and o.periodicite in ('mensuelle', 'trimestrielle')
         and o.echeance_jour is not null
         and o.valid_from <= p_jusqua
         and (o.valid_to is null or o.valid_to > v_depuis)
         and (o.forme_juridique is null or o.forme_juridique = v_fiche.forme_juridique)
         and (o.mode_depot is null or o.mode_depot = v_fiche.mode_depot)
         and (o.regime is null or o.regime = v_fiche.regime_imposition)
    ),
    retenues as (
      select a.code, a.libelle, a.periodicite, a.echeance_jour, a.echeance_mois
        from applicables a
       where a.precision = (select max(b.precision) from applicables b where b.famille = a.famille)
      union all
      select 'CAB:' || p.id::text, p.libelle, p.periodicite, p.echeance_jour, p.echeance_mois
        from collab.obligations_propres p
       where v_cabinet is not null and p.tenant_id = v_cabinet and p.active
         and (p.secteur = '*' or p.secteur = v_fiche.secteur)
    )
    select * from retenues
  loop
    v_mois := v_depuis;
    while v_mois <= p_jusqua loop
      v_echeance := null;
      if v_ob.periodicite = 'mensuelle' then
        v_periode  := to_char(v_mois - interval '1 month', 'YYYY-MM');
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'trimestrielle' and extract(month from v_mois)::int % 3 = 1 then
        v_periode  := to_char(v_mois - interval '1 month', 'YYYY')
                      || '-T' || extract(quarter from v_mois - interval '1 month')::text;
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'annuelle' and extract(month from v_mois)::int = v_ob.echeance_mois then
        v_periode  := to_char(v_mois, 'YYYY');
        v_echeance := v_mois + (v_ob.echeance_jour - 1);
      end if;

      if v_echeance is not null and v_echeance between v_depuis and p_jusqua
         -- Le cabinet a-t-il écarté cette obligation pour cet exercice et ce secteur ?
         and not exists (
           select 1 from collab.obligations_cabinet r
            where r.tenant_id = v_cabinet and r.obligation_code = v_ob.code
              and r.exercice = extract(year from v_echeance)::int
              and (r.secteur = '*' or r.secteur = v_fiche.secteur)
              and r.active = false)
      then
        insert into schedule.echeances (tenant_id, kind, label, period, due_date, pack_version_id)
        values (p_tenant, v_ob.code, v_ob.libelle, v_periode, v_echeance, v_pack)
        on conflict (tenant_id, kind, period) do update
          set due_date        = excluded.due_date,
              label           = excluded.label,
              pack_version_id = excluded.pack_version_id
          where schedule.echeances.status <> 'fait';
        v_n := v_n + 1;
      end if;
      v_mois := (v_mois + interval '1 month')::date;
    end loop;
  end loop;

  -- Ce que le cabinet a écarté depuis sort du calendrier, sauf ce qui est fait.
  delete from schedule.echeances s
   where s.tenant_id = p_tenant and s.status <> 'fait' and s.due_date >= v_depuis
     and exists (
       select 1 from collab.obligations_cabinet r
        where r.tenant_id = v_cabinet and r.obligation_code = s.kind
          and r.exercice = extract(year from s.due_date)::int
          and (r.secteur = '*' or r.secteur = v_fiche.secteur)
          and r.active = false);

  update schedule.echeances set status = 'en_retard'
   where tenant_id = p_tenant and status = 'a_venir' and due_date < current_date;
  update schedule.echeances set status = 'a_venir'
   where tenant_id = p_tenant and status = 'en_retard' and due_date >= current_date;

  return jsonb_build_object('generees', v_n, 'raison', null);
end
$$;

-- La vue connaît aussi les obligations propres : leur règle vient du cabinet.
create or replace view public.echeances_v
with (security_invoker = true) as
select e.id, e.tenant_id, e.entity_id, e.kind, e.label, e.period, e.due_date, e.pack_version_id,
       e.status, e.created_at, e.updated_at,
       e.fait_le, e.fait_par,
       coalesce(fo.echeance_regle, op.regle) as echeance_regle,
       fo.texte_source, fo.article,
       coalesce(fo.periodicite, op.periodicite) as periodicite
from schedule.echeances e
join identity.organizations o on o.id = e.tenant_id
left join ref.fiscal_obligations fo
  on fo.jurisdiction = o.jurisdiction
 and fo.code = e.kind
 and fo.valid_from <= e.due_date
 and (fo.valid_to is null or fo.valid_to > e.due_date)
left join collab.obligations_propres op
  on e.kind like 'CAB:%' and op.id::text = substr(e.kind, 5);

revoke all on function public.echeances_deriver(uuid, date) from public, anon;
grant execute on function public.echeances_deriver(uuid, date) to authenticated;
revoke insert, update on public.echeances_v from authenticated;

-- =====================================================================================
--  Un réglage incohérent se refuse en clair.
--
--  POURQUOI : un seuil de revue au-dessus du seuil de lot, ou une capacité
--  nulle, tombait sur la contrainte de la table — et l'écran ne recevait
--  qu'« erreur interne ». La règle n'a pas changé ; elle est dite avant
--  d'écrire, dans une phrase faite pour être lue.
-- =====================================================================================
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
