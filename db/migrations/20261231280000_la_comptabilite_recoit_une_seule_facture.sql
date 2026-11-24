-- La comptabilité reçoit UNE facture par mois, qui dit chaque abonnement et chaque passage.
--
-- Décision du dirigeant (24 novembre 2026) : la comptabilité n'a pas à payer en ligne pour
-- activer ou monter un client ; tout ce qu'elle a activé, et chaque passage d'offre, se
-- retrouve sur SA facture du mois, payable par virement (RIB sur la facture) ou en ligne.
-- La PME qui paie elle-même paie d'abord (carte), et sa facture naît réglée.
--
-- Le chemin existait (`acces_changer_offre` ouvre la montée sur-le-champ, sans paiement ;
-- `emission_du_cabinet` émet une facture par cabinet et par mois). Trois défauts le rendaient
-- illisible ou muet :
--
--   1. Les lignes : UNE par licence, portant la DERNIÈRE offre du mois et la somme des jours
--      (« Abonnement SOLO — 30/30 jours » pour 10 jours de Basic et 20 de Solo). Désormais une
--      ligne par société ET par offre, avec ses dates ; le jour d'un passage, la ligne le dit
--      (« Passage Basic → Solo — Société — du 11/11/2026 au 30/11/2026 (20/30 jours) »). Les
--      montants ne changent pas de règle : jours × part ÷ jours du mois, arrondis par ligne.
--      Aucun trou ni doublon : les îlots partitionnent exactement les segments d'avant, et
--      la reprise après une période payée d'avance par le titulaire reste bornée par sa
--      facture (`couvre_au` exclu).
--   2. Le nom de l'offre (« Solo ») au lieu de son code (« solo »).
--   3. Le courriel : la facture du mois ne partait qu'en application, au genre générique
--      `facture.emise`, vers tous les membres du cabinet. Elle part maintenant au genre
--      `facture.emise.cabinet` (gabarit courriel livré le 23 octobre, enfin diffusé), vers
--      ses EXPERTS seulement — la facture n'est pas l'affaire des collaborateurs.
--
-- Et la PME : une facture entièrement réglée se dit réglée (`facture.reglee.pme`), y compris
-- quand la tour la renvoie — le renvoi d'une facture payée disait « à régler avant le … ».
--
-- REJEU (R11) : gabarits, cartes et libellés datés en littéral ; fonctions reprises de leur
-- définition EN VIGUEUR.
-- _Gardé par_ apps/api/src/facturation/la-comptabilite-recoit-une-seule-facture.test.ts.

begin;

-- ---------------------------------------------------------------- 1. Les lignes du mois
drop function facturation.a_facturer_cabinet(uuid, date);
drop function facturation.lignes_a_facturer_cabinet(uuid, date);

create function facturation.lignes_a_facturer_cabinet(p_cabinet uuid, p_periode date)
returns table(licence_id uuid, tenant_id uuid, organisation text, reference text, offre_code text,
              jours integer, jours_du_mois integer, montant_ht app.money_t,
              du date, au_exclu date, offre_avant text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with mois as (
    select p_periode                                     as du,
           (p_periode + interval '1 month')::date         as au_exclu,
           ((p_periode + interval '1 month')::date - p_periode)::int as jours
  ),
  segments as (
    select pv.licence_id                         as licence_id,
           a.tenant_id                           as tenant_id,
           pv.acces_reference                    as reference,
           pv.part_offre_code                    as part_offre_code,
           pv.part_ht                            as part_ht,
           m.jours                               as jours_du_mois,
           greatest(pv.du, m.du, coalesce(t.paye_jusqu_au, m.du)) as seg_du,
           least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu) as seg_au_exclu
      from facturation.payeurs_v pv
      join facturation.acces a on a.id = pv.acces_id
      cross join mois m
      left join lateral (
        select max(f.couvre_au) as paye_jusqu_au
          from facturation.factures f
         where f.licence_id = pv.licence_id and f.payeur_type = 'titulaire'
           and f.inclut_la_base and f.avoir_de is null and f.statut <> 'annulee'
           and f.couvre_du < least(coalesce(pv.au_exclu, m.au_exclu), m.au_exclu)
      ) t on true
     where pv.payeur_type = 'cabinet'
       and pv.payeur_tenant_id = p_cabinet
       and pv.du < m.au_exclu
       and (pv.au_exclu is null or pv.au_exclu > m.du)
  ),
  -- Un îlot : des segments qui se suivent sans jour d'écart, à la même offre et au même prix.
  marques as (
    select s.*,
           case when lag(s.seg_au_exclu) over w = s.seg_du
                 and lag(s.part_offre_code) over w = s.part_offre_code
                 and lag(s.part_ht) over w = s.part_ht
                then 0 else 1 end as nouveau
      from segments s
     where s.seg_du < s.seg_au_exclu
    window w as (partition by s.licence_id, s.tenant_id order by s.seg_du)
  ),
  ilots as (
    select x.*, sum(x.nouveau) over (partition by x.licence_id, x.tenant_id order by x.seg_du) as ilot
      from marques x
  ),
  lignes as (
    select i.licence_id, i.tenant_id, i.ilot,
           (array_agg(i.reference order by i.seg_du desc))[1] as reference,
           min(i.part_offre_code)                             as offre,
           min(i.seg_du)                                      as du,
           max(i.seg_au_exclu)                                as au_exclu,
           sum(i.seg_au_exclu - i.seg_du)::int                as jours,
           max(i.jours_du_mois)::int                          as jours_du_mois,
           round(sum(i.part_ht * (i.seg_au_exclu - i.seg_du) / i.jours_du_mois), 3) as ht
      from ilots i
     group by i.licence_id, i.tenant_id, i.ilot
  )
  select l.licence_id, l.tenant_id, o.name, l.reference, l.offre, l.jours, l.jours_du_mois,
         l.ht::app.money_t, l.du, l.au_exclu,
         -- Le passage : l'îlot d'avant, collé à celui-ci, portait une autre offre.
         case when lag(l.au_exclu) over w = l.du and lag(l.offre) over w <> l.offre
              then lag(l.offre) over w end
    from lignes l
    join identity.organizations o on o.id = l.tenant_id
  window w as (partition by l.licence_id, l.tenant_id order by l.du);
end
$$;
revoke all on function facturation.lignes_a_facturer_cabinet(uuid, date) from public, anon, authenticated;
comment on function facturation.lignes_a_facturer_cabinet(uuid, date) is
  'Les lignes de la facture du mois d''une comptabilité : une par société et par offre, avec ses '
  'dates (du, au exclu) et l''offre d''avant quand la ligne est un passage. 20261231280000.';

create function facturation.a_facturer_cabinet(p_cabinet uuid, p_periode date)
returns table(licence_id uuid, tenant_id uuid, organisation text, reference text, offre_code text,
              jours integer, jours_du_mois integer, montant_ht app.money_t,
              du date, au_exclu date, offre_avant text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_platform() or p_cabinet in (select app.member_orgs())) then
    raise exception 'refus.geste.non_permis' using errcode = '42501';
  end if;
  return query select * from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode);
end
$$;
revoke all on function facturation.a_facturer_cabinet(uuid, date) from public, anon;
grant execute on function facturation.a_facturer_cabinet(uuid, date) to authenticated;

-- ---------------------------------------------------------------- 2. La facture du mois
CREATE OR REPLACE FUNCTION facturation.emission_du_cabinet(p_cabinet uuid, p_periode date, p_acteur uuid, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_ht       app.money_t;
  v_tva      app.money_t;
  v_nb       integer;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  l          record;
  v_ordinal  smallint := 0;
begin
  if extract(day from p_periode) <> 1 then
    raise exception 'refus.facturation.premier_du_mois' using errcode = 'check_violation';
  end if;
  if exists (select 1 from facturation.factures f
              where f.payeur_tenant_id = p_cabinet and f.periode = p_periode
                and f.licence_id is null and f.avoir_de is null) then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.deja_emise', 'periode', (p_periode)::text)
      using errcode = 'unique_violation';
  end if;

  select o.name, o.legal_id into v_nom, v_legal
    from identity.organizations o where o.id = p_cabinet and o.kind = 'cabinet';
  if v_nom is null then
    raise exception 'refus.introuvable.cabinet' using errcode = 'no_data_found';
  end if;

  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;
  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack and r.code = 'TVA19'
     and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;
  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;
  if v_taux is null or v_timbre is null then
    raise exception 'refus.referentiel.manquant' using errcode = 'no_data_found';
  end if;

  -- `v_nb` : les abonnements facturés (la colonne `organisations`), pas les lignes de passage.
  select coalesce(sum(a.montant_ht), 0), count(distinct (a.licence_id, a.tenant_id)) into v_ht, v_nb
    from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
   where a.montant_ht > 0;
  if v_nb = 0 then
    raise exception '%', app.refus_avec_valeurs('refus.facturation.rien_a_facturer', 'periode', (p_periode)::text) using errcode = 'no_data_found';
  end if;

  v_tva    := round(v_ht * v_taux, 3);
  v_numero := facturation.numero_de_facture(current_date);

  insert into facturation.factures
    (licence_id, numero, periode, emise_le, echeance_le, offre_code, organisations, sieges_payants,
     montant_ht, taux_tva, montant_tva, timbre, montant_ttc, devise,
     payeur_type, payeur_tenant_id, payeur_personne, destinataire_nom, destinataire_legal_id)
  values
    (null, v_numero, p_periode, current_date, current_date + p_jours_echeance, null, v_nb, 0,
     v_ht, v_taux, v_tva, v_timbre, v_ht + v_tva + v_timbre, v_emetteur.currency,
     'cabinet', p_cabinet, null, v_nom, v_legal)
  returning id into v_id;

  -- Une ligne par société ET par offre : un passage (Basic → Solo) se lit sur la facture, avec
  -- ses dates, au lieu d'une seule ligne qui portait la dernière offre et la somme des jours.
  for l in
    select * from facturation.lignes_a_facturer_cabinet(p_cabinet, p_periode) a
     where a.montant_ht > 0 order by a.organisation, a.licence_id, a.du
  loop
    v_ordinal := v_ordinal + 1;
    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht, licence_id, tenant_id)
    values (v_id, v_ordinal,
            case when l.offre_avant is not null
                 then 'Passage ' || coalesce((ref.offre_a(l.offre_avant, l.du)).libelle, l.offre_avant)
                      || ' → ' || coalesce((ref.offre_a(l.offre_code, l.du)).libelle, l.offre_code)
                 else 'Abonnement ' || coalesce((ref.offre_a(l.offre_code, l.du)).libelle, l.offre_code)
            end
              || ' — ' || l.organisation
              || coalesce(' (' || l.reference || ')', '')
              || ' — du ' || to_char(l.du, 'DD/MM/YYYY') || ' au ' || to_char(l.au_exclu - 1, 'DD/MM/YYYY')
              || case when l.jours <> l.jours_du_mois
                      then ' (' || l.jours || '/' || l.jours_du_mois || ' jours)' else '' end,
            1, l.montant_ht, l.montant_ht, l.licence_id, l.tenant_id);
  end loop;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (p_cabinet, p_acteur, 'facture.emise', 'facturation', 'factures', v_id,
          jsonb_build_object('numero', v_numero, 'periode', p_periode, 'lignes', v_nb,
                             'ttc', v_ht + v_tva + v_timbre));
  -- Ses experts la reçoivent, en application et par courriel (`facturation.avertir_de_la_facture`).
  perform facturation.avertir_de_la_facture(v_id);

  return jsonb_build_object('facture_id', v_id, 'numero', v_numero, 'lignes', v_nb,
                            'ht', v_ht, 'ttc', v_ht + v_tva + v_timbre);
end
$function$

;
revoke all on function facturation.emission_du_cabinet(uuid, date, uuid, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. Qui la reçoit, et comment
insert into notif.gabarits
  (code, canal, locale, sujet, titre, corps, action_libelle, action_route, effective_from, ton)
values
  ('facture.emise.cabinet', 'app', 'fr', null,
   'Facture du mois {{numero}}',
   '{{ttc}} {{devise}} TTC — {{abonnements}} abonnement(s) de vos clients, {{periode}}.',
   null, null, date '2026-11-24', 'neutre'),
  ('facture.emise.cabinet', 'app', 'en', null,
   'Monthly invoice {{numero}}',
   '{{ttc}} {{devise}} incl. VAT — {{abonnements}} client subscription(s), {{periode}}.',
   null, null, date '2026-11-24', 'neutre'),
  ('facture.emise.cabinet', 'app', 'ar', null,
   'فاتورة الشهر {{numero}}',
   '{{ttc}} {{devise}} شامل الأداء — {{abonnements}} اشتراك(ات) لحرفائكم، {{periode}}.',
   null, null, date '2026-11-24', 'neutre'),
  ('facture.emise.cabinet', 'email', 'fr', 'Malica Office — facture {{numero}}',
   'Votre facture du mois {{numero}}',
   'Les abonnements de vos clients pour {{periode}}, et chaque passage d''offre du mois, sur une '
   'seule facture : {{abonnements}} abonnement(s), {{ttc}} {{devise}} TTC, à régler avant le '
   '{{echeance}}. Réglez-la par virement (coordonnées bancaires sur la facture) ou en ligne.',
   'Voir la facture', '/cabinet/clients?vue=facturation', date '2026-11-24', 'neutre'),
  ('facture.emise.cabinet', 'email', 'en', 'Malica Office — invoice {{numero}}',
   'Your monthly invoice {{numero}}',
   'Your clients'' subscriptions for {{periode}}, and every plan change of the month, on a '
   'single invoice: {{abonnements}} subscription(s), {{ttc}} {{devise}} incl. VAT, due by '
   '{{echeance}}. Pay it by bank transfer (bank details on the invoice) or online.',
   'View the invoice', '/cabinet/clients?vue=facturation', date '2026-11-24', 'neutre'),
  ('facture.emise.cabinet', 'email', 'ar', 'Malica Office — الفاتورة {{numero}}',
   'فاتورتكم الشهرية {{numero}}',
   'اشتراكات حرفائكم عن {{periode}}، وكل تغيير للعرض خلال الشهر، في فاتورة واحدة: '
   '{{abonnements}} اشتراك(ات)، {{ttc}} {{devise}} شامل الأداء، تُدفع قبل {{echeance}}. '
   'ادفعوها بتحويل بنكي (البيانات البنكية على الفاتورة) أو عبر الإنترنت.',
   'عرض الفاتورة', '/cabinet/clients?vue=facturation', date '2026-11-24', 'neutre');

insert into notif.diffusions (code, canal, gabarit, valid_from) values
  ('facture.emise.cabinet', 'email', 'facture.emise.cabinet', date '2026-11-24');

insert into notif.cartes_courriel (code, rang, genre, libelle_cle, valeur_cle) values
  ('facture.emise.cabinet', 1, 'montant', 'unite.factureTtc', 'valeur.ttc'),
  ('facture.emise.cabinet', 2, 'ligne',   'donnee.facture',   'valeur.numero'),
  ('facture.emise.cabinet', 3, 'ligne',   'donnee.abonnements', 'valeur.abonnements'),
  ('facture.emise.cabinet', 4, 'ligne',   'donnee.echeance',  'valeur.echeanceLongue');

insert into notif.libelles_courriel (cle, locale, texte, effective_from) values
  ('apercu.facture.emise.cabinet', 'fr',
   '{{ttc}} {{devise}} TTC pour {{abonnements}} abonnement(s), à régler avant le {{echeance_longue}}.',
   date '2026-11-24'),
  ('apercu.facture.emise.cabinet', 'en',
   '{{ttc}} {{devise}} incl. VAT for {{abonnements}} subscription(s), due by {{echeance_longue}}.',
   date '2026-11-24'),
  ('apercu.facture.emise.cabinet', 'ar',
   '{{ttc}} {{devise}} شامل الأداء مقابل {{abonnements}} اشتراك(ات)، تُدفع قبل {{echeance_longue}}.',
   date '2026-11-24'),
  ('raison.facture.emise.cabinet', 'fr',
   'Vous recevez ce message parce que vous êtes expert-comptable de ce cabinet sur Malica Office.',
   date '2026-11-24'),
  ('raison.facture.emise.cabinet', 'en',
   'You are receiving this message because you are a chartered accountant of this firm on Malica Office.',
   date '2026-11-24'),
  ('raison.facture.emise.cabinet', 'ar',
   'تصلكم هذه الرسالة لأنكم خبير محاسب في هذا المكتب على Malica Office.',
   date '2026-11-24'),
  ('donnee.abonnements', 'fr', 'Abonnements', date '2026-11-24'),
  ('donnee.abonnements', 'en', 'Subscriptions', date '2026-11-24'),
  ('donnee.abonnements', 'ar', 'الاشتراكات', date '2026-11-24'),
  ('valeur.abonnements', 'fr', '{{abonnements}}', date '2026-11-24'),
  ('valeur.abonnements', 'en', '{{abonnements}}', date '2026-11-24'),
  ('valeur.abonnements', 'ar', '{{abonnements}}', date '2026-11-24')
on conflict do nothing;

CREATE OR REPLACE FUNCTION facturation.avertir_de_la_facture(p_facture uuid, p_fenetre interval DEFAULT '24:00:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  f          facturation.factures;
  v_tenant   uuid;
  v_exposant smallint;
  v_ttc      text;
  v_reglee   boolean;
  v_expert   uuid;
  v_n        integer := 0;
begin
  select x.* into f from facturation.factures x where x.id = p_facture;
  if f.id is null or f.payeur_type not in ('titulaire', 'cabinet') then
    return 0;
  end if;
  select d.exposant into v_exposant from ref.devises d where d.code = f.devise;
  v_ttc := to_char(f.montant_ttc, 'FM999G999G990'
                     || case when coalesce(v_exposant, 0) > 0
                             then 'D' || repeat('0', v_exposant) else '' end);

  -- La facture du mois d'une comptabilité : à chacun de ses experts, en application et par
  -- courriel. Une ligne par société et par offre ; on dit combien d'abonnements elle porte.
  if f.payeur_type = 'cabinet' then
    for v_expert in
      select m.user_id from identity.memberships m
       where m.tenant_id = f.payeur_tenant_id and m.role = 'expert'
       order by m.created_at
    loop
      v_n := v_n + notif.emettre(
        f.payeur_tenant_id,
        'facture.emise.cabinet',
        jsonb_build_object(
          'facture_id',  f.id,
          'numero',      f.numero,
          'periode',     to_char(f.periode, 'MM/YYYY'),
          'abonnements', f.organisations::text,
          'ttc',         v_ttc,
          'devise',      f.devise,
          'echeance',    to_char(f.echeance_le, 'DD/MM/YYYY')),
        v_expert,
        'facture:' || f.id::text,
        p_fenetre);
    end loop;
    return v_n;
  end if;

  select lo.tenant_id into v_tenant
    from facturation.licence_organisations lo
   where lo.licence_id = f.licence_id
   order by lo.tenant_id limit 1;

  -- Réglée : payée d'abord (une montée, 20261231240000 : la facture naît réglée par le paiement
  -- qui l'a fait émettre), ou déjà entièrement encaissée (un renvoi). Elle le dit, au lieu de
  -- « à régler avant ».
  v_reglee := (coalesce(current_setting('malica.paye_d_abord_le', true), '') = f.emise_le::text
               and f.couvre_du <= f.emise_le and f.couvre_au > f.emise_le)
              or exists (select 1 from facturation.encours_v e
                          where e.facture_id = f.id and e.etat = 'payee');

  -- Les jetons de ses gabarits (app et courriel, fr/en/ar) : tous, et rien d'autre.
  return notif.emettre(
    v_tenant,
    case when v_reglee then 'facture.reglee.pme' else 'facture.emise.pme' end,
    jsonb_build_object(
      'facture_id', f.id,
      'numero',     f.numero,
      'offre',      coalesce((ref.offre_a(f.offre_code, f.couvre_du)).libelle, f.offre_code),
      'periode',    to_char(f.periode, 'MM/YYYY'),
      'du',         to_char(f.couvre_du, 'DD/MM/YYYY'),
      'au',         to_char(f.couvre_au - 1, 'DD/MM/YYYY'),
      'ttc',        v_ttc,
      'devise',     f.devise,
      'echeance',   to_char(f.echeance_le, 'DD/MM/YYYY')),
    f.payeur_personne,
    'facture:' || f.id::text,
    p_fenetre);
end
$function$;
revoke all on function facturation.avertir_de_la_facture(uuid, interval) from public, anon, authenticated;

-- Le renvoi d'une facture réglée part au genre « réglée » : le doublon se cherche sous les deux.
CREATE OR REPLACE FUNCTION plateforme.facture_renvoyer(p_facture uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- La fenêtre du doublon : celle du moteur (`notif.poster`), dite une fois ici.
  v_fenetre interval := interval '24 hours';
  f         record;
  v_cle     text := 'facture:' || p_facture::text;
  v_avant   uuid[];
  v_envoi   record;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  p_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if p_motif is null then
    raise exception 'refus.motif.a_dire' using errcode = 'check_violation';
  end if;
  select x.id, x.numero, x.payeur_type, x.payeur_personne, x.licence_id into f
    from facturation.factures x where x.id = p_facture;
  if f.id is null then
    raise exception 'refus.introuvable.facture' using errcode = 'no_data_found';
  end if;
  if f.payeur_type <> 'titulaire' then
    raise exception 'refus.facturation.renvoi_pme_seulement' using errcode = 'check_violation';
  end if;

  -- Déjà décidé dans la fenêtre (parti, ou en attente du travailleur) : rien de plus.
  if exists (select 1 from notif.envois_v e
              where e.destinataire = f.payeur_personne and e.code in ('facture.emise.pme', 'facture.reglee.pme')
                and e.canal = 'email' and e.sujet_cle = v_cle
                and e.decision = 'a_remettre' and e.etat <> 'refuse'
                and e.cree_le > now() - v_fenetre) then
    return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', true);
  end if;

  -- Les envois d'avant : celui que ce renvoi pose est le seul qui n'y est pas (dans une même
  -- transaction, `cree_le` ne les départage pas).
  select coalesce(array_agg(e.id), '{}') into v_avant
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code in ('facture.emise.pme', 'facture.reglee.pme')
     and e.canal = 'email' and e.sujet_cle = v_cle;

  perform facturation.avertir_de_la_facture(f.id, v_fenetre);

  select e.decision, e.motif_abandon into v_envoi
    from notif.envois e
   where e.destinataire = f.payeur_personne and e.code in ('facture.emise.pme', 'facture.reglee.pme')
     and e.canal = 'email' and e.sujet_cle = v_cle
     and e.id <> all (v_avant)
   limit 1;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id,
                               payload)
  select lo.tenant_id, auth.uid(), 'facture.renvoyee', 'facturation', 'factures', f.id,
         jsonb_build_object('numero', f.numero, 'motif', p_motif,
                            'decision', v_envoi.decision, 'abandon', v_envoi.motif_abandon)
    from facturation.licence_organisations lo
   where lo.licence_id = f.licence_id
   order by lo.tenant_id limit 1;

  return jsonb_build_object('facture_id', f.id, 'numero', f.numero, 'deja', false,
                            'poste', coalesce(v_envoi.decision = 'a_remettre', false),
                            'abandon', v_envoi.motif_abandon);
end
$function$

;

commit;
