-- ======================================================================
--  Une montée remplacée pendant l'année ne cache pas son écart (relecture de
--  #365, sur 20261214110000).
--
--  Abonné à l'année, Solo → Team puis Team → Premium avant d'avoir réglé la
--  première montée : son acompte passait « remplacé » (20261117110000) et le
--  nouveau ne portait que l'écart Team → Premium. L'écart Solo → Team restait
--  dû — la prochaine facture le portait — mais « À régler » le cachait.
--
--  La règle, un seul chemin : l'acompte d'une montée de l'année porte son
--  écart ET ceux des montées de la même année qu'il remplace, ni réglées ni
--  facturées. La facture porte une ligne par montée ; l'acompte s'y impute
--  en entier. Aucun montant compté deux fois, aucun perdu.
--
--  Repris de sa définition en vigueur (20261214110000) ; seule la somme change.
--  REJEU (R11) : aucune donnée de référence écrite.
-- ======================================================================

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
    v_jours  := extract(day from (date_trunc('month', r.effet_du) + interval '1 month'
                                  - interval '1 day'))::int;
    v_restants := v_jours - extract(day from r.effet_du)::int + 1;
    v_ht := round(v_ecart * v_restants / v_jours, 3);
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
                'Passage ' || initcap(v_prec.offre_code) || ' -> ' || initcap(r.offre_code)
                  || ' — ' || v_restants || '/' || v_jours || ' jours'),
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_id;

    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end loop;

  return null;   -- rien à payer maintenant : aucune montée due.
end
$function$;
