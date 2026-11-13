-- ======================================================================
--  Le devis d'une montée, un paiement abandonné qui se dit, des flèches
--  qui sont des flèches (recette du 13 novembre 2026 sur le staging :
--  B2, B3, B9).
--
--  B3. « Confirmer : passer à Team » ne disait pas ce qu'il allait coûter.
--      Le devis se lit AVANT le geste, et il ne calcule pas : il appelle les
--      deux mêmes fonctions que `paiement_montee_preparer` — l'écart d'une
--      montée (`ecart_de_montee`, sortie du déclencheur qui le fige) et le
--      prorata au jour près (`montee_prorata`). Une seule formule, deux
--      lecteurs ; ce que le devis dit est ce que la préparation facturera.
--
--  B2. Un lien de paiement ouvert puis abandonné restait « lien_cree » pour
--      toujours. Il devient « non_abouti » une fois sa durée écoulée ; la
--      durée vit en base, dans le réglage d'abonnement versionné de la tour
--      (R4, R10) ; la tour la change sans déploiement.
--
--  B9. Les libellés écrits par la base disent « → », pas « -> » : la montée
--      mensuelle (`paiement_montee_preparer`) et la montée de l'année
--      (`annuel_monter`) sont reprises de leur définition en vigueur,
--      la flèche seule change. Les lignes déjà écrites ne se réécrivent pas
--      (R7).
--
--  REJEU (R11) : aucune donnée de référence écrite ; la nouvelle colonne a
--  un défaut constant, pas une date.
-- ======================================================================

-- --- 1. Le prorata d'une montée : une formule ----------------------------------

create or replace function facturation.montee_prorata(p_ecart numeric, p_jour date)
returns table (ht numeric, restants integer, jours integer)
language sql
stable
set search_path = ''
as $$
  select round(p_ecart * (d.jours - extract(day from p_jour)::int + 1) / d.jours, 3),
         d.jours - extract(day from p_jour)::int + 1,
         d.jours
    from (select extract(day from (date_trunc('month', p_jour) + interval '1 month'
                                   - interval '1 day'))::int as jours) d
$$;

comment on function facturation.montee_prorata(numeric, date) is
  'La part du mois qui reste, jour du changement compris : écart × jours restants / jours du mois, '
  'au millime. Lue par la préparation du paiement ET par le devis.';

revoke all on function facturation.montee_prorata(numeric, date) from public, anon, authenticated;

-- --- 2. L'écart d'une montée : sorti du déclencheur, lu par le devis -------------

create or replace function facturation.ecart_de_montee(
  p_licence uuid, p_offre text, p_depuis date, p_le date, p_avant facturation.forfait_historique)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gardee  facturation.forfait_historique;
  v_prix    numeric := (ref.offre_a(p_offre, p_depuis)).prix_mensuel_ht;
  v_prix_av numeric := (ref.offre_a(p_avant.offre_code, p_avant.offre_depuis)).prix_mensuel_ht;
  v_prix_g  numeric;
  v_cabinet numeric;
begin
  if p_avant.garde_jusqu_au > p_le then
    select h.* into v_gardee
      from facturation.forfait_historique h where h.id = p_avant.garde_forfait_id;
    v_prix_g := (ref.offre_a(v_gardee.offre_code, v_gardee.offre_depuis)).prix_mensuel_ht;
  end if;
  select sum(o.prix_mensuel_ht) into v_cabinet
    from facturation.acces a
    cross join lateral ref.offre_a(a.offre_code, a.offre_depuis) o
   where a.licence_id = p_licence and a.canal = 'cabinet'
     and a.effet_du is not null and a.effet_du <= p_le
     and (a.effet_au is null or a.effet_au > p_le);
  return greatest(0, v_prix - greatest(v_prix_av, coalesce(v_prix_g, 0), coalesce(v_cabinet, 0)));
end
$$;

comment on function facturation.ecart_de_montee(uuid, text, date, date, facturation.forfait_historique) is
  'Ce que le titulaire doit en plus par mois quand il monte à `p_offre` : le prix de la nouvelle offre '
  'moins le plus haut de ce qui couvrait déjà (l''offre d''avant, la gardée, ce que la comptabilité paie). '
  'Figé à la naissance de la ligne par le déclencheur ; lu tel quel par le devis.';

revoke all on function facturation.ecart_de_montee(uuid, text, date, date, facturation.forfait_historique)
  from public, anon, authenticated;

-- Repris de sa définition en vigueur (20261218090000) ; l'écart vient de la fonction ci-dessus.
create or replace function facturation.forfait_dit_ce_qui_reste_du()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avant    facturation.forfait_historique;
  v_gardee   facturation.forfait_historique;
  v_prix     numeric := (ref.offre_a(new.offre_code, new.offre_depuis)).prix_mensuel_ht;
  v_prix_av  numeric;
  v_prix_g   numeric;
  v_echeance date;
begin
  select h.* into v_avant
    from facturation.forfait_historique h
   where h.licence_id = new.licence_id and h.effet_au = new.effet_du
   order by h.rang desc
   limit 1;
  if v_avant.id is null then
    return new;
  end if;
  v_prix_av := (ref.offre_a(v_avant.offre_code, v_avant.offre_depuis)).prix_mensuel_ht;

  if v_avant.garde_jusqu_au > new.effet_du then
    select h.* into v_gardee
      from facturation.forfait_historique h where h.id = v_avant.garde_forfait_id;
    v_prix_g := (ref.offre_a(v_gardee.offre_code, v_gardee.offre_depuis)).prix_mensuel_ht;
  end if;

  if new.motif = 'montee' then
    new.ecart_titulaire_ht :=
      facturation.ecart_de_montee(new.licence_id, new.offre_code, new.offre_depuis, new.effet_du, v_avant);
  end if;

  if v_gardee.id is not null and v_prix_g >= v_prix then
    new.garde_forfait_id := v_avant.garde_forfait_id;
    new.garde_jusqu_au   := v_avant.garde_jusqu_au;
  elsif v_prix_av > v_prix and coalesce(v_avant.ecart_titulaire_ht, 0) > 0 then
    v_echeance := facturation.echeance_suivante(new.licence_id, new.effet_du);
    if v_echeance > new.effet_du
       and v_avant.effet_du >= (v_echeance - interval '1 month')::date then
      new.garde_forfait_id := v_avant.id;
      new.garde_jusqu_au   := v_echeance;
    end if;
  end if;
  return new;
end
$$;

-- --- 3. La préparation reprend la formule commune, et dit « → » ---------------------

create or replace function public.paiement_montee_preparer(p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence  uuid;
  r          record;
  v_prec     record;
  v_ecart    numeric;
  v_jours    int;
  v_restants int;
  v_ht       numeric;
  f          record;
  v_id       uuid;
  v_facture  uuid;
  v_annee    facturation.engagement_montees;
begin
  select l.id into v_licence
    from facturation.licences l
    join facturation.licence_organisations lo on lo.licence_id = l.id
   where l.titulaire = auth.uid() and (p_tenant is null or lo.tenant_id = p_tenant)
   order by l.id limit 1;
  -- La porte, nommée (`schema.test.ts`) : dirigeant d'une société de la
  -- licence, ET son propriétaire principal.
  if v_licence is null
     or not exists (select 1 from facturation.licence_organisations lo
                     where lo.licence_id = v_licence
                       and app.has_org_role(lo.tenant_id, array['dirigeant']))
     or not facturation.titulaire_de(v_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;

  -- La montée en cours d'abord, puis celle que le forfait en cours garde.
  for r in
    select h.id, h.rang, h.offre_code, h.offre_depuis, h.effet_du, h.ecart_titulaire_ht
      from facturation.forfait_historique c
      join facturation.forfait_historique h
        on h.id = c.id or (h.id = c.garde_forfait_id and c.garde_jusqu_au > current_date)
     where c.licence_id = v_licence and c.effet_au is null and h.motif = 'montee'
     order by (h.id = c.id) desc
  loop
    -- Déjà préparé : on le rend tel quel.
    select p.id into v_id from facturation.paiements_en_ligne p where p.forfait_id = r.id;
    if v_id is not null then
      return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
    end if;

    -- Une montée pendant l'année, ou avant qu'elle commence (7.5) : l'écart
    -- de l'année se règle le jour même, quel que soit le périmètre.
    select m.* into v_annee from facturation.engagement_montees m where m.forfait_id = r.id;

    if plateforme.facturation_auto_ouverte('pme') and v_annee.id is null then
      perform facturation.facturer_sur_le_champ(v_licence, r.effet_du);
      select x.id into v_facture
        from facturation.factures x
       where x.licence_id = v_licence and x.payeur_type = 'titulaire'
         and x.payeur_personne = auth.uid() and x.ancre is not null
         and x.couvre_du >= r.effet_du and x.avoir_de is null and x.statut <> 'annulee'
       order by x.created_at desc, (x.nature = 'complement') desc
       limit 1;
      if v_facture is not null then
        return public.paiement_facture_preparer(v_facture);
      end if;
      continue;   -- rien d'émis pour elle (déjà couvert, ou le passage réessaiera).
    end if;

    select h.offre_code, h.offre_depuis into v_prec
      from facturation.forfait_historique h
     where h.licence_id = v_licence and h.effet_au = r.effet_du and h.rang < r.rang
     order by h.rang desc limit 1;
    if v_prec.offre_code is null then
      continue;
    end if;
    v_ecart := coalesce(
      r.ecart_titulaire_ht,
      (ref.offre_a(r.offre_code, r.offre_depuis)).prix_mensuel_ht
        - (ref.offre_a(v_prec.offre_code, v_prec.offre_depuis)).prix_mensuel_ht);
    -- La seule formule du prorata, la même que celle du devis (`montee_devis`).
    select p.ht, p.restants, p.jours into v_ht, v_restants, v_jours
      from facturation.montee_prorata(v_ecart, r.effet_du) p;
    if v_annee.id is not null then
      -- Les jours d'avant l'année restent au mois (sauf périmètre ouvert, où
      -- le complément du jour les porte) ; ceux de l'année, par l'écart annuel.
      v_ht := case when r.effet_du < (select e.du from facturation.engagements_annuels e
                                         where e.id = v_annee.engagement_id)
                    and not plateforme.facturation_auto_ouverte('pme')
                   then coalesce(v_ht, 0) else 0 end
              -- L'écart de cette montée, et ceux des montées de la même année
              -- qu'elle remplace sans qu'ils aient été réglés ni facturés : un
              -- acompte remplacé ne se paie plus, son écart passe ici, une fois.
              + (select sum(m.montant_ht)
                   from facturation.engagement_montees m
                  where m.engagement_id = v_annee.engagement_id
                    and (m.le, m.created_at) <= (v_annee.le, v_annee.created_at)
                    and not exists (select 1 from facturation.facture_engagement_montees fm
                                     where fm.montee_id = m.id)
                    and not exists (select 1 from facturation.paiements_en_ligne p
                                      join facturation.paiement_evenements ev
                                        on ev.paiement_id = p.id and ev.etat = 'paye'
                                     where p.forfait_id = m.forfait_id));
    end if;
    if v_ht is null or v_ht <= 0 then
      continue;
    end if;

    -- Sans émetteur désigné, ALGORIA ne facture pas encore : rien ne se prépare,
    -- et on ne suppose aucune TVA (R4). L'offre reste ouverte ; la tour désigne
    -- l'émetteur, et le paiement suivra la facture.
    if not exists (select 1 from facturation.emetteurs e where e.valide_des <= r.effet_du) then
      return null;
    end if;

    select * into f from facturation.fiscalite_en_vigueur(r.effet_du);

    insert into facturation.paiements_en_ligne
      (licence_id, objet, forfait_id, libelle, montant_ht, taux_tva, montant_tva, montant_ttc,
       devise, cree_par)
    values
      (v_licence, 'montee', r.id,
       coalesce(v_annee.libelle,
                'Passage ' || initcap(v_prec.offre_code) || ' → ' || initcap(r.offre_code)
                  || ' — ' || v_restants || '/' || v_jours || ' jours'),
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_id;

    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end loop;

  return null;   -- rien à payer maintenant : aucune montée due.
end
$function$;

-- --- 4. La montée de l'année dit « → » -----------------------------------------------

create or replace function facturation.annuel_monter(p_licence uuid, p_le date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e        facturation.engagements_annuels;
  h        facturation.forfait_historique;
  v_prix   numeric;
  v_couv   numeric;
  v_ecart  numeric;
  v_jr     integer;
  v_ja     integer;
  v_ht     numeric;
begin
  select x.* into e from facturation.engagements_annuels x
   where x.licence_id = p_licence and x.au >= p_le
   order by x.du desc limit 1;
  if e.id is null then
    return;
  end if;
  select f.* into h from facturation.forfait_historique f
   where f.licence_id = p_licence and f.effet_au is null;
  v_prix  := (ref.offre_a(h.offre_code, h.offre_depuis)).prix_mensuel_ht;
  v_couv  := (facturation.annuel_de(p_licence, greatest(p_le, e.du))).prix_mensuel_ht;
  v_ecart := v_prix - v_couv;
  if v_ecart <= 0 then
    return;
  end if;
  if p_le < e.du then
    v_ht := v_ecart * (12 - e.mois_offerts);
  else
    v_jr := e.au + 1 - p_le;
    v_ja := e.au + 1 - e.du;
    v_ht := round(v_ecart * 12 * v_jr / v_ja, 3);
  end if;
  insert into facturation.engagement_montees
    (engagement_id, licence_id, forfait_id, offre_code, le, prix_mensuel_ht, ecart_mensuel_ht,
     jours_restants, jours_annee, montant_ht, libelle)
  values
    (e.id, p_licence, h.id, h.offre_code, p_le, v_prix, v_ecart, v_jr, v_ja, v_ht,
     'Abonnement annuel : passage ' || initcap(coalesce(
        (select m.offre_code from facturation.engagement_montees m
          where m.engagement_id = e.id order by m.le desc, m.created_at desc limit 1),
        e.offre_code))
       || ' → ' || initcap(h.offre_code) || ' — du '
       || to_char(greatest(p_le, e.du), 'DD/MM/YYYY') || ' au ' || to_char(e.au, 'DD/MM/YYYY')
       || case when v_jr is null then ' (12 mois, ' || e.mois_offerts || ' offerts)'
               else ' (' || v_jr || '/' || v_ja || ' jours)' end);
end
$function$;

-- --- 5. Le devis : ce que la montée coûtera, avant de la faire ---------------------------

create or replace function public.montee_devis(
  p_offre text, p_tenant uuid default null, p_le date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_avant   facturation.forfait_historique;
  v_rang_a  smallint;
  v_rang_o  smallint;
  v_ecart   numeric;
  p         record;
  f         record;
  v_tva     numeric;
  v_devise  text;
  v_plein   numeric;
  v_chiffre boolean;
begin
  if v_licence is null then
    return null;   -- seul le propriétaire principal paie : il est le seul à qui on chiffre.
  end if;
  select h.* into v_avant
    from facturation.forfait_historique h
   where h.licence_id = v_licence and h.effet_au is null;
  v_rang_a := (ref.offre_a(v_avant.offre_code, p_le)).rang;
  v_rang_o := (ref.offre_a(p_offre, p_le)).rang;
  if v_avant.id is null or v_rang_o is null or v_rang_o <= v_rang_a then
    return null;   -- une descente ne se paie pas.
  end if;
  -- Pendant l'année, l'écart se règle sur l'année (`annuel_monter`) : pas de devis mensuel.
  if exists (select 1 from facturation.engagements_annuels e
              where e.licence_id = v_licence and e.au >= p_le) then
    return null;
  end if;

  v_ecart := facturation.ecart_de_montee(v_licence, p_offre, p_le, p_le, v_avant);
  select * into p from facturation.montee_prorata(v_ecart, p_le);
  select m.prix_ttc into v_plein from public.mes_offres(p_tenant, p_le) m where m.code = p_offre;

  -- Périmètre « PME » ouvert : la montée se règle par la facture du jour, sur sa période
  -- d'avance (l'échéance de la société, pas la fin du mois civil). Le devis ne devine pas ce
  -- montant : il ne chiffre que le prix plein, et le complément figure sur la facture.
  -- Sans émetteur désigné, ALGORIA ne facture pas encore : pas de TVA supposée (R4).
  v_chiffre := not plateforme.facturation_auto_ouverte('pme')
               and p.ht > 0
               and exists (select 1 from facturation.emetteurs e where e.valide_des <= p_le);
  if v_chiffre then
    select * into f from facturation.fiscalite_en_vigueur(p_le);
    v_tva := round(p.ht * f.taux, 3);
    v_devise := f.devise;
  end if;
  return jsonb_build_object(
    'offre', p_offre,
    'ecart_mensuel_ht', v_ecart,
    'jours_restants', case when v_chiffre then p.restants end,
    'jours_du_mois', case when v_chiffre then p.jours end,
    'a_regler_ht', case when v_chiffre then p.ht end,
    'a_regler_tva', v_tva,
    'timbre', case when v_chiffre then 0 end,
    'a_regler_ttc', case when v_chiffre then p.ht + v_tva end,
    'devise', v_devise,
    'prix_plein_ttc', v_plein);
end
$$;

comment on function public.montee_devis(text, uuid, date) is
  'Lecture seule : ce que la montée vers `p_offre` fait régler aujourd''hui (prorata du mois, TVA du jour, '
  'sans timbre : un acompte) et le prix plein TTC des mois suivants. Même formule que '
  'paiement_montee_preparer. Les montants à régler sont null quand ils ne se devinent pas (périmètre '
  '« PME » ouvert, sans émetteur) ; null pour une descente, pendant l''année, ou hors titulaire.';

revoke all on function public.montee_devis(text, uuid, date) from public, anon;
grant execute on function public.montee_devis(text, uuid, date) to authenticated;

-- --- 6. Un lien abandonné se dit : la durée est un réglage de la tour -------------------

alter table plateforme.reglages_abonnement
  add column lien_valide_minutes integer not null default 60
    check (lien_valide_minutes between 5 and 10080);

comment on column plateforme.reglages_abonnement.lien_valide_minutes is
  'Combien de temps un lien de paiement ouvert reste « en cours » avant d''être dit non abouti. '
  'Défaut livré : une heure ; la tour le change par une ligne de plus (R10).';

create or replace function public.abonnement_reglage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('report_mois', r.report_mois,
                               'annuel_ouvert', r.annuel_ouvert,
                               'annuel_mois_offerts', r.annuel_mois_offerts,
                               'lien_valide_minutes', r.lien_valide_minutes,
                               'motif', r.motif, 'decide_le', r.decide_le)
       from plateforme.reglages_abonnement r
      order by r.decide_le desc, r.id desc limit 1),
    jsonb_build_object('report_mois', 0, 'annuel_ouvert', false, 'annuel_mois_offerts', 0,
                       'lien_valide_minutes', null,
                       'motif', null, 'decide_le', null))
$$;

-- La décision de la tour sur le report ou l'année garde la durée en vigueur.
create or replace function plateforme.abonnement_regler(
  p_report_mois smallint, p_annuel_ouvert boolean, p_annuel_mois_offerts smallint, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_lien integer;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  -- La durée du lien se reporte telle qu'elle est : cette décision ne la touche pas.
  select r.lien_valide_minutes into v_lien
    from plateforme.reglages_abonnement r order by r.decide_le desc, r.id desc limit 1;
  if v_lien is null then
    insert into plateforme.reglages_abonnement
      (report_mois, annuel_ouvert, annuel_mois_offerts, motif, decide_par)
    values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, p_motif, auth.uid())
    returning id into v_id;
  else
    insert into plateforme.reglages_abonnement
      (report_mois, annuel_ouvert, annuel_mois_offerts, lien_valide_minutes, motif, decide_par)
    values (p_report_mois, p_annuel_ouvert, p_annuel_mois_offerts, v_lien, p_motif, auth.uid())
    returning id into v_id;
  end if;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_abonnement r where r.id = v_id);
end
$$;

-- Repris de sa définition en vigueur (20261218090000) ; un lien ouvert depuis plus que sa durée
-- sans autre événement est `non_abouti` : la page de paiement le rouvre (« Payer »).
create or replace view facturation.paiements_en_ligne_v with (security_invoker = true) as
select
  p.id as paiement_id, p.licence_id, p.objet, p.libelle,
  p.montant_ht, p.montant_tva, p.montant_ttc, p.devise, p.cree_le,
  case
    when exists (select 1 from facturation.paiement_evenements e
                  where e.paiement_id = p.id and e.etat = 'paye') then 'paye'
    when p.objet = 'montee'
         and not exists (select 1 from facturation.forfait_historique c
                          where c.licence_id = p.licence_id and c.effet_au is null
                            and (c.id = p.forfait_id
                                 or (c.garde_forfait_id = p.forfait_id
                                     and c.garde_jusqu_au > current_date))) then 'remplace'
    -- Sans durée arrêtée, rien n'expire : aucun repli silencieux (R4).
    when d.etat = 'lien_cree'
         and d.le < now() - make_interval(
               mins => (public.abonnement_reglage() ->> 'lien_valide_minutes')::int)
      then 'non_abouti'
    else coalesce(d.etat, 'a_payer')
  end as etat,
  d.prestataire, d.reference, d.lien,
  exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) as impute,
  p.payeur_tenant_id
from facturation.paiements_en_ligne p
left join lateral (
  select e.etat, e.prestataire, e.reference, e.lien, e.le
    from facturation.paiement_evenements e
   where e.paiement_id = p.id
   order by e.le desc, e.id desc limit 1
) d on true;
