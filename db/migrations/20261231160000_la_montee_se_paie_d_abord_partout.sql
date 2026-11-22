-- La montée se paie d'abord, partout.
--
-- Le dirigeant, 22 novembre 2026 : « je ne veux plus de limites ». `forfait_demander`
-- (20261231140000) gardait l'ancien chemin — le forfait d'abord, le règlement ensuite —
-- pour la montée pendant l'année et sous la facturation immédiate. Désormais :
--
--   - PENDANT L'ANNÉE : le montant de l'année (l'écart des jours au mois, celui de l'année,
--     les montées remplacées non réglées) est calculé par son propre chemin, JOUÉ puis
--     défait — rien n'y est émis ni numéroté —, et payé d'abord. Au paiement, l'offre
--     s'ouvre au jour de la demande ; `annuel_monter` pose la montée de l'engagement, et
--     l'acompte s'impute sur la facture qui la porte, comme tout acompte.
--   - SOUS LA FACTURATION IMMÉDIATE : le complément du jour, chiffré par le devis (le même
--     calcul que la facture du jour), est payé d'abord. Au paiement, le changement émet sa
--     facture complémentaire, sur laquelle l'acompte payé s'impute. Un complément qui ne se
--     chiffre pas (aucune facture d'avance ne couvre le jour) ne s'ouvre pas gratuitement.
--
-- Et la préparation de l'année ne compte plus comme « non réglée » une montée payée
-- d'abord (`paiement_montee_preparer`, la somme des montées remplacées).

begin;

create or replace function public.forfait_demander(p_offre text, p_tenant uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_courant text;
  v_auto    boolean := plateforme.facturation_auto_ouverte('pme');
  v_annee   boolean;
  v_devis   jsonb;
  v_sim     jsonb;
  v_le      date;
  f         record;
  v_ht      numeric;
  v_tva     numeric;
  v_timbre  numeric;
  v_ttc     numeric;
  v_taux    numeric;
  v_devise  text;
  v_libelle text;
  v_dem     uuid;
  v_id      uuid;
begin
  select c.offre_code into v_courant
    from facturation.forfait_courant_v c where c.licence_id = v_licence;

  -- Une descente (rien à payer) garde son chemin. `forfait_changer` dit ses refus.
  if v_licence is null or v_courant is null
     or (ref.offre_a(p_offre, current_date)).rang is null
     or (ref.offre_a(p_offre, current_date)).rang <= (ref.offre_a(v_courant, current_date)).rang then
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', public.paiement_montee_preparer(p_tenant));
  end if;

  -- Rien que la société paie elle-même (sa comptabilité la prend entièrement en charge) :
  -- l'offre s'ouvre tout de suite. `mes_offres` rend le prix qu'elle paie, nul sinon.
  if (select m.prix_mensuel_ht from public.mes_offres(p_tenant) m where m.code = p_offre) is null then
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', null);
  end if;

  -- Aucun paiement possible : aucune montée gratuite (20261231150000).
  if not exists (select 1 from facturation.emetteurs em where em.valide_des <= current_date) then
    raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
  end if;

  -- Les refus du changement (la porte, l'empêchement) se disent AVANT de faire payer.
  v_annee := exists (select 1 from facturation.engagements_annuels e
                      where e.licence_id = v_licence and e.au >= current_date);
  if v_annee then
    -- Pendant l'année, le montant est celui que le chemin de l'année calcule (l'écart des
    -- jours au mois et celui de l'année, les montées remplacées non réglées) : il est JOUÉ,
    -- puis défait. Sur ce chemin, rien ne s'émet ni ne se numérote — seulement l'historique,
    -- la montée de l'engagement et l'acompte, tous défaits.
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      v_sim := public.paiement_montee_preparer(p_tenant);
      raise exception using errcode = 'MLM02', detail = coalesce(v_sim::text, 'null');
    exception when sqlstate 'MLM02' then
      get stacked diagnostics v_libelle = pg_exception_detail;
      v_sim := nullif(v_libelle, 'null')::jsonb;
    end;
    if v_sim is null then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_sim ->> 'montant_ht')::numeric;
    v_tva := (v_sim ->> 'montant_tva')::numeric;
    v_ttc := (v_sim ->> 'montant_ttc')::numeric;
    v_timbre := v_ttc - v_ht - v_tva;
    v_devise := v_sim ->> 'devise';
    v_libelle := v_sim ->> 'libelle';
  else
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      raise exception using errcode = 'MLM01';
    exception when sqlstate 'MLM01' then
      null;
    end;
    -- Au mois, ou sous la facturation immédiate (le complément du jour) : le devis, qui suit
    -- la formule de la préparation du paiement et celle de la facture du jour (R3).
    v_devis := public.montee_devis(p_offre, p_tenant);
    if (v_devis ->> 'a_regler_ttc') is null then
      -- Au mois, avec un émetteur, rien ne se chiffre que si rien n'est dû (un écart nul, ou
      -- plus aucun jour à payer) : l'offre s'ouvre.
      if not v_auto then
        perform public.forfait_changer(p_offre, p_tenant);
        return jsonb_build_object('change', true, 'paiement', null);
      end if;
      -- Sous la facturation immédiate, un complément qui ne se chiffre pas (aucune facture
      -- d'avance ne couvre le jour) ne s'ouvre pas gratuitement.
      raise exception 'refus.forfait.paiement_indisponible' using errcode = 'check_violation';
    end if;
    v_ht := (v_devis ->> 'a_regler_ht')::numeric;
    v_tva := (v_devis ->> 'a_regler_tva')::numeric;
    v_timbre := coalesce((v_devis ->> 'timbre')::numeric, 0);
    v_ttc := v_ht + v_tva + v_timbre;
    v_devise := v_devis ->> 'devise';
    v_libelle := 'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
      || ' — ' || (v_devis ->> 'jours_restants') || '/' || (v_devis ->> 'jours_du_mois') || ' jours';
  end if;

  -- Le jour du devis : celui de la plateforme (il y a un émetteur).
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
  v_taux := f.taux;

  insert into facturation.montees_demandees (licence_id, par_societe, offre_code, le, demande_par)
  values (v_licence, p_tenant, p_offre, v_le, auth.uid())
  returning id into v_dem;

  insert into facturation.paiements_en_ligne
    (licence_id, objet, montee_demandee_id, libelle, montant_ht, taux_tva, montant_tva, timbre,
     montant_ttc, devise, cree_par)
  values
    (v_licence, 'montee_demandee', v_dem, v_libelle, v_ht, v_taux, v_tva, v_timbre, v_ttc,
     coalesce(v_devise, f.devise), auth.uid())
  returning id into v_id;

  return jsonb_build_object('change', false, 'paiement',
    (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id));
end
$$;
revoke all on function public.forfait_demander(text, uuid) from public, anon;
grant execute on function public.forfait_demander(text, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.paiement_montee_preparer(p_tenant uuid DEFAULT NULL::uuid)
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
    -- Une montée payée d'abord (`forfait_demander`) l'est par sa demande : elle ne se
    -- repaie pas quand un changement suivant la relit.
    select p.id into v_id from facturation.paiements_en_ligne p
     where p.forfait_id = r.id
        or p.montee_demandee_id = (select o.montee_id from facturation.montees_ouvertes o
                                    where o.forfait_id = r.id);
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
                                     where p.forfait_id = m.forfait_id
                                        or p.montee_demandee_id = (
                                             select o.montee_id from facturation.montees_ouvertes o
                                              where o.forfait_id = m.forfait_id)));
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

-- Au paiement confirmé, l'offre s'ouvre (20261231140000). Sous la facturation immédiate,
-- la facture complémentaire du jour s'émet aussitôt, et l'acompte payé d'abord s'y encaisse :
-- une facture complémentaire n'impute pas les acomptes d'elle-même (seule la facture d'avance
-- de base le fait), et elle resterait due une seconde fois.
create or replace function facturation.une_montee_payee_s_ouvre()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  d         facturation.montees_demandees;
  p         facturation.paiements_en_ligne;
  v_rendu   text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ouvert  uuid;
  v_facture uuid;
  v_enc     uuid;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  select x.* into p from facturation.paiements_en_ligne x
   where x.id = new.paiement_id and x.objet = 'montee_demandee';
  if p.id is null then
    return new;
  end if;
  select m.* into d from facturation.montees_demandees m where m.id = p.montee_demandee_id;
  if exists (select 1 from facturation.montees_ouvertes o where o.montee_id = d.id) then
    return new;
  end if;

  perform set_config('request.jwt.claim.sub', d.demande_par::text, true);
  begin
    perform public.forfait_changer(d.offre_code, d.par_societe, d.le);
    select c.id into v_ouvert from facturation.forfait_courant_v c where c.licence_id = d.licence_id;
    insert into facturation.montees_ouvertes (montee_id, forfait_id) values (d.id, v_ouvert);

    if plateforme.facturation_auto_ouverte('pme')
       and exists (select 1 from facturation.prestataires_paiement pp
                    where pp.code = new.prestataire and pp.fait_entrer_argent)
       and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
      perform facturation.facturer_sur_le_champ(d.licence_id, d.le);
      select x.id into v_facture
        from facturation.factures x
       where x.licence_id = d.licence_id and x.payeur_type = 'titulaire'
         and x.payeur_personne = d.demande_par and x.nature = 'complement'
         and x.couvre_du >= d.le and x.avoir_de is null and x.statut <> 'annulee'
       order by x.created_at desc
       limit 1;
      if v_facture is not null then
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_facture, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
                new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (p.id, v_enc);
      end if;
    end if;
  exception when others then
    -- Le paiement n'est jamais rejeté : le refus s'écrit, la tour rembourse.
    insert into facturation.montees_ouvertes (montee_id, refus) values (d.id, sqlerrm);
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return new;
end
$$;
revoke all on function facturation.une_montee_payee_s_ouvre() from public, anon, authenticated;

commit;
