-- Aucune montée gratuite.
--
-- Tour du pilote, 22 novembre 2026, après v0.2.113 : « Passer à Solo » est passé sans
-- paiement. `forfait_demander` laissait l'ancien chemin (le forfait d'abord) à la montée
-- pendant l'année et sous la facturation immédiate ; sans émetteur désigné, ce chemin ne
-- demandait rien, et la montée était gratuite. Désormais, sans paiement possible, toute
-- montée que la société paierait elle-même est refusée, quel que soit son chemin.

begin;

create or replace function public.forfait_demander(p_offre text, p_tenant uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_devis   jsonb;
  v_le      date;
  f         record;
  v_ht      numeric;
  v_tva     numeric;
  v_timbre  numeric;
  v_dem     uuid;
  v_id      uuid;
begin
  select c.offre_code into v_courant
    from facturation.forfait_courant_v c where c.licence_id = v_licence;

  -- Aucune montée gratuite (pilote, 22 novembre 2026) : une montée que la société paierait
  -- elle-même, sans aucun paiement possible (pas d'émetteur désigné), est refusée — quel que
  -- soit son chemin, l'année ou la facturation immédiate comprises. `mes_offres` rend le prix
  -- que la société paie ; nul quand sa comptabilité la prend entièrement en charge.
  if v_licence is not null and v_courant is not null
     and (ref.offre_a(p_offre, current_date)).rang > (ref.offre_a(v_courant, current_date)).rang
     and not exists (select 1 from facturation.emetteurs em where em.valide_des <= current_date)
     and (select m.prix_mensuel_ht from public.mes_offres(p_tenant) m where m.code = p_offre) is not null then
    raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
  end if;

  -- Le chemin d'avant : une descente (rien à payer), une montée pendant l'année
  -- (réglée par l'année) ou sous la facturation immédiate (réglée par la facture
  -- du jour). `forfait_changer` dit lui-même ses refus.
  if v_licence is null or v_courant is null
     or (ref.offre_a(p_offre, current_date)).rang is null
     or (ref.offre_a(p_offre, current_date)).rang <= (ref.offre_a(v_courant, current_date)).rang
     or exists (select 1 from facturation.engagements_annuels e
                 where e.licence_id = v_licence and e.au >= current_date)
     or plateforme.facturation_auto_ouverte('pme') then
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', public.paiement_montee_preparer(p_tenant));
  end if;

  -- Les refus du changement (la porte, l'empêchement) se disent AVANT de faire payer :
  -- le changement est joué, puis défait. Hors facturation immédiate et hors année,
  -- il n'écrit rien d'autre que l'historique du forfait.
  begin
    perform public.forfait_changer(p_offre, p_tenant);
    raise exception using errcode = 'MLM01';
  exception when sqlstate 'MLM01' then
    null;
  end;

  v_devis := public.montee_devis(p_offre, p_tenant);

  -- Rien que la société paie elle-même : l'offre s'ouvre tout de suite.
  if coalesce((v_devis ->> 'ecart_mensuel_ht')::numeric, 0) <= 0 then
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', null);
  end if;

  -- Un écart à payer, mais aucun paiement possible (pas d'émetteur désigné) : la
  -- montée ne s'ouvre pas gratuitement.
  if (v_devis ->> 'a_regler_ttc') is null then
    raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
  end if;

  -- Le jour du devis : celui de la plateforme (il y a un émetteur, sinon on serait sorti).
  v_le := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;

  -- La même demande, encore à payer : on la rend telle quelle.
  select p.id into v_id
    from facturation.montees_demandees d
    join facturation.paiements_en_ligne p on p.montee_demandee_id = d.id
    join facturation.paiements_en_ligne_v v on v.paiement_id = p.id
   where d.licence_id = v_licence and d.offre_code = p_offre and d.le = v_le
     and v.etat in ('a_payer', 'lien_cree', 'non_abouti', 'refuse')
   order by d.cree_le desc limit 1;
  if v_id is not null then
    return jsonb_build_object('change', false, 'paiement',
      (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
  end if;

  select * into f from facturation.fiscalite_en_vigueur(v_le);
  v_ht := (v_devis ->> 'a_regler_ht')::numeric;
  v_tva := (v_devis ->> 'a_regler_tva')::numeric;
  v_timbre := coalesce((v_devis ->> 'timbre')::numeric, 0);

  insert into facturation.montees_demandees (licence_id, par_societe, offre_code, le, demande_par)
  values (v_licence, p_tenant, p_offre, v_le, auth.uid())
  returning id into v_dem;

  insert into facturation.paiements_en_ligne
    (licence_id, objet, montee_demandee_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
     montant_ttc, devise, cree_par)
  values
    (v_licence, 'montee_demandee', v_dem,
     'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
       || ' — ' || (v_devis ->> 'jours_restants') || '/' || (v_devis ->> 'jours_du_mois') || ' jours',
     v_ht, f.taux, v_tva, v_timbre, v_ht + v_tva + v_timbre, v_devis ->> 'devise', auth.uid())
  returning id into v_id;

  return jsonb_build_object('change', false, 'paiement',
    (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
end
$$;
revoke all on function public.forfait_demander(text, uuid) from public, anon;
grant execute on function public.forfait_demander(text, uuid) to authenticated;

commit;
