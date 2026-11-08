-- Quand la comptabilité a choisi l'abonnement (décisions du dirigeant, 8 novembre 2026).
--
-- « L'abonnement, s'il est fait par la comptabilité : pas de prix. »
-- « Pas de downgrade, seulement l'upgrade s'il y a, lorsque la comptabilité a
--   choisi l'abonnement. »
--
-- Ce que la recette du 8 novembre a mesuré, en cliquant :
--   - le dirigeant d'une société dont la comptabilité paie Team voyait « Team —
--     34,000 TND HT / mois », les prix de toutes les offres, et « À l'année :
--     vous payez 10 mois » ; `mon_forfait` rendait le prix au titulaire sans
--     regarder qui paie ;
--   - un clic sur « Passer à Basic » ramenait la licence à Basic pendant que la
--     comptabilité restait facturée Team : `forfait_changer` ne lisait jamais
--     `facturation.acces` ;
--   - la notification `acces.propose`, lisible par la société, portait le prix.
--
-- La marge de la comptabilité est ses honoraires, « implicite et invérifiable »
-- (règles du 16 octobre) : la société ne voit donc jamais ce que la
-- comptabilité paie pour elle. Elle voit ce qu'ELLE paie — le complément d'une
-- offre plus haute, que la règle du 20 octobre (D9) lui fait payer.

-- ===========================================================================
-- 1. QUI A CHOISI L'ABONNEMENT D'UNE LICENCE
-- ===========================================================================

create or replace function facturation.prise_en_charge_de(p_licence uuid)
returns table (offre_code text, comptabilite text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.offre_code, o.name
    from facturation.acces a
    join identity.organizations o on o.id = a.cabinet_tenant_id
   where a.licence_id = p_licence and a.canal = 'cabinet' and a.statut = 'actif'
   order by a.effet_du desc nulls last
   limit 1
$$;

revoke all on function facturation.prise_en_charge_de(uuid) from public, anon;
grant execute on function facturation.prise_en_charge_de(uuid) to authenticated;

comment on function facturation.prise_en_charge_de(uuid) is
  'L''offre que la comptabilité a choisie pour cette licence, et son nom ; '
  'aucune ligne quand la société paie seule. Jamais un prix.';

-- ===========================================================================
-- 2. PAS DE DESCENTE SOUS L'OFFRE QUE LA COMPTABILITÉ A CHOISIE
-- ===========================================================================
--
-- Le même empêchement sert l'écran (`mes_offres` marque l'offre et dit
-- pourquoi) et la porte (`forfait_changer` refuse) : un seul endroit décide.

create or replace function facturation.empechement_de_forfait(
  p_licence uuid, p_offre text, p_le date)
returns table (code text, chiffres jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_courant   record;
  v_cible     record;
  v_canal_ok  record;
  v_usage     record;
  v_choisie   record;
begin
  if p_licence is null then
    return query select 'pas_de_licence'::text, '{}'::jsonb; return;
  end if;

  select f.offre_code, f.canal into v_courant
    from facturation.forfait_courant_v f where f.licence_id = p_licence;

  if v_courant.canal is null then
    return query select 'pas_de_licence'::text, '{}'::jsonb; return;
  end if;

  -- La ligne de grille est celle qui VALAIT a la date demandee. Meme regle
  -- que partout : chacun porte SA date, et c'est la sienne qui le tarife.
  select o.* into v_cible
    from ref.offres o
   where o.code = p_offre and o.effective_from <= p_le
   order by o.effective_from desc limit 1;

  if v_cible.code is null then
    return query select 'offre_inconnue'::text, '{}'::jsonb; return;
  end if;

  if v_cible.code = v_courant.offre_code then
    return query select 'deja_courant'::text, jsonb_build_object('offre', v_cible.code); return;
  end if;

  -- La comptabilité a choisi l'abonnement : on ne descend pas sous son offre.
  select p.offre_code, p.comptabilite, (ref.offre_a(p.offre_code, p_le)).rang as rang
    into v_choisie
    from facturation.prise_en_charge_de(p_licence) p;
  if v_choisie.offre_code is not null and v_cible.rang < v_choisie.rang then
    return query select 'choisi_par_la_comptabilite'::text,
      jsonb_build_object('offre', v_choisie.offre_code, 'comptabilite', v_choisie.comptabilite);
    return;
  end if;

  select c.libre_service into v_canal_ok
    from ref.offres_par_canal c
   where c.canal = v_courant.canal and c.offre_code = p_offre and c.effective_from <= p_le
   order by c.effective_from desc limit 1;

  if v_canal_ok.libre_service is distinct from true then
    return query select 'commande_speciale'::text,
      jsonb_build_object('canal', v_courant.canal, 'offre', v_cible.code); return;
  end if;

  select co.sieges_occupes, co.organisations into v_usage
    from facturation.consommation_v co where co.licence_id = p_licence;

  -- Une descente ne met personne dehors. `sieges_max` est le plafond de
  -- l'offre visee, sieges supplementaires compris : Solo vaut zero, donc un
  -- seul collaborateur suffit a refuser.
  if coalesce(v_usage.sieges_occupes, 0) > v_cible.sieges_max then
    return query select 'sieges_occupes'::text,
      jsonb_build_object('occupes', v_usage.sieges_occupes, 'max', v_cible.sieges_max); return;
  end if;

  if coalesce(v_usage.organisations, 0) > v_cible.organisations_max then
    return query select 'organisations'::text,
      jsonb_build_object('ouvertes', v_usage.organisations, 'max', v_cible.organisations_max); return;
  end if;

  return query select null::text, '{}'::jsonb;
end;
$$;

-- ===========================================================================
-- 3. LE FORFAIT : CE QUE LA SOCIÉTÉ PAIE, ELLE — JAMAIS CE QUE PAIE LA COMPTABILITÉ
-- ===========================================================================
--
-- Deux colonnes de plus, donc la fonction est recréée :
--   - `titulaire` : l'écran savait « principal » à ce que le prix n'était pas
--     nul ; le prix pouvant désormais être nul pour le titulaire, il le dit ;
--   - `pris_en_charge_par` : le nom de la comptabilité qui a choisi l'offre.
-- `prix_mensuel_ht`, sous prise en charge, est le complément que la société
-- paie au-dessus de l'offre choisie, ou nul s'il n'y en a pas.

drop function if exists public.mon_forfait(uuid);

create function public.mon_forfait(p_tenant uuid default null)
returns table (
  licence_id uuid,
  tenant_id uuid,
  offre text, statut text,
  lectures_droit integer, lectures_consommees integer, lectures_restantes integer,
  organisations integer, sieges_occupes integer, sieges_inclus integer, sieges_max integer,
  prix_mensuel_ht numeric,
  titulaire boolean,
  pris_en_charge_par text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_n       bigint;
  v_choisie record;
begin
  -- 1. TITULAIRE : la ligne entière — sauf ce que la comptabilité paie pour lui.
  if p_tenant is null then
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
     where l.titulaire = auth.uid();
  else
    select count(*), (array_agg(l.id))[1] into v_n, v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where l.titulaire = auth.uid() and lo.tenant_id = p_tenant;
  end if;

  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce titulaire : precisez l''organisation (public.mon_forfait(p_tenant))'
      using errcode = '21000';
  end if;

  if v_n = 1 then
    select p.offre_code, p.comptabilite into v_choisie
      from facturation.prise_en_charge_de(v_licence) p;
    return query
      select v_licence, p_tenant,
             c.offre_code, c.statut, c.lectures_droit, c.lectures_consommees,
             c.lectures_restantes, c.organisations, c.sieges_occupes,
             c.sieges_inclus::integer, c.sieges_max::integer,
             case
               when v_choisie.offre_code is null then c.prix_mensuel_ht::numeric
               else nullif(greatest(
                      c.prix_mensuel_ht::numeric
                        - coalesce((ref.offre_a(v_choisie.offre_code, current_date)).prix_mensuel_ht::numeric, 0),
                      0), 0)
             end,
             true,
             v_choisie.comptabilite
        from facturation.consommation_v c
       where c.licence_id = v_licence;
    return;
  end if;

  -- 2. MEMBRE d'une organisation rattachée : le nom de l'offre et le compteur
  -- de lectures. Ce qui limite son travail le concerne ; ce que son employeur
  -- paie, non. Un membre de cabinet n'est membre que du cabinet : il ne lit
  -- pas le compteur de sa cliente.
  if p_tenant is null then
    select count(distinct lo.licence_id), (array_agg(distinct lo.licence_id))[1]
      into v_n, v_licence
      from facturation.licence_organisations lo
     where lo.tenant_id in (select app.member_orgs());
  else
    select count(distinct lo.licence_id), (array_agg(distinct lo.licence_id))[1]
      into v_n, v_licence
      from facturation.licence_organisations lo
     where lo.tenant_id = p_tenant
       and lo.tenant_id in (select app.member_orgs());
  end if;

  if v_n > 1 then
    raise exception
      'plusieurs licences pour ce membre : precisez l''organisation (public.mon_forfait(p_tenant))'
      using errcode = '21000';
  end if;

  if v_n = 1 then
    return query
      select v_licence, p_tenant,
             c.offre_code, null::text, c.lectures_droit, c.lectures_consommees,
             c.lectures_restantes, null::integer, null::integer, null::integer,
             null::integer, null::numeric, false, null::text
        from facturation.consommation_v c
       where c.licence_id = v_licence;
  end if;

  return;
end
$$;

revoke all on function public.mon_forfait(uuid) from public, anon;
grant execute on function public.mon_forfait(uuid) to authenticated;

comment on function public.mon_forfait(uuid) is
  'Le forfait de l''appelant POUR UNE ORGANISATION. Titulaire : la ligne '
  'entière, sauf ce que la comptabilité paie pour lui — sous prise en charge, '
  '`prix_mensuel_ht` est le seul complément qu''il paie lui-même. Membre d''une '
  'organisation rattachée : le nom de l''offre et le compteur de lectures, le '
  'reste à null. Sans organisation, elle répond s''il n''y a qu''une réponse '
  'possible, et lève sinon. Un AFFICHAGE : la décision d''une lecture se prend '
  'dans `lecture_autorisee`.';

-- ===========================================================================
-- 4. LES OFFRES : LE COMPLÉMENT, PAS LE PRIX
-- ===========================================================================
--
-- Sous prise en charge, chaque offre plus haute porte ce que la société
-- paierait EN PLUS de l'offre choisie (prix et TTC du complément) ; l'offre
-- choisie et celles d'en dessous ne portent aucun prix. Les plus basses sont
-- marquées par l'empêchement « choisi_par_la_comptabilite ».

create or replace function public.mes_offres(p_tenant uuid default null, p_le date default current_date)
returns table (
  code text, libelle text, rang smallint, prix_mensuel_ht numeric,
  lectures_par_organisation integer, lectures_incluses integer,
  sieges_inclus smallint, sieges_max smallint,
  organisations_incluses smallint, organisations_max smallint,
  courant boolean, empechement text, chiffres jsonb, prix_ttc numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_annuel  boolean;
  v_base    numeric;
begin
  select f.offre_code into v_courant
    from facturation.forfait_courant_v f where f.licence_id = v_licence;
  select exists (select 1 from facturation.engagements_annuels e
                  where e.licence_id = v_licence and e.au >= p_le) into v_annuel;
  -- Ce que la comptabilité paie pour la société : la base dont on retranche.
  select (ref.offre_a(p.offre_code, p_le)).prix_mensuel_ht::numeric into v_base
    from facturation.prise_en_charge_de(v_licence) p;

  return query
    with grille as (
      select distinct on (o.code) o.*
        from ref.offres o
       where o.effective_from <= p_le
       order by o.code, o.effective_from desc),
    a_payer as (
      select g.*,
             case when v_base is null then g.prix_mensuel_ht::numeric
                  else nullif(greatest(g.prix_mensuel_ht::numeric - v_base, 0), 0) end as paye
        from grille g)
    select g.code, g.libelle, g.rang, g.paye,
           g.lectures_par_organisation,
           (g.lectures_par_organisation * g.organisations_incluses)::int,
           g.sieges_inclus, g.sieges_max,
           g.organisations_incluses, g.organisations_max,
           (g.code = v_courant) as courant,
           case when v_annuel and g.code <> v_courant then 'engagement_annuel' else e.code end,
           case when v_annuel and g.code <> v_courant then '{}'::jsonb else e.chiffres end,
           case when g.paye is null then null
                else (public.prix_ttc(g.paye, p_le) ->> 'ttc')::numeric end
      from a_payer g
      cross join lateral facturation.empechement_de_forfait(v_licence, g.code, p_le) e
     order by g.rang;
end;
$$;

-- ===========================================================================
-- 5. L'ANNÉE : FERMÉE SOUS PRISE EN CHARGE, ET SANS PRIX
-- ===========================================================================
--
-- `mon_annuel` disait déjà `ferme = paye_par_un_cabinet`, mais rendait quand
-- même la proposition chiffrée (« 340,000 TND HT / an ») : l'écran l'affichait.
-- Fermée, l'année ne propose plus rien.

create or replace function public.mon_annuel(p_tenant uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence  uuid;
  v_regle    jsonb := public.abonnement_reglage();
  v_offerts  smallint := (v_regle ->> 'annuel_mois_offerts')::smallint;
  v_courant  record;
  v_en_cours facturation.engagements_annuels;
  v_du       date;
  v_prix     numeric;
  v_ferme    text;
begin
  if p_tenant is null then
    select l.id into v_licence from facturation.licences l
     where l.titulaire = auth.uid() order by l.id limit 1;
  else
    select l.id into v_licence
      from facturation.licences l
      join facturation.licence_organisations lo on lo.licence_id = l.id
     where lo.tenant_id = p_tenant and l.titulaire = auth.uid();
  end if;
  if v_licence is null then
    return null;   -- seul le propriétaire principal voit l'année : c'est lui qui paie.
  end if;

  -- L'échéance suivante d'une PME payée d'avance ; sinon le mois prochain.
  select x.couvre_au into v_du
    from facturation.factures x
   where x.licence_id = v_licence and x.payeur_type = 'titulaire' and x.ancre is not null
     and x.avoir_de is null and x.statut <> 'annulee'
     and x.couvre_du <= current_date and x.couvre_au > current_date
   order by x.couvre_au desc limit 1;
  v_du := coalesce(v_du, (date_trunc('month', current_date) + interval '1 month')::date);

  -- L'engagement en cours, ou celui qui commencera à la prochaine échéance.
  select e.* into v_en_cours from facturation.engagements_annuels e
   where e.licence_id = v_licence and e.au >= current_date
   order by e.du desc limit 1;
  if v_en_cours.id is not null then
    return jsonb_build_object(
      'en_cours', jsonb_build_object(
        'du', v_en_cours.du, 'au', v_en_cours.au, 'offre', v_en_cours.offre_code,
        'montant_ht', v_en_cours.montant_ht, 'mois_offerts', v_en_cours.mois_offerts));
  end if;

  select h.offre_code, h.offre_depuis into v_courant
    from facturation.forfait_courant_v h where h.licence_id = v_licence;
  select o.prix_mensuel_ht into v_prix from ref.offre_a(v_courant.offre_code, v_courant.offre_depuis) o;

  v_ferme := case
    when not coalesce((v_regle ->> 'annuel_ouvert')::boolean, false) then 'annuel_ferme'
    when v_prix is null or v_prix <= 0 then 'offre_sans_prix'
    when exists (select 1 from facturation.payeurs_v pv
                  where pv.licence_id = v_licence and pv.payeur_type = 'cabinet'
                    and (pv.au_exclu is null or pv.au_exclu > current_date)) then 'paye_par_un_cabinet'
    when exists (select 1 from facturation.licences l
                  where l.id = v_licence and l.statut <> 'active') then 'licence_inactive'
    else null end;

  -- La comptabilité paie : aucune proposition, donc aucun prix.
  if v_ferme = 'paye_par_un_cabinet' then
    return jsonb_build_object('en_cours', null, 'ferme', v_ferme, 'proposition', null);
  end if;

  return jsonb_build_object(
    'en_cours', null,
    'ferme', v_ferme,
    'proposition', case when v_prix is null then null else jsonb_build_object(
      'offre', v_courant.offre_code,
      'du', v_du,
      'au', (v_du + interval '12 months - 1 day')::date,
      'prix_mensuel_ht', v_prix,
      'mois_offerts', v_offerts,
      'montant_ht', v_prix * (12 - v_offerts),
      'ttc', (public.prix_ttc(v_prix * (12 - v_offerts)) ->> 'ttc')::numeric) end);
end
$$;

-- ===========================================================================
-- 6. LA PROPOSITION PART SANS PRIX
-- ===========================================================================
--
-- La notification et la trace d'audit écrites CHEZ LA SOCIÉTÉ portaient
-- `prix_mensuel_ht` : lisibles par elle, elles disaient ce que la comptabilité
-- allait payer. Le prix reste dans la trace écrite chez la comptabilité.

create or replace function public.acces_proposer(p_cabinet uuid, p_client uuid, p_offre text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id    uuid;
  v_grille ref.offres;
begin
  if not app.has_org_role(p_cabinet, array['expert']) then
    raise exception 'refus.reserve.expert'
      using errcode = '42501';
  end if;
  if not exists (select 1 from identity.engagements e
                  where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
                    and e.status = 'actif') then
    raise exception 'refus.mandat.hors_cabinet' using errcode = '42501';
  end if;
  if exists (select 1 from facturation.acces a
              where a.tenant_id = p_client and a.statut in ('propose', 'actif', 'suspendu')) then
    raise exception 'refus.abonnement.deja_propose'
      using errcode = 'check_violation';
  end if;
  v_grille := ref.offre_a(p_offre, current_date);
  if v_grille.code is null then
    raise exception 'refus.offre.hors_grille' using errcode = '22023';
  end if;

  insert into facturation.acces
    (tenant_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut, propose_le, propose_par)
  values
    (p_client, 'cabinet', p_cabinet, v_grille.code, v_grille.effective_from, 'propose',
     current_date, auth.uid())
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_client, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('cabinet', p_cabinet, 'offre', v_grille.code));
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, auth.uid(), 'acces.propose', 'facturation', 'acces', v_id,
          jsonb_build_object('client', p_client, 'offre', v_grille.code,
                             'prix_mensuel_ht', v_grille.prix_mensuel_ht));
  insert into collab.notifications (tenant_id, kind, payload)
  values (p_client, 'acces.propose',
          jsonb_build_object('acces_id', v_id, 'offre', v_grille.code,
                             'cabinet', (select name from identity.organizations where id = p_cabinet)));
  return v_id;
end
$function$;
