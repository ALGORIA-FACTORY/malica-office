-- Un changement planifié ne remplace pas le régime du jour.
begin;

CREATE OR REPLACE FUNCTION public.echeances_deriver(p_tenant uuid, p_jusqua date DEFAULT ((CURRENT_DATE + '4 mons'::interval))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_legale      date;
  v_echeance    date;
  v_origine     text;
  v_motif       text;
  v_source      text;
  v_rep         record;
begin
  if not (p_tenant in (select app.member_orgs())
          or p_tenant in (select app.engaged_orgs())
          or app.is_platform()) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;

  select jurisdiction into v_juridiction from identity.organizations where id = p_tenant;

  select forme_juridique, mode_depot, regime_imposition, secteur, regime_tva
    into v_fiche
    from identity.fiches_fiscales
   where tenant_id = p_tenant and valid_from <= current_date and (valid_to is null or valid_to > current_date)
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
         -- Une obligation de TVA ne vise pas un dossier non assujetti (ANO-LIVE-007).
         and (not o.exige_assujettissement_tva or coalesce(v_fiche.regime_tva, '') <> 'non_assujetti')
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
      v_legale := null;
      if v_ob.periodicite = 'mensuelle' then
        v_periode := to_char(v_mois - interval '1 month', 'YYYY-MM');
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'trimestrielle' and extract(month from v_mois)::int % 3 = 1 then
        v_periode := to_char(v_mois - interval '1 month', 'YYYY')
                     || '-T' || extract(quarter from v_mois - interval '1 month')::text;
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      elsif v_ob.periodicite = 'annuelle' and extract(month from v_mois)::int = v_ob.echeance_mois then
        v_periode := to_char(v_mois, 'YYYY');
        v_legale  := v_mois + (v_ob.echeance_jour - 1);
      end if;

      -- La fenêtre se juge sur la date LÉGALE : un report qui pousse
      -- l'échéance au-delà de l'horizon doit quand même mettre la ligne à jour.
      if v_legale is not null and v_legale between v_depuis and p_jusqua
         -- Le cabinet a-t-il écarté cette obligation pour cet exercice et ce secteur ?
         and not exists (
           select 1 from collab.obligations_cabinet r
            where r.tenant_id = v_cabinet and r.obligation_code = v_ob.code
              and r.exercice = extract(year from v_legale)::int
              and (r.secteur = '*' or r.secteur = v_fiche.secteur)
              and r.active = false)
      then
        -- La date retenue : report du cabinet, sinon d'ALGORIA, sinon le
        -- premier jour ouvrable à partir de la date légale.
        v_echeance := null;
        v_motif := null;
        v_source := null;
        select r.nouvelle_date, r.motif, r.source into v_rep
          from collab.reports_echeance_cabinet r
         where v_cabinet is not null and r.tenant_id = v_cabinet
           and r.obligation_code = v_ob.code and r.periode = v_periode and r.retire_le is null;
        if found then
          v_echeance := v_rep.nouvelle_date;
          v_origine  := 'report_cabinet';
          v_motif    := v_rep.motif;
          v_source   := v_rep.source;
        else
          select r.nouvelle_date, r.motif, r.source into v_rep
            from ref.reports_echeance r
           where r.jurisdiction = v_juridiction
             and r.obligation_code = v_ob.code and r.periode = v_periode and r.retire_le is null;
          if found then
            v_echeance := v_rep.nouvelle_date;
            v_origine  := 'report_algoria';
            v_motif    := v_rep.motif;
            v_source   := v_rep.source;
          else
            v_echeance := app.jour_ouvrable(v_juridiction, v_legale);
            v_origine  := case when v_echeance = v_legale then 'loi' else 'jour_ouvrable' end;
          end if;
        end if;

        insert into schedule.echeances
          (tenant_id, kind, label, period, due_date, pack_version_id,
           date_legale, date_origine, report_motif, report_source)
        values (p_tenant, v_ob.code, v_ob.libelle, v_periode, v_echeance, v_pack,
                v_legale, v_origine, v_motif, v_source)
        on conflict (tenant_id, kind, period) do update
          set due_date        = excluded.due_date,
              label           = excluded.label,
              pack_version_id = excluded.pack_version_id,
              date_legale     = excluded.date_legale,
              date_origine    = excluded.date_origine,
              report_motif    = excluded.report_motif,
              report_source   = excluded.report_source
          where schedule.echeances.status <> 'fait';
        v_n := v_n + 1;
      end if;
      v_mois := (v_mois + interval '1 month')::date;
    end loop;
  end loop;

  -- Une obligation de TVA d'un dossier devenu (ou déclaré) non assujetti sort
  -- du calendrier, sauf ce qui est fait (ANO-LIVE-007).
  if coalesce(v_fiche.regime_tva, '') = 'non_assujetti' then
    delete from schedule.echeances s
     where s.tenant_id = p_tenant and s.status <> 'fait'
       and exists (select 1 from ref.fiscal_obligations o
                    where o.jurisdiction = v_juridiction and o.code = s.kind
                      and o.exige_assujettissement_tva);
  end if;

  -- Ce que le cabinet a écarté depuis sort du calendrier, sauf ce qui est fait.
  delete from schedule.echeances s
   where s.tenant_id = p_tenant and s.status <> 'fait'
     and coalesce(s.date_legale, s.due_date) >= v_depuis
     and exists (
       select 1 from collab.obligations_cabinet r
        where r.tenant_id = v_cabinet and r.obligation_code = s.kind
          and r.exercice = extract(year from coalesce(s.date_legale, s.due_date))::int
          and (r.secteur = '*' or r.secteur = v_fiche.secteur)
          and r.active = false);

  update schedule.echeances set status = 'en_retard'
   where tenant_id = p_tenant and status = 'a_venir' and due_date < current_date;
  update schedule.echeances set status = 'a_venir'
   where tenant_id = p_tenant and status = 'en_retard' and due_date >= current_date;

  return jsonb_build_object('generees', v_n, 'raison', null);
end
$function$;

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
         where x.tenant_id = e.pme_org_id and x.valid_from <= current_date and (x.valid_to is null or x.valid_to > current_date)
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

create or replace function public.export_exercices_lire(p_cabinet uuid, p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cloture  text;
  v_mois     integer;
  v_jour     integer;
  v_premiere date;
  v_courant  integer;
  v_premier  integer;
  v_n        integer;
  v_du       date;
  v_au       date;
  v_nb       integer;
  v_res      jsonb := '[]'::jsonb;
  -- La garde est dans app.export_mandats : elle lève si le cabinet ou le
  -- dossier n'est pas accessible.
  v_mandats  uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin

  if p_client is not null then
    select f.cloture_exercice into v_cloture
      from identity.fiches_fiscales f
     where f.tenant_id = p_client and f.valid_from <= current_date and (f.valid_to is null or f.valid_to > current_date)
     order by f.valid_from desc limit 1;
  end if;
  if v_cloture is null then
    v_mois := 12; v_jour := 31;
  else
    v_mois := split_part(v_cloture, '-', 1)::integer;
    v_jour := split_part(v_cloture, '-', 2)::integer;
  end if;

  select min(e.date_ecriture) into v_premiere
    from socle.ecritures e
   where e.status = 'booked' and e.tenant_id = any(v_mandats);

  -- La clôture de l'année N, bornée à la fin du mois (« 02-30 » n'existe pas).
  v_courant := extract(year from current_date)::integer;
  if least(make_date(v_courant, v_mois, 1) + (v_jour - 1),
           (make_date(v_courant, v_mois, 1) + interval '1 month' - interval '1 day')::date)
     < current_date then
    v_courant := v_courant + 1;
  end if;

  v_premier := v_courant;
  if v_premiere is not null then
    v_premier := extract(year from v_premiere)::integer;
    if least(make_date(v_premier, v_mois, 1) + (v_jour - 1),
             (make_date(v_premier, v_mois, 1) + interval '1 month' - interval '1 day')::date)
       < v_premiere then
      v_premier := v_premier + 1;
    end if;
  end if;

  for v_n in reverse v_courant .. v_premier loop
    v_au := least(make_date(v_n, v_mois, 1) + (v_jour - 1),
                  (make_date(v_n, v_mois, 1) + interval '1 month' - interval '1 day')::date);
    v_du := least(make_date(v_n - 1, v_mois, 1) + (v_jour - 1),
                  (make_date(v_n - 1, v_mois, 1) + interval '1 month' - interval '1 day')::date) + 1;
    select count(*) into v_nb
      from socle.ecritures e
     where e.status = 'booked' and e.tenant_id = any(v_mandats)
       and e.date_ecriture between v_du and v_au;
    if v_nb > 0 or v_n = v_courant then
      v_res := v_res || jsonb_build_object(
        'exercice', v_n,
        'du', v_du,
        'au', v_au,
        'clos', v_au < current_date,
        'clotureConnue', v_cloture is not null,
        'ecritures', v_nb);
    end if;
  end loop;
  return v_res;
end $$;

commit;
