-- ======================================================================
--  Le devis d'une montée chiffre aussi le périmètre « PME » ouvert
--  (relevé de la revue de #381).
--
--  Périmètre FERMÉ : la montée se règle par un acompte jusqu'à la fin du mois
--  civil, sans timbre (inchangé, `20261222090000`).
--
--  Périmètre OUVERT : la montée se règle par la facture « complément » du
--  jour, sur la période d'avance de la société — de l'échéance qui court, pas
--  du mois civil — et cette facture porte le timbre. Le devis relit la MÊME
--  arithmétique que `facturation.emission_du_titulaire` :
--
--    HT      = round(écart × (fin − aujourd'hui) / (fin − début), 3)
--    TVA     = round(HT × taux, 3)
--    timbre  = celui de la fiscalité en vigueur
--
--  avec (début, fin) = `facturation.echeance_de(ancre, aujourd'hui)`, l'ancre
--  étant celle de la facture d'avance qui couvre le jour.
--
--  Le complément porte le tarif TOTAL de la nouvelle offre (places et sociétés en plus aux
--  occupations du jour) moins ce que les factures d'avance couvrent déjà.
--
--  Ce que le devis NE chiffre PAS, et dit en se taisant : un jour qui n'est
--  pas celui de la base (la facture du jour est datée de l'horloge de la base),
--  une société sans facture d'avance qui la couvre (la première émission
--  facture la base, pas un complément), une année en cours (déjà exclue), un accès payé par une comptabilité ou une offre
--  gardée (la part de la PME n'est plus le tarif total).
--  Un chiffre faux est pire que pas de chiffre.
--
--  REJEU (R11) : aucune donnée de référence écrite ; le corps d'une fonction
--  s'exécute plus tard.
-- ======================================================================

create or replace function public.montee_devis(
  p_offre  text,
  p_tenant uuid default null,
  p_le     date default current_date)
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
  v_ouvert  boolean := plateforme.facturation_auto_ouverte('pme');
  v_ancre   date;
  v_jour    date := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;
  p         record;
  v_ech     record;
  v_o       record;
  v_sieges  integer;
  v_orgs    integer;
  f         record;
  v_ht      numeric;
  v_restants integer;
  v_jours   integer;
  v_timbre  numeric := 0;
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
  select m.prix_ttc into v_plein from public.mes_offres(p_tenant, p_le) m where m.code = p_offre;

  if not v_ouvert then
    select * into p from facturation.montee_prorata(v_ecart, p_le);
    v_ht := p.ht;
    v_restants := p.restants;
    v_jours := p.jours;
  elsif p_le = v_jour
        and not coalesce(v_avant.garde_jusqu_au > p_le, false)
        and not exists (select 1 from facturation.acces a
                         where a.licence_id = v_licence and a.canal = 'cabinet'
                           and a.effet_du is not null and a.effet_du <= p_le
                           and (a.effet_au is null or a.effet_au > p_le)) then
    -- La facture d'avance qui couvre le jour donne l'ancre de l'échéance.
    select x.ancre into v_ancre
      from facturation.factures x
      join facturation.licences l on l.id = x.licence_id
     where x.licence_id = v_licence and x.payeur_type = 'titulaire'
       and x.payeur_personne = l.titulaire and x.ancre is not null
       and x.avoir_de is null and x.statut <> 'annulee'
       and x.couvre_du <= p_le and x.couvre_au > p_le
     order by x.couvre_au desc
     limit 1;
    if v_ancre is not null then
      -- Le complément facture le tarif TOTAL de la nouvelle offre (places et sociétés en plus
      -- comprises, aux occupations d'aujourd'hui) moins ce que les factures d'avance couvrent
      -- déjà : le même calcul que `facturation_du_titulaire`, pas l'écart des seuls prix de base.
      select d.sieges_occupes, d.organisations into v_sieges, v_orgs
        from facturation.droits_reels_v d where d.licence_id = v_licence;
      select * into v_o from ref.offre_a(p_offre, p_le);
      v_ecart := greatest(0,
        v_o.prix_mensuel_ht
        + v_o.prix_siege_sup * greatest(0, coalesce(v_sieges, 0) - v_o.sieges_inclus)
        + v_o.prix_organisation_sup * greatest(0, coalesce(v_orgs, 0) - v_o.organisations_incluses)
        - facturation.tarif_couvert_le(v_licence, p_le));
      if v_ecart > 0 then
        select * into v_ech from facturation.echeance_de(v_ancre, p_le);
        v_restants := v_ech.fin - p_le;
        v_jours := v_ech.fin - v_ech.debut;
        v_ht := round(v_ecart * v_restants / v_jours, 3);
      end if;
    end if;
  end if;

  -- Sans émetteur désigné, ALGORIA ne facture pas encore : pas de TVA supposée (R4).
  v_chiffre := coalesce(v_ht, 0) > 0
               and exists (select 1 from facturation.emetteurs em where em.valide_des <= p_le);
  if v_chiffre then
    select * into f from facturation.fiscalite_en_vigueur(p_le);
    v_tva := round(v_ht * f.taux, 3);
    v_devise := f.devise;
    -- Un acompte n'est pas une facture : pas de timbre. Le complément en est une.
    v_timbre := case when v_ouvert then f.timbre else 0 end;
  end if;
  return jsonb_build_object(
    'offre', p_offre,
    'ecart_mensuel_ht', v_ecart,
    'jours_restants', case when v_chiffre then v_restants end,
    'jours_du_mois', case when v_chiffre then v_jours end,
    'a_regler_ht', case when v_chiffre then v_ht end,
    'a_regler_tva', v_tva,
    'timbre', case when v_chiffre then v_timbre end,
    'a_regler_ttc', case when v_chiffre then v_ht + v_tva + v_timbre end,
    'devise', v_devise,
    'prix_plein_ttc', v_plein);
end
$$;

comment on function public.montee_devis(text, uuid, date) is
  'Ce que la montée vers l''offre demandée fait régler aujourd''hui : prorata, TVA du jour ; sans timbre en périmètre fermé (acompte), avec timbre en périmètre ouvert (facture complément sur l''échéance de la société). Les montants valent null quand ils ne se calculent pas avec certitude.';

revoke all on function public.montee_devis(text, uuid, date) from public, anon;
grant execute on function public.montee_devis(text, uuid, date) to authenticated;
