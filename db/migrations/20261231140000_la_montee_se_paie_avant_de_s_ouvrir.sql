-- La montée se paie avant de s'ouvrir.
--
-- ================================================================== POURQUOI
--
-- Tour du pilote, 22 novembre 2026 : « pourquoi je passe à un forfait supérieur
-- sans passer par le paiement, alors que ma comptabilité ne m'a pas invité ? »
-- La règle d'octobre ouvrait l'offre d'abord, puis demandait la différence
-- (« À régler ») ; sans émetteur désigné, rien n'était même demandé, et la
-- montée était gratuite.
--
-- Décision du même jour : PAYER D'ABORD. L'offre supérieure ne s'ouvre qu'au
-- paiement confirmé. Sans paiement possible (aucun émetteur), la montée est
-- refusée, et dit pourquoi. Ce que la société ne paie pas elle-même (rien à
-- régler : la comptabilité la prend en charge, ou l'écart est nul) s'ouvre
-- tout de suite, comme avant.
--
-- ================================================================== CE QUI SE FAIT
--
--   1. `facturation.montees_demandees` : la montée demandée, son jour, qui la
--      demande. `facturation.montees_ouvertes` : ce que le paiement en a fait
--      (le forfait ouvert, ou le refus qui l'en a empêché). Écrites une fois.
--   2. Un paiement de nature `montee_demandee`, chiffré par `montee_devis` —
--      la formule du devis, qui est celle de la préparation du paiement (R3) —
--      au jour de la demande.
--   3. `public.forfait_demander` : la porte du changement d'offre. Une descente,
--      une montée pendant l'année et la facturation immédiate gardent leur
--      chemin (le forfait d'abord) : leur règlement passe par l'année ou par la
--      facture du jour.
--   4. Au paiement confirmé, un déclencheur ouvre l'offre au jour de la
--      demande, au nom de qui l'a demandée, par `forfait_changer` — le prorata
--      est alors exactement celui qui a été payé. Si l'offre ne peut plus
--      s'ouvrir (la situation a changé entre-temps), le refus est écrit : la
--      tour le voit et rembourse ; le paiement n'est jamais rejeté.
--   5. `paiement_montee_preparer` ne repaie pas une montée déjà payée par sa
--      demande, quand un changement suivant la relit.
--
-- Le paiement reste imputé sur la facture comme tout acompte (objet autre que
-- `facture`) : rien ne change à la facturation.

begin;

-- --- 1. La demande, et ce qu'elle devient ----------------------------------

create table facturation.montees_demandees (
  id          uuid primary key default gen_random_uuid(),
  licence_id  uuid not null references facturation.licences (id),
  -- La société par laquelle la porte a trouvé la licence : l'argument de
  -- `forfait_changer`, pas un cloisonnement. La ligne appartient à la licence,
  -- comme le paiement en ligne.
  par_societe uuid references identity.organizations (id),
  offre_code  text not null,
  le          date not null,
  demande_par uuid not null,
  -- L'horloge réelle, pas celle de la transaction : deux demandes d'un même geste se suivent.
  cree_le     timestamptz not null default clock_timestamp()
);
create index montees_demandees_licence_idx on facturation.montees_demandees (licence_id, cree_le desc);

create table facturation.montees_ouvertes (
  montee_id  uuid primary key references facturation.montees_demandees (id),
  forfait_id uuid references facturation.forfait_historique (id),
  refus      text,
  le         timestamptz not null default now(),
  constraint montee_ouverte_ou_refusee check ((forfait_id is null) <> (refus is null))
);
create index montees_ouvertes_forfait_idx on facturation.montees_ouvertes (forfait_id)
  where forfait_id is not null;

create trigger montees_demandees_ne_se_reecrivent_pas
  before update or delete on facturation.montees_demandees
  for each row execute function app.deny_mutation();
create trigger montees_ouvertes_ne_se_reecrivent_pas
  before update or delete on facturation.montees_ouvertes
  for each row execute function app.deny_mutation();

alter table facturation.montees_demandees enable row level security;
alter table facturation.montees_ouvertes enable row level security;
create policy montees_demandees_lire on facturation.montees_demandees for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select l.id from facturation.licences l where l.titulaire = (select auth.uid())));
create policy montees_ouvertes_lire on facturation.montees_ouvertes for select to authenticated
  using (montee_id in (select d.id from facturation.montees_demandees d));
revoke all on facturation.montees_demandees, facturation.montees_ouvertes from public, anon, authenticated;
grant select on facturation.montees_demandees, facturation.montees_ouvertes to authenticated;

-- --- 2. Le paiement d'une montée demandée ----------------------------------

alter table facturation.paiements_en_ligne
  add column montee_demandee_id uuid unique references facturation.montees_demandees (id);

alter table facturation.paiements_en_ligne drop constraint paiements_en_ligne_objet_check;
alter table facturation.paiements_en_ligne add constraint paiements_en_ligne_objet_check
  check (objet in ('montee', 'recharge', 'annuel', 'facture', 'montee_demandee'));

alter table facturation.paiements_en_ligne drop constraint paiements_objet_designe;
alter table facturation.paiements_en_ligne add constraint paiements_objet_designe check (
  (objet = 'montee' and forfait_id is not null and recharge_id is null and engagement_id is null
     and facture_id is null and montee_demandee_id is null)
  or (objet = 'recharge' and recharge_id is not null and forfait_id is null and engagement_id is null
     and facture_id is null and montee_demandee_id is null)
  or (objet = 'annuel' and engagement_id is not null and forfait_id is null and recharge_id is null
     and facture_id is null and montee_demandee_id is null)
  or (objet = 'facture' and facture_id is not null and forfait_id is null and recharge_id is null
     and engagement_id is null and montee_demandee_id is null)
  or (objet = 'montee_demandee' and montee_demandee_id is not null and forfait_id is null
     and recharge_id is null and engagement_id is null and facture_id is null));

-- Une demande que la suivante remplace ne se paie plus, comme l'acompte d'une
-- montée remplacée. Repris de sa définition en vigueur ; seule la branche
-- `montee_demandee` s'ajoute.
create or replace view facturation.paiements_en_ligne_v with (security_invoker = true) as
SELECT p.id AS paiement_id,
    p.licence_id,
    p.objet,
    p.libelle,
    p.montant_ht,
    p.montant_tva,
    p.montant_ttc,
    p.devise,
    p.cree_le,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM facturation.paiement_evenements e
              WHERE ((e.paiement_id = p.id) AND (e.etat = 'paye'::text)))) THEN 'paye'::text
            WHEN ((p.objet = 'montee'::text) AND (NOT (EXISTS ( SELECT 1
               FROM facturation.forfait_historique c
              WHERE ((c.licence_id = p.licence_id) AND (c.effet_au IS NULL) AND ((c.id = p.forfait_id) OR ((c.garde_forfait_id = p.forfait_id) AND (c.garde_jusqu_au > CURRENT_DATE)))))))) THEN 'remplace'::text
            WHEN ((p.objet = 'montee_demandee'::text) AND (EXISTS ( SELECT 1
               FROM facturation.montees_demandees d
               JOIN facturation.montees_demandees s ON s.licence_id = d.licence_id AND s.cree_le > d.cree_le
              WHERE d.id = p.montee_demandee_id))) THEN 'remplace'::text
            WHEN ((d.etat = 'lien_cree'::text) AND (d.le < (now() - make_interval(mins => ((abonnement_reglage() ->> 'lien_valide_minutes'::text))::integer)))) THEN 'non_abouti'::text
            ELSE COALESCE(d.etat, 'a_payer'::text)
        END AS etat,
    d.prestataire,
    d.reference,
    d.lien,
    (EXISTS ( SELECT 1
           FROM facturation.paiement_imputations i
          WHERE (i.paiement_id = p.id))) AS impute,
    p.payeur_tenant_id
   FROM (facturation.paiements_en_ligne p
     LEFT JOIN LATERAL ( SELECT e.etat,
            e.prestataire,
            e.reference,
            e.lien,
            e.le
           FROM facturation.paiement_evenements e
          WHERE (e.paiement_id = p.id)
          ORDER BY e.le DESC, e.id DESC
         LIMIT 1) d ON (true));

-- --- 3. La porte du changement d'offre --------------------------------------

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

-- --- 4. Le paiement confirmé ouvre l'offre ----------------------------------

create or replace function facturation.une_montee_payee_s_ouvre()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  d        facturation.montees_demandees;
  v_rendu  text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ouvert uuid;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  select m.* into d
    from facturation.paiements_en_ligne p
    join facturation.montees_demandees m on m.id = p.montee_demandee_id
   where p.id = new.paiement_id and p.objet = 'montee_demandee';
  if d.id is null or exists (select 1 from facturation.montees_ouvertes o where o.montee_id = d.id) then
    return new;
  end if;

  perform set_config('request.jwt.claim.sub', d.demande_par::text, true);
  begin
    perform public.forfait_changer(d.offre_code, d.par_societe, d.le);
    select c.id into v_ouvert from facturation.forfait_courant_v c where c.licence_id = d.licence_id;
    insert into facturation.montees_ouvertes (montee_id, forfait_id) values (d.id, v_ouvert);
  exception when others then
    -- Le paiement n'est jamais rejeté : le refus s'écrit, la tour rembourse.
    insert into facturation.montees_ouvertes (montee_id, refus) values (d.id, sqlerrm);
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return new;
end
$$;
revoke all on function facturation.une_montee_payee_s_ouvre() from public, anon, authenticated;

create trigger une_montee_payee_s_ouvre
  after insert on facturation.paiement_evenements
  for each row execute function facturation.une_montee_payee_s_ouvre();

-- --- 4 bis. La porte d'essai ------------------------------------------------
--
-- Le jeu d'essai du développeur et les épreuves de la CI tournent sur une base
-- locale sans émetteur : aucune montée n'y peut plus se payer. Comme pour les
-- lectures toutes faites, ils jouent le serveur : cette porte n'ouvre l'offre
-- que si `malica.origine = 'serveur'`, que seule l'API pose, et l'API ne la
-- pose pour un appel venu de `/rpc` que sur une base locale avec les portes
-- d'essai ouvertes (`rpc.ts`, `origineDEssai`). Ailleurs, elle refuse.

create or replace function public.forfait_ouvrir_d_essai(p_offre text, p_tenant uuid default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = 'insufficient_privilege';
  end if;
  return public.forfait_changer(p_offre, p_tenant);
end
$$;
revoke all on function public.forfait_ouvrir_d_essai(text, uuid) from public, anon;
grant execute on function public.forfait_ouvrir_d_essai(text, uuid) to authenticated;

-- --- 5. Une montée payée par sa demande ne se repaie pas --------------------

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

commit;
