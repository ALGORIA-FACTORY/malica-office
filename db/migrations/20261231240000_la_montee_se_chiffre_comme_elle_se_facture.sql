-- La montée se chiffre comme elle se facture ; la descente attend l'échéance payée.
--
-- Recette Flouci sur le pilote, 24 novembre 2026.
--
-- 1. « Basic → Solo » était REFUSÉ (`refus.forfait.paiement_indisponible`) sur une société qui
--    avait payé Premium d'avance jusqu'au 16 décembre, puis était descendue en Basic. Le devis
--    du périmètre ouvert (`montee_devis`, 20261228090000) ne savait chiffrer qu'un cas — un
--    complément au-dessus d'une facture d'avance qui couvre le jour — et se TAISAIT pour tous
--    les autres : l'écart nul (la période payée couvre déjà l'offre demandée), l'offre gardée,
--    la comptabilité qui paie une part, l'absence de facture d'avance. Depuis « payer d'abord »
--    (20261231160000), se taire voulait dire refuser : quatre impasses, dont une où le client
--    a DÉJÀ payé plus que ce qu'il demande.
--
--    Désormais, sous la facturation d'avance, le montant d'une montée est LA FACTURE QU'ELLE
--    ÉMETTRA, jouée puis défaite par la fonction même qui l'émettra
--    (`facturation_du_titulaire`) : `facturation.montee_a_regler`. Un seul calcul, pas deux
--    qui divergent ; le devis le lit, `forfait_demander` le fait payer, le paiement reçu
--    l'émet pour de bon et s'y impute. Rien d'émis : rien n'est dû, l'offre s'ouvre.
--    Le jeu se défait par une exception rattrapée (comme le chemin de l'année, MLM02) : aucun
--    numéro de facture tiré, aucun avis envoyé, aucune ligne gardée.
--
-- 2. Le paiement reçu d'une montée émettait sa facture par `facturer_sur_le_champ`, qui AVALE
--    toute erreur en avertissement : une émission en échec laissait un paiement sans facture,
--    en silence. Il appelle maintenant `facturation_du_titulaire` ; une erreur remonte au bloc
--    du déclencheur, qui l'écrit (`montees_ouvertes.refus`) et la tour la voit. L'argent payé
--    en plus (le jour a changé entre la demande et le paiement) se dit au journal, comme pour
--    une facture (`paiement.trop_percu`).
--
-- 3. LA DESCENTE ATTEND L'ÉCHÉANCE (décision du dirigeant, 24 novembre 2026 ; CGV publiées,
--    art. 8 : « Descente : prend effet à la période suivante »). Sous la facturation d'avance,
--    une descente demandée pendant une période payée n'est plus appliquée le jour même — le
--    client perdait les droits qu'il avait payés. Elle se PROGRAMME pour la fin de la période
--    (`facturation.descentes_programmees`) ; elle s'applique le jour venu, avant que la période
--    suivante ne se facture (`facturation_du_titulaire` l'applique d'abord) ; une montée, ou
--    le retour à l'offre en cours, l'annule. Sans période payée (périmètre coupé, société
--    encore au mois), rien ne change : la descente garde son chemin.
--
-- REJEU (R11) : table neuve, fonctions `create or replace` reprises de leur définition EN
-- VIGUEUR (`pg_get_functiondef` d'une base migrée) ; aucune donnée de référence écrite.
-- _Gardé par_ apps/api/src/facturation/la-montee-se-chiffre-comme-elle-se-facture.test.ts.

begin;

-- ---------------------------------------------------------------- 1. Les descentes programmées
create table facturation.descentes_programmees (
  id            uuid primary key default gen_random_uuid(),
  licence_id    uuid not null references facturation.licences (id),
  offre_code    text not null,
  effet_le      date not null,
  demandee_par  uuid not null,
  demandee_le   timestamptz not null default now(),
  statut        text not null default 'programmee'
                check (statut in ('programmee', 'appliquee', 'annulee', 'refusee')),
  traitee_le    timestamptz,
  motif_fin     text,
  check ((statut = 'programmee') = (traitee_le is null))
);
comment on table facturation.descentes_programmees is
  'Une descente demandée pendant une période payée d''avance : elle prend effet à la fin de '
  'cette période (CGV, art. 8). Une seule programmée par licence ; une montée l''annule.';
create unique index descentes_programmees_une_par_licence
  on facturation.descentes_programmees (licence_id) where statut = 'programmee';
create index descentes_programmees_dues_idx
  on facturation.descentes_programmees (effet_le) where statut = 'programmee';

alter table facturation.descentes_programmees enable row level security;
create policy descentes_programmees_lire on facturation.descentes_programmees
  for select to authenticated
  using (facturation.titulaire_de(licence_id) or (select app.is_platform()));
revoke all on facturation.descentes_programmees from public, anon, authenticated;
grant select on facturation.descentes_programmees to authenticated;

-- ---------------------------------------------------------------- 2. Programmer, annuler, appliquer
/*
 * Programme la descente de la licence vers `p_offre` à la fin de sa période payée d'avance.
 * Rend `{offre, le}`, `{annulee: true}` quand l'offre demandée est celle en cours (le client
 * revient sur sa descente), ou `null` quand rien n'est à programmer (pas de facturation
 * d'avance, pas de période payée qui court) : la descente garde alors son chemin.
 * Les refus de l'offre (places, sociétés) se disent tout de suite, pas le jour venu.
 */
create function facturation.descente_programmer(p_licence uuid, p_offre text, p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jour    date;
  v_fin     date;
  v_courant text;
  v_emp     record;
  v_id      uuid;
begin
  if p_licence is null or not facturation.titulaire_de(p_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  if not plateforme.facturation_auto_ouverte('pme') then
    return null;
  end if;
  v_jour := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;
  if exists (select 1 from facturation.engagements_annuels e
              where e.licence_id = p_licence and e.au >= v_jour) then
    return null;   -- l'année ferme la descente : `forfait_changer` le dit.
  end if;
  select c.offre_code into v_courant
    from facturation.forfait_courant_v c where c.licence_id = p_licence;

  if p_offre = v_courant then
    perform facturation.descente_annuler_pour(p_licence, 'retour_a_l_offre');
    return jsonb_build_object('annulee', true, 'offre', v_courant);
  end if;

  v_fin := (facturation.periode_payee_d_avance(p_licence, v_jour)).fin;
  if v_fin is null or v_fin <= v_jour then
    return null;
  end if;

  select e.code, e.chiffres into v_emp
    from facturation.empechement_de_forfait(p_licence, p_offre, v_jour) e;
  if v_emp.code is not null then
    raise exception '%', app.refus_avec_valeurs('refus.forfait.empeche', 'motif', (v_emp.code)::text,
                                                'chiffres', (v_emp.chiffres)::text)
      using errcode = 'check_violation';
  end if;

  perform facturation.descente_annuler_pour(p_licence, 'remplacee');
  insert into facturation.descentes_programmees (licence_id, offre_code, effet_le, demandee_par)
  values (p_licence, p_offre, v_fin, auth.uid())
  returning id into v_id;
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_tenant, auth.uid(), 'forfait.descente_programmee', 'facturation',
          'descentes_programmees', v_id,
          jsonb_build_object('avant', v_courant, 'offre', p_offre, 'effet_le', v_fin));
  return jsonb_build_object('offre', p_offre, 'le', v_fin);
end
$$;
revoke all on function facturation.descente_programmer(uuid, text, uuid) from public, anon, authenticated;

create function facturation.descente_annuler_pour(p_licence uuid, p_motif text)
returns void
language sql
security definer
set search_path = ''
as $$
  update facturation.descentes_programmees
     set statut = 'annulee', traitee_le = now(), motif_fin = p_motif
   where licence_id = p_licence and statut = 'programmee'
$$;
revoke all on function facturation.descente_annuler_pour(uuid, text) from public, anon, authenticated;

/*
 * Applique les descentes programmées dues au `p_jour` (toutes, ou celles d'une licence), sous
 * l'identité du titulaire : la même porte que s'il l'avait faite lui-même ce jour-là. Une
 * descente devenue impossible (une place ou une société en plus depuis) ne s'applique pas :
 * elle est refusée, motif écrit ; l'offre en cours reste, et se facture.
 */
create function facturation.descentes_dues_appliquer(p_licence uuid, p_jour date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_rendu  text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_n      integer := 0;
begin
  for r in
    select d.id, d.licence_id, d.offre_code, d.effet_le, l.titulaire,
           (select lo.tenant_id from facturation.licence_organisations lo
             where lo.licence_id = d.licence_id order by lo.tenant_id limit 1) as tenant
      from facturation.descentes_programmees d
      join facturation.licences l on l.id = d.licence_id
     where d.statut = 'programmee' and d.effet_le <= p_jour
       and (p_licence is null or d.licence_id = p_licence)
     order by d.effet_le, d.id
     for update of d skip locked
  loop
    perform set_config('request.jwt.claim.sub', r.titulaire::text, true);
    begin
      perform public.forfait_changer(r.offre_code, r.tenant, r.effet_le);
      update facturation.descentes_programmees
         set statut = 'appliquee', traitee_le = now() where id = r.id;
      v_n := v_n + 1;
    exception when others then
      update facturation.descentes_programmees
         set statut = 'refusee', traitee_le = now(), motif_fin = sqlerrm where id = r.id;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return v_n;
end
$$;
revoke all on function facturation.descentes_dues_appliquer(uuid, date) from public, anon, authenticated;

-- La descente programmée du titulaire, lue par son écran.
create function public.ma_descente(p_tenant uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('offre', d.offre_code, 'le', d.effet_le)
    from facturation.descentes_programmees d
   where d.licence_id = facturation.ma_licence(p_tenant) and d.statut = 'programmee'
$$;
revoke all on function public.ma_descente(uuid) from public, anon;
grant execute on function public.ma_descente(uuid) to authenticated;

-- Le titulaire revient sur sa descente : son offre reste.
create function public.descente_annuler(p_tenant uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
begin
  if v_licence is null or not facturation.titulaire_de(v_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  perform facturation.descente_annuler_pour(v_licence, 'retour_a_l_offre');
  return true;
end
$$;
revoke all on function public.descente_annuler(uuid) from public, anon;
grant execute on function public.descente_annuler(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. La montée jouée, puis défaite
/*
 * Ce que la montée vers `p_offre` fera payer AUJOURD'HUI sous la facturation d'avance : la
 * facture que `facturation_du_titulaire` émettrait, jouée puis défaite. Seule compte la facture
 * qui couvre le jour (le complément, ou la base de la période quand aucune n'était émise) ; un
 * arriéré éventuel reste une facture à part, payée pour elle-même.
 * Rend `{ht, tva, timbre, ttc, devise, du, au, jours, jours_periode}` — `au` est le dernier
 * jour couvert —, ou `{rien: true, au}` quand rien n'est dû (la période payée couvre déjà
 * l'offre demandée). Les refus du changement remontent tels quels.
 */
create function facturation.montee_a_regler(
  p_licence uuid, p_offre text, p_tenant uuid, p_jour date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reglage plateforme.reglages_facturation_auto := plateforme.facturation_auto_en_vigueur('pme');
  v_det     text;
  v_avant   uuid[];
  r         jsonb;
begin
  if p_licence is null or not facturation.titulaire_de(p_licence) then
    raise exception 'refus.reserve.proprietaire_principal' using errcode = '42501';
  end if;
  -- Les factures qui existaient avant le jeu : seule compte celle que le jeu émet.
  select coalesce(array_agg(x.id), '{}') into v_avant
    from facturation.factures x where x.licence_id = p_licence;
  begin
    perform public.forfait_changer(p_offre, p_tenant, p_jour);
    perform facturation.facturation_du_titulaire(p_licence, p_jour, v_reglage.rattrapage_mois,
                                                 v_reglage.decide_par);
    select jsonb_build_object(
             'ht', x.montant_ht, 'tva', x.montant_tva, 'timbre', x.timbre, 'ttc', x.montant_ttc,
             'devise', x.devise, 'du', greatest(x.couvre_du, p_jour), 'au', x.couvre_au - 1,
             'jours', x.couvre_au - greatest(x.couvre_du, p_jour),
             'jours_periode', x.couvre_au - x.couvre_du)
      into r
      from facturation.factures x
      join facturation.licences l on l.id = x.licence_id
     where x.licence_id = p_licence and x.payeur_type = 'titulaire'
       and x.payeur_personne = l.titulaire and x.ancre is not null
       and x.avoir_de is null and x.statut <> 'annulee'
       and x.couvre_du <= p_jour and x.couvre_au > p_jour
       and x.emise_le = p_jour
       and not (x.id = any (v_avant))   -- émise par CE jeu, pas avant lui
     order by x.couvre_du desc
     limit 1;
    if r is null then
      r := jsonb_build_object('rien', true,
                              'au', (facturation.periode_payee_d_avance(p_licence, p_jour)).fin - 1);
    end if;
    raise exception using errcode = 'MLM03', detail = r::text;
  exception when sqlstate 'MLM03' then
    get stacked diagnostics v_det = pg_exception_detail;
  end;
  return v_det::jsonb;
end
$$;
revoke all on function facturation.montee_a_regler(uuid, text, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. Les fonctions reprises
CREATE OR REPLACE FUNCTION facturation.facturation_du_titulaire(p_licence uuid, p_jour date, p_rattrapage integer, p_acteur uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_titulaire uuid;
  v_fin       date;
  v_ancre     date;
  v_s         date;
  v_plancher  date;
  v_premiere  boolean := false;
  v_tarif     numeric;
  v_couvert   numeric;
  e           record;
  p           record;
  v_res       jsonb;
  v_factures  jsonb := '[]'::jsonb;
begin
  -- Une descente programmée prend effet le jour de son échéance, AVANT que la période
  -- suivante ne se facture : la base de cette période est au prix de la nouvelle offre.
  perform facturation.descentes_dues_appliquer(p_licence, p_jour);
  select l.titulaire into v_titulaire from facturation.licences l
   where l.id = p_licence and l.statut <> 'resiliee';
  if v_titulaire is null then
    return jsonb_build_object('factures', v_factures, 'couverte', false);
  end if;

  -- 1. Les échéances.
  select x.couvre_au, x.ancre into v_fin, v_ancre
    from facturation.factures x
   where x.licence_id = p_licence and x.payeur_type = 'titulaire'
     and x.payeur_personne = v_titulaire and x.avoir_de is null and x.statut <> 'annulee'
   order by x.couvre_au desc, x.ancre nulls last
   limit 1;

  if v_fin is not null and v_fin <= p_jour
     and exists (select 1 from facturation.part_du_titulaire_le(p_licence, v_fin)) then
    v_s     := v_fin;
    v_ancre := coalesce(v_ancre, facturation.debut_de_la_suite(p_licence, v_fin));
  elsif v_fin is null or v_fin <= p_jour then
    v_ancre    := facturation.debut_de_la_suite(p_licence, p_jour);
    v_s        := v_ancre;
    v_premiere := true;
  end if;

  if v_s is not null then
    -- La fenêtre recule d'ÉCHÉANCES, depuis la période en cours, sur l'ancre
    -- d'origine : reculer de mois civils ramène un 30 mars au 28 février et
    -- sauterait [31 janv., 28 févr.) (revue de #228).
    v_plancher := (facturation.echeance_de(v_ancre, p_jour)).debut;
    for i in 2 .. p_rattrapage loop
      exit when v_plancher <= v_ancre;
      v_plancher := (facturation.echeance_de(v_ancre, v_plancher - 1)).debut;
    end loop;
    if v_s < v_plancher then
      v_s := v_plancher;
      v_premiere := false;
    end if;
    while v_s <= p_jour loop
      select * into p from facturation.part_du_titulaire_le(p_licence, v_s);
      exit when p.part_ht is null;
      select * into e from facturation.echeance_de(v_ancre, v_s);
      v_res := facturation.emission_du_titulaire(
                 p_licence,
                 case when v_premiere and p.base_par_un_cabinet then 'complement' else 'base' end,
                 v_s, e.fin, e.debut, v_ancre, p.part_ht, not p.base_par_un_cabinet,
                 p.offre_code, p.reference, p_jour, p_acteur);
      if v_res ? 'facture_id' then
        v_factures := v_factures || v_res;
      end if;
      v_premiere := false;
      v_s := e.fin;
    end loop;
  end if;

  -- 2. Le complément du jour. Le jour est couvert par une facture de la
  -- suite, ou par l'année (un mois qu'elle paie seule n'a pas de facture).
  select x.ancre into v_ancre
    from facturation.factures x
   where x.licence_id = p_licence and x.payeur_type = 'titulaire'
     and x.payeur_personne = v_titulaire and x.ancre is not null
     and x.avoir_de is null and x.statut <> 'annulee'
     and x.couvre_du <= p_jour
   order by x.couvre_au desc
   limit 1;
  if v_ancre is null
     or not (exists (select 1 from facturation.factures x
                      where x.licence_id = p_licence and x.payeur_type = 'titulaire'
                        and x.payeur_personne = v_titulaire and x.ancre is not null
                        and x.avoir_de is null and x.statut <> 'annulee'
                        and x.couvre_du <= p_jour and x.couvre_au > p_jour)
             or (facturation.annuel_de(p_licence, p_jour)).id is not null) then
    return jsonb_build_object('factures', v_factures, 'couverte', false);
  end if;

  select * into p from facturation.part_du_titulaire_le(p_licence, p_jour);
  v_tarif   := coalesce(p.part_ht, 0);
  v_couvert := facturation.tarif_couvert_le(p_licence, p_jour);
  if v_tarif > v_couvert then
    select * into e from facturation.echeance_de(v_ancre, p_jour);
    v_res := facturation.emission_du_titulaire(
               p_licence, 'complement', p_jour, e.fin, e.debut, v_ancre, v_tarif - v_couvert,
               not p.base_par_un_cabinet, p.offre_code, p.reference, p_jour, p_acteur);
    if v_res ? 'facture_id' then
      v_factures := v_factures || v_res;
    end if;
  end if;
  return jsonb_build_object('factures', v_factures, 'couverte', true);
end
$function$;

CREATE OR REPLACE FUNCTION public.montee_devis(p_offre text, p_tenant uuid DEFAULT NULL::uuid, p_le date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_licence uuid := facturation.ma_licence(p_tenant);
  v_avant   facturation.forfait_historique;
  v_rang_a  smallint;
  v_rang_o  smallint;
  v_ecart   numeric;
  v_ouvert  boolean := plateforme.facturation_auto_ouverte('pme');
  v_ancre   date;
  -- Le jour de la PLATEFORME est celui du fuseau de l'émetteur. Sans émetteur désigné, ALGORIA ne
  -- facture pas encore (R4) : rien ne se chiffre plus bas (`v_chiffre`), et le devis se tait au lieu
  -- d'échouer — le pilote, le 16 novembre 2026, répondait « Le référentiel ne porte pas encore ce
  -- qu'il faut » au premier geste vers Basic ou Premium. Le jour du serveur ne sert alors qu'à lire
  -- le rang des offres.
  v_jour    date := case
                      when exists (select 1 from facturation.emetteurs em
                                    where em.valide_des <= current_date)
                        then (now() at time zone plateforme.fuseau_de_la_plateforme())::date
                      else current_date
                    end;
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
  v_sim     jsonb;
begin
  -- Le jour par défaut est celui de la PLATEFORME, l'horloge que la facturation immédiate compare ;
  -- il se résout ici, dans le corps (security definer) : un défaut de paramètre s'évalue avec les
  -- droits de l'appelant, qui n'exécute pas `fuseau_de_la_plateforme`.
  p_le := coalesce(p_le, v_jour);
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
  elsif p_le = v_jour then
    -- Périmètre OUVERT, aujourd'hui : la facture que la montée émettra, jouée puis défaite
    -- (`montee_a_regler`), la même que `forfait_demander` fera payer. Plus de cas tu :
    -- l'offre gardée, la comptabilité qui paie une part, l'absence de facture d'avance se
    -- chiffrent comme ils se factureront ; « rien à régler » se dit, au lieu de se taire.
    if not exists (select 1 from facturation.emetteurs em where em.valide_des <= p_le) then
      return jsonb_build_object('offre', p_offre, 'prix_plein_ttc', v_plein);
    end if;
    v_sim := facturation.montee_a_regler(v_licence, p_offre, p_tenant, p_le);
    return jsonb_build_object(
      'offre', p_offre,
      'ecart_mensuel_ht', null,
      'rien_a_regler', coalesce((v_sim ->> 'rien')::boolean, false),
      'du', v_sim ->> 'du',
      'au', v_sim ->> 'au',
      'jours_restants', (v_sim ->> 'jours')::int,
      'jours_du_mois', (v_sim ->> 'jours_periode')::int,
      'a_regler_ht', (v_sim ->> 'ht')::numeric,
      'a_regler_tva', (v_sim ->> 'tva')::numeric,
      'timbre', (v_sim ->> 'timbre')::numeric,
      'a_regler_ttc', (v_sim ->> 'ttc')::numeric,
      'devise', v_sim ->> 'devise',
      'prix_plein_ttc', v_plein);
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
    -- Périmètre ouvert sans montant chiffré : l'écart des seuls prix de base n'est pas le tarif total.
    'ecart_mensuel_ht', case when v_ouvert and v_ht is null then null else v_ecart end,
    'jours_restants', case when v_chiffre then v_restants end,
    'jours_du_mois', case when v_chiffre then v_jours end,
    'a_regler_ht', case when v_chiffre then v_ht end,
    'a_regler_tva', v_tva,
    'timbre', case when v_chiffre then v_timbre end,
    'a_regler_ttc', case when v_chiffre then v_ht + v_tva + v_timbre end,
    'devise', v_devise,
    'prix_plein_ttc', v_plein);
end
$function$;

CREATE OR REPLACE FUNCTION public.forfait_demander(p_offre text, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_programmee jsonb;
begin
  select c.offre_code into v_courant
    from facturation.forfait_courant_v c where c.licence_id = v_licence;

  -- Une descente ne se paie pas. Sous la facturation d'avance, elle attend la fin de la
  -- période payée : le client garde jusque-là ce qu'il a payé (CGV, art. 8). Sinon, elle
  -- garde son chemin. `forfait_changer` dit ses refus.
  if v_licence is null or v_courant is null
     or (ref.offre_a(p_offre, current_date)).rang is null
     or (ref.offre_a(p_offre, current_date)).rang <= (ref.offre_a(v_courant, current_date)).rang then
    if v_licence is not null and v_courant is not null
       and (ref.offre_a(p_offre, current_date)).rang is not null then
      v_programmee := facturation.descente_programmer(v_licence, p_offre, p_tenant);
      if v_programmee is not null then
        return jsonb_build_object('change', false, 'paiement', null, 'descente', v_programmee);
      end if;
    end if;
    perform public.forfait_changer(p_offre, p_tenant);
    return jsonb_build_object('change', true, 'paiement', public.paiement_montee_preparer(p_tenant));
  end if;

  -- Une montée annule la descente qui attendait l'échéance : le client a changé d'avis.
  perform facturation.descente_annuler_pour(v_licence, 'montee');

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
  elsif v_auto then
    -- SOUS LA FACTURATION D'AVANCE : le montant est la facture que la montée émettra, JOUÉE
    -- puis défaite par la fonction même qui l'émettra (`montee_a_regler`). Un seul calcul,
    -- pour tous les cas : complément au-dessus de ce qui est payé, offre gardée, comptabilité
    -- qui paie une part, aucune facture d'avance encore. Rien d'émis : rien n'est dû, la
    -- période payée couvre déjà l'offre demandée — elle s'ouvre (recette Flouci du
    -- 24 novembre 2026, point 1 : « Basic → Solo » sous un Premium payé était refusé).
    v_sim := facturation.montee_a_regler(v_licence, p_offre, p_tenant,
                                         (now() at time zone plateforme.fuseau_de_la_plateforme())::date);
    if coalesce((v_sim ->> 'rien')::boolean, false) then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
    end if;
    v_ht := (v_sim ->> 'ht')::numeric;
    v_tva := (v_sim ->> 'tva')::numeric;
    v_timbre := (v_sim ->> 'timbre')::numeric;
    v_ttc := (v_sim ->> 'ttc')::numeric;
    v_devise := v_sim ->> 'devise';
    v_libelle := 'Passage ' || initcap(v_courant) || ' → ' || initcap(p_offre)
      || ' — du ' || to_char((v_sim ->> 'du')::date, 'DD/MM/YYYY')
      || ' au ' || to_char((v_sim ->> 'au')::date, 'DD/MM/YYYY');
  else
    begin
      perform public.forfait_changer(p_offre, p_tenant);
      raise exception using errcode = 'MLM01';
    exception when sqlstate 'MLM01' then
      null;
    end;
    -- Au mois (périmètre coupé) : le devis, qui suit la formule de la préparation du
    -- paiement (R3). Rien ne se chiffre que si rien n'est dû : l'offre s'ouvre.
    v_devis := public.montee_devis(p_offre, p_tenant);
    if (v_devis ->> 'a_regler_ttc') is null then
      perform public.forfait_changer(p_offre, p_tenant);
      return jsonb_build_object('change', true, 'paiement', null);
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
$function$;

CREATE OR REPLACE FUNCTION facturation.une_montee_payee_s_ouvre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d         facturation.montees_demandees;
  p         facturation.paiements_en_ligne;
  v_rendu   text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_ouvert  uuid;
  v_facture uuid;
  v_enc     uuid;
  v_jour    date;
  v_reste   numeric;
  v_avant   uuid[];
  v_reglage plateforme.reglages_facturation_auto;
begin
  if new.etat <> 'paye' then
    return new;
  end if;
  -- Un « payé » du simulateur ne fait entrer aucun argent : il n'ouvre rien, comme il
  -- ne règle aucune facture (audit du 23 novembre 2026, B3).
  if not exists (select 1 from facturation.prestataires_paiement pp
                  where pp.code = new.prestataire and pp.fait_entrer_argent) then
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
      -- La facture se tire par la fonction même que le devis a jouée : celle qui couvre le
      -- jour porte le paiement. Une erreur d'émission remonte au bloc ci-dessous (le refus
      -- s'écrit, la tour le voit) au lieu d'être avalée en avertissement.
      v_jour := (now() at time zone plateforme.fuseau_de_la_plateforme())::date;
      v_reglage := plateforme.facturation_auto_en_vigueur('pme');
      select coalesce(array_agg(x.id), '{}') into v_avant
        from facturation.factures x where x.licence_id = d.licence_id;
      -- La facture qui naît de ce paiement naît réglée : son avis le dit (20261231270000).
      perform set_config('malica.paye_d_abord_le', v_jour::text, true);
      perform facturation.facturation_du_titulaire(d.licence_id, v_jour, v_reglage.rattrapage_mois,
                                                   v_reglage.decide_par);
      perform set_config('malica.paye_d_abord_le', '', true);
      -- La facture que CE paiement vient d'émettre et qui couvre le jour : la même que le
      -- devis a jouée (`montee_a_regler`).
      select x.id into v_facture
        from facturation.factures x
       where x.licence_id = d.licence_id and x.payeur_type = 'titulaire'
         and x.payeur_personne = d.demande_par and x.ancre is not null
         and x.avoir_de is null and x.statut <> 'annulee'
         and x.couvre_du <= v_jour and x.couvre_au > v_jour
         and x.emise_le = v_jour
         and not (x.id = any (v_avant))
       order by x.couvre_du desc
       limit 1;
      -- Une BASE émise impute d'elle-même les acomptes payés en ligne (`emission_du_titulaire`) :
      -- ce paiement l'est alors déjà, il ne s'impute pas deux fois.
      if v_facture is not null
         and not exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) then
        select e.reste_du into v_reste from facturation.encours_v e where e.facture_id = v_facture;
        insert into facturation.encaissements (facture_id, montant, moyen, reference, encaisse_le)
        values (v_facture, p.montant_ttc, facturation.moyen_encaissement_du_paiement(p.id),
                new.prestataire || ' ' || coalesce(new.reference, p.id::text), new.le::date)
        returning id into v_enc;
        insert into facturation.paiement_imputations (paiement_id, encaissement_id)
        values (p.id, v_enc);
        -- Payé plus que la facture (le jour a changé entre la demande et le paiement) :
        -- la différence est due au client, la tour la voit au journal.
        if v_reste is not null and p.montant_ttc > v_reste then
          insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
          values (d.par_societe, d.demande_par, 'paiement.trop_percu', 'facturation',
                  'paiements_en_ligne', p.id,
                  jsonb_build_object('facture_id', v_facture, 'encaisse', p.montant_ttc,
                                     'reste_du_avant', greatest(v_reste, 0),
                                     'trop_percu', p.montant_ttc - greatest(v_reste, 0),
                                     'devise', p.devise, 'prestataire', new.prestataire,
                                     'reference', new.reference));
        end if;
      end if;
    end if;
  exception when others then
    -- Le paiement n'est jamais rejeté : le refus s'écrit, la tour rembourse.
    insert into facturation.montees_ouvertes (montee_id, refus) values (d.id, sqlerrm);
  end;
  perform set_config('request.jwt.claim.sub', v_rendu, true);
  return new;
end
$function$;

revoke all on function public.forfait_demander(text, uuid) from public, anon;
grant execute on function public.forfait_demander(text, uuid) to authenticated;
revoke all on function public.montee_devis(text, uuid, date) from public, anon;
grant execute on function public.montee_devis(text, uuid, date) to authenticated;
revoke all on function facturation.une_montee_payee_s_ouvre() from public, anon, authenticated;
revoke all on function facturation.facturation_du_titulaire(uuid, date, integer, uuid)
  from public, anon, authenticated;

-- Le robot applique aussi les descentes dues des licences qu'il ne facture pas ce jour-là.
CREATE OR REPLACE FUNCTION fabrique.facturation_du_jour(p_jour date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cab jsonb;
  v_pme jsonb;
begin
  if p_jour is null then
    raise exception 'refus.saisie.incomplete' using errcode = '22023';
  end if;
  -- Deux appels concurrents ne se croisent pas : le second attend, puis voit
  -- que le jour est passé.
  perform pg_advisory_xact_lock(hashtext('fabrique.facturation_du_jour.emission')::bigint);
  if not (plateforme.facturation_auto_ouverte('cabinets')
          or plateforme.facturation_auto_ouverte('pme')) then
    return jsonb_build_object('etat', 'coupee', 'jour', p_jour);
  end if;
  -- La date d'émission des factures du cabinet (`current_date` de son corps)
  -- est celle de la plateforme, pour la fin de cette transaction.
  perform set_config('TimeZone', plateforme.fuseau_de_la_plateforme(), true);

  -- Les descentes dues s'appliquent avant toute facture du jour (CGV, art. 8).
  if plateforme.facturation_auto_ouverte('pme') then
    perform facturation.descentes_dues_appliquer(null, p_jour);
  end if;
  v_cab := fabrique.facturation_des_cabinets(p_jour);
  v_pme := fabrique.facturation_des_pme(p_jour);
  return jsonb_build_object(
    'etat', case when 'passee' in (v_cab ->> 'etat', v_pme ->> 'etat') then 'passee'
                 else 'deja_passee' end,
    'jour', p_jour,
    'cabinets', v_cab,
    'pme', v_pme);
end
$function$;

commit;
