-- ======================================================================
--  Un jour ne se paie pas deux fois, et une descente n'efface pas une montée
--  (recette du 11 novembre 2026, points 1.1 et 1.4).
--
--  LES DEUX DÉFAUTS.
--  1.1  La comptabilité couvre Team ; le dirigeant monte en Premium et règle
--       l'écart jusqu'à la fin de sa période ; le même jour la comptabilité
--       monte à son tour en Premium : elle était facturée Premium dès ce
--       jour-là, et rien ne revenait au dirigeant. Les mêmes jours étaient
--       payés deux fois. Pareil quand une PME qui a payé sa montée accepte la
--       prise en charge (`acces_repondre`).
--  1.4  Solo → Premium, puis Premium → Team avant d'avoir réglé : la somme à
--       régler disparaissait (l'acompte devenait « remplacé », 20261117110000)
--       et la facture du mois ne comptait plus que les jours — zéro, le même
--       jour — passés en Premium.
--
--  LA RÈGLE, une seule pour les deux : CE QUE LA PME A ENGAGÉ D'AVANCE RESTE
--  À ELLE JUSQU'À SON ÉCHÉANCE. L'échéance est la fin de la période déjà
--  facturée d'avance (périmètre « PME » ouvert, 20261128090000), sinon le
--  premier jour du mois suivant (périmètre coupé : la montée du mois se règle
--  par un acompte qui court jusqu'à la fin du mois).
--
--   a. LA FRANCHISE (1.1). Quand la comptabilité prend en charge une offre,
--      ou monte la sienne, par-dessus des jours que la PME a déjà engagés,
--      elle n'est facturée de cette tranche qu'À PARTIR DE L'ÉCHÉANCE de la
--      PME. L'accès porte ce qu'elle ne paie pas d'ici là (`franchise_ht`,
--      `franchise_jusqu_au`) : le montant est figé le jour du geste, il ne se
--      recalcule pas. Aucun avoir, aucun remboursement : la PME garde ce
--      qu'elle a payé, la comptabilité prend la suite, sans jour en double
--      ni trou.
--   b. LA GARDE (1.4). Quand une descente ferme une montée que la PME a
--      engagée dans la période en cours, l'offre montée reste DUE jusqu'à
--      l'échéance : la ligne de la descente dit quelle offre est gardée, et
--      jusqu'à quand (`garde_forfait_id`, `garde_jusqu_au`). Les droits, eux,
--      suivent la descente le jour même (comme à la date anniversaire,
--      20261128090000 point E). Une remontée dans la même période ne
--      refacture rien : son écart se mesure au-dessus de l'offre gardée.
--   c. L'ÉCART D'UNE MONTÉE se fige à sa naissance (`ecart_titulaire_ht`) :
--      ce que la PME paie en plus par mois, au-dessus de l'offre d'avant, de
--      l'offre gardée et de ce que la comptabilité paie ce jour-là. Zéro
--      quand c'est la comptabilité qui paie la montée. L'acompte se calcule
--      sur lui, et plus sur une soustraction refaite à chaque lecture.
--
--  CE QUI NE CHANGE PAS. Une montée remplacée par une montée plus haute ne
--  se paie plus (décision du 2 novembre, 20261117110000). La comptabilité
--  reste facturée au mois, à terme échu, au prorata de ses jours. Une
--  descente sans montée engagée dans la période reste au prorata des jours
--  (périmètre coupé) ou à l'échéance (périmètre ouvert). L'état des
--  périmètres n'est pas touché.
--
--  REJEU (R11) : colonnes neuves sans défaut daté ; aucune donnée de
--  référence écrite. Les lignes d'avant gardent leurs colonnes vides : une
--  montée d'avant se lit comme avant (l'écart de son offre à la précédente).
-- ======================================================================

-- ------------------------------------------------------------- 1. Ce que les lignes portent

alter table facturation.acces
  add column franchise_ht        app.money_t,
  add column franchise_jusqu_au  date,
  add constraint acces_franchise_coherente check (
    (franchise_ht is null) = (franchise_jusqu_au is null)
    and (franchise_ht is null or franchise_ht > 0)
    and (franchise_jusqu_au is null or (effet_du is not null and franchise_jusqu_au > effet_du)));

comment on column facturation.acces.franchise_ht is
  'Le tarif mensuel HT que la comptabilité ne paie pas jusqu''à `franchise_jusqu_au` : la PME '
  'l''avait déjà engagé d''avance le jour où cet accès a commencé. Figé ce jour-là.';
comment on column facturation.acces.franchise_jusqu_au is
  'L''échéance de la PME (exclue) : à partir de ce jour, la comptabilité paie son offre entière.';

alter table facturation.forfait_historique
  add column rang               bigint generated always as identity,
  add column ecart_titulaire_ht app.money_t,
  add column garde_forfait_id   uuid references facturation.forfait_historique(id),
  add column garde_jusqu_au     date,
  add constraint forfait_historique_garde_coherente check (
    (garde_forfait_id is null) = (garde_jusqu_au is null)
    and (garde_jusqu_au is null or garde_jusqu_au > effet_du)
    and (ecart_titulaire_ht is null or ecart_titulaire_ht >= 0));

create index forfait_historique_garde_fk_idx
  on facturation.forfait_historique (garde_forfait_id) where garde_forfait_id is not null;

comment on column facturation.forfait_historique.rang is
  'L''ordre de naissance des lignes. Deux changements le même jour ont la même date, et parfois '
  'le même instant : le rang dit lequel a fermé l''autre.';
comment on column facturation.forfait_historique.ecart_titulaire_ht is
  'Pour une montée : ce que le titulaire paie en plus par mois (HT), figé à sa naissance. Zéro '
  'quand la comptabilité paie la montée. Vide pour une ligne d''avant le 14 décembre 2026.';
comment on column facturation.forfait_historique.garde_forfait_id is
  'La montée que cette ligne a fermée et qui reste due : son offre se facture jusqu''à '
  '`garde_jusqu_au`, à la place de celle-ci.';
comment on column facturation.forfait_historique.garde_jusqu_au is
  'L''échéance (exclue) jusqu''à laquelle l''offre gardée reste due.';

-- ------------------------------------------------------------- 2. La période que la PME a payée d'avance

/*
 * Ce que les factures d'avance du titulaire couvrent le jour `p_jour` : la
 * somme de leurs tarifs mensuels et le lendemain du dernier jour couvert.
 * Vide (deux `null`) quand aucune ne couvre ce jour — une PME encore au mois.
 */
create function facturation.periode_payee_d_avance(
  p_licence uuid, p_jour date, out tarif_ht numeric, out fin date)
language sql
stable
security definer
set search_path = ''
as $$
  select sum(f.part_mensuelle_ht), max(f.couvre_au)
    from facturation.factures f
    join facturation.licences l on l.id = f.licence_id
   where f.licence_id = p_licence and f.payeur_type = 'titulaire'
     and f.payeur_personne = l.titulaire and f.ancre is not null
     and f.avoir_de is null and f.statut <> 'annulee'
     and f.couvre_du <= p_jour and f.couvre_au > p_jour
$$;

revoke all on function facturation.periode_payee_d_avance(uuid, date) from public, anon, authenticated;

/*
 * L'échéance qui suit `p_jour` pour le titulaire : la fin de sa période payée
 * d'avance, sinon le premier jour du mois suivant.
 */
create function facturation.echeance_suivante(p_licence uuid, p_jour date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((facturation.periode_payee_d_avance(p_licence, p_jour)).fin,
                  (date_trunc('month', p_jour) + interval '1 month')::date)
$$;

revoke all on function facturation.echeance_suivante(uuid, date) from public, anon, authenticated;

-- ------------------------------------------------------------- 3. Une ligne de forfait dit son écart et ce qu'elle garde

/*
 * À la naissance d'une ligne (toutes les portes passent ici : `forfait_changer`,
 * `forfait_poser`). La ligne d'avant vient d'être fermée ce jour-là.
 *
 *   - MONTÉE : l'écart que le titulaire engage. Ce que la comptabilité paie ce
 *     jour-là se lit à son prix ENTIER (une franchise n'est pas un prix) : une
 *     montée que la comptabilité paie vaut zéro pour le titulaire.
 *   - GARDE : l'offre gardée par la ligne d'avant se transmet tant qu'elle
 *     n'est pas dépassée ; sinon, une descente qui ferme une montée engagée
 *     dans la période en cours la garde jusqu'à l'échéance.
 */
create function facturation.forfait_dit_ce_qui_reste_du()
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
  v_cabinet  numeric;
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
    select sum(o.prix_mensuel_ht) into v_cabinet
      from facturation.acces a
      cross join lateral ref.offre_a(a.offre_code, a.offre_depuis) o
     where a.licence_id = new.licence_id and a.canal = 'cabinet'
       and a.effet_du is not null and a.effet_du <= new.effet_du
       and (a.effet_au is null or a.effet_au > new.effet_du);
    new.ecart_titulaire_ht :=
      greatest(0, v_prix - greatest(v_prix_av, coalesce(v_prix_g, 0), coalesce(v_cabinet, 0)));
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

revoke all on function facturation.forfait_dit_ce_qui_reste_du() from public, anon, authenticated;

create trigger forfait_historique_dit_ce_qui_reste_du
  before insert on facturation.forfait_historique
  for each row execute function facturation.forfait_dit_ce_qui_reste_du();

-- ------------------------------------------------------------- 4. Le découpage du temps lit la garde et la franchise

/*
 * Repris de 20261020110000. Trois changements, et rien d'autre :
 *   - deux bornes de plus (la fin d'une garde, la fin d'une franchise) ;
 *   - l'offre d'un segment est l'offre GARDÉE tant que la garde court ;
 *   - la base de la comptabilité est son prix moins sa franchise tant qu'elle court.
 * Mêmes colonnes, même ordre.
 */
create or replace view facturation.periodes_v with (security_invoker = true) as
with bornes as (
  select h.licence_id, h.effet_du as jour
    from facturation.forfait_historique h
  union
  select h.licence_id, h.effet_au
    from facturation.forfait_historique h where h.effet_au is not null
  union
  select h.licence_id, h.garde_jusqu_au
    from facturation.forfait_historique h where h.garde_jusqu_au is not null
  union
  select a.licence_id, a.effet_du
    from facturation.acces a where a.licence_id is not null and a.effet_du is not null
  union
  select a.licence_id, a.effet_au
    from facturation.acces a where a.licence_id is not null and a.effet_au is not null
  union
  select a.licence_id, a.franchise_jusqu_au
    from facturation.acces a where a.licence_id is not null and a.franchise_jusqu_au is not null
),
segments as (
  select b.licence_id, b.jour as du,
         lead(b.jour) over (partition by b.licence_id order by b.jour) as au_exclu
    from bornes b
)
select
  s.licence_id,
  s.du,
  s.au_exclu,
  (s.au_exclu - 1)          as au,
  l.titulaire,
  l.origine,
  l.origine_cabinet,
  h.id                      as forfait_id,
  coalesce(g.offre_code, h.offre_code)     as offre_code,
  coalesce(g.offre_depuis, h.offre_depuis) as offre_depuis,
  h.canal,
  h.motif                   as forfait_motif,
  o.libelle                 as offre_libelle,
  o.rang                    as offre_rang,
  p.organisations,
  p.sieges_occupes,
  o.prix_mensuel_ht         as prix_offre_ht,
  t.prix_total_ht,
  ca.acces_id,
  ca.acces_reference,
  ca.reference_vivante,
  ca.cabinet_tenant_id,
  ca.acces_offre_code,
  ca.plancher_rang,
  ca.plancher_offre_code,
  least(coalesce(ca.base_cabinet, 0), t.prix_total_ht)::app.money_t   as part_cabinet_ht,
  (t.prix_total_ht - least(coalesce(ca.base_cabinet, 0), t.prix_total_ht))::app.money_t
                            as part_pme_ht,
  (coalesce(ca.vivants, 0) > 0 or l.titulaire is not null) as facturable
from segments s
join facturation.licences l                   on l.id = s.licence_id
join facturation.forfait_historique h
     on h.licence_id = s.licence_id
    and h.effet_du <= s.du
    and (h.effet_au is null or h.effet_au > s.du)
left join facturation.forfait_historique g
     on g.id = h.garde_forfait_id and h.garde_jusqu_au > s.du
cross join lateral ref.offre_a(coalesce(g.offre_code, h.offre_code),
                               coalesce(g.offre_depuis, h.offre_depuis)) o
join facturation.places_v p                   on p.licence_id = s.licence_id
cross join lateral (
  select (o.prix_mensuel_ht
          + o.prix_siege_sup * greatest(0, p.sieges_occupes - o.sieges_inclus)
          + o.prix_organisation_sup
            * greatest(0, p.organisations - o.organisations_incluses))::app.money_t
         as prix_total_ht) t
left join lateral (
  select
    count(*)                                                      as vivants,
    sum(oa.prix_mensuel_ht
        - case when a.franchise_jusqu_au > s.du then a.franchise_ht else 0 end)
      filter (where a.canal = 'cabinet')                           as base_cabinet,
    max(oa.rang)            filter (where a.canal = 'cabinet')     as plancher_rang,
    (array_agg(a.offre_code        order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as plancher_offre_code,
    (array_agg(a.offre_code        order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as acces_offre_code,
    (array_agg(a.cabinet_tenant_id order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as cabinet_tenant_id,
    (array_agg(a.id                order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as acces_id,
    (array_agg(a.reference         order by oa.rang desc)
       filter (where a.canal = 'cabinet'))[1]                      as acces_reference,
    (array_agg(a.reference         order by oa.rang desc))[1]      as reference_vivante
  from facturation.acces a
  cross join lateral ref.offre_a(a.offre_code, a.offre_depuis) oa
  where a.licence_id = s.licence_id
    and a.effet_du is not null
    and a.effet_du <= s.du
    and (a.effet_au is null or a.effet_au > s.du)
) ca on true
where s.au_exclu is null or s.au_exclu > s.du;

-- ------------------------------------------------------------- 5. La franchise d'une reprise

/*
 * Ce que la comptabilité ne paie pas, et jusqu'à quand, quand sa base passe
 * de `p_base_avant` à `p_base_apres` le jour `p_jour` : la part de cette
 * hausse que le titulaire a DÉJÀ engagée d'avance.
 *
 *   dû      : le prix de l'offre due ce jour-là (l'offre gardée, si une garde court) ;
 *   engagé  : ce que le titulaire a engagé d'avance — ses factures d'avance qui
 *             couvrent le jour, sinon (périmètre « PME » coupé) l'écart de sa
 *             montée du mois, courante ou gardée ;
 *   la tranche du titulaire est ]dû − engagé, dû] ; celle que la comptabilité
 *   ajoute est ]avant, après]. La franchise est leur recouvrement.
 *
 * Deux `null` quand rien ne se recouvre.
 */
create function facturation.franchise_de_reprise(
  p_licence uuid, p_base_avant numeric, p_base_apres numeric, p_jour date,
  out franchise_ht numeric, out jusqu_au date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_du      numeric;
  v_engage  numeric;
  v_fin     date;
begin
  select o.prix_mensuel_ht into v_du
    from facturation.forfait_historique h
    left join facturation.forfait_historique g
           on g.id = h.garde_forfait_id and h.garde_jusqu_au > p_jour
    cross join lateral ref.offre_a(coalesce(g.offre_code, h.offre_code),
                                   coalesce(g.offre_depuis, h.offre_depuis)) o
   where h.licence_id = p_licence and h.effet_au is null;

  select pa.tarif_ht, pa.fin into v_engage, v_fin
    from facturation.periode_payee_d_avance(p_licence, p_jour) pa;

  if v_fin is null and not plateforme.facturation_auto_ouverte('pme') then
    v_fin := (date_trunc('month', p_jour) + interval '1 month')::date;
    select coalesce(case when h.motif = 'montee'
                              and h.effet_du >= date_trunc('month', p_jour)::date
                         then h.ecart_titulaire_ht end, 0)
           + coalesce(case when h.garde_jusqu_au > p_jour then g.ecart_titulaire_ht end, 0)
      into v_engage
      from facturation.forfait_historique h
      left join facturation.forfait_historique g on g.id = h.garde_forfait_id
     where h.licence_id = p_licence and h.effet_au is null;
  end if;

  franchise_ht := least(p_base_apres, v_du)
                  - greatest(p_base_avant, v_du - coalesce(v_engage, 0));
  if v_fin is null or v_fin <= p_jour or franchise_ht is null or franchise_ht <= 0 then
    franchise_ht := null;
    jusqu_au := null;
  else
    jusqu_au := v_fin;
  end if;
end
$$;

revoke all on function facturation.franchise_de_reprise(uuid, numeric, numeric, date)
  from public, anon, authenticated;

-- Une franchise se fige avec l'activation de l'accès. Repris de sa définition
-- en vigueur ; seule la dernière condition est neuve.
create or replace function facturation.acces_fige()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.canal is distinct from old.canal
     or new.cabinet_tenant_id is distinct from old.cabinet_tenant_id
     or new.offre_code is distinct from old.offre_code
     or new.offre_depuis is distinct from old.offre_depuis
     or new.propose_le is distinct from old.propose_le
     or new.propose_par is distinct from old.propose_par
     or new.episode is distinct from old.episode
     or new.reference is distinct from old.reference
  then
    raise exception 'refus.acces.fige'
      using errcode = 'check_violation';
  end if;

  if old.statut = 'termine' then
    raise exception 'refus.acces.termine'
      using errcode = 'check_violation';
  end if;
  if old.effet_du is not null and new.effet_du is distinct from old.effet_du then
    raise exception 'refus.acces.activation_figee'
      using errcode = 'check_violation';
  end if;
  if old.licence_id is not null and new.licence_id is distinct from old.licence_id then
    raise exception 'refus.acces.licence_figee'
      using errcode = 'check_violation';
  end if;
  if old.effet_du is not null
     and (new.franchise_ht is distinct from old.franchise_ht
          or new.franchise_jusqu_au is distinct from old.franchise_jusqu_au) then
    raise exception 'refus.acces.activation_figee'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- ------------------------------------------------------------- 6. Les deux portes de la reprise

/*
 * Le relais d'un accès vers une autre offre. Repris de 20261208093000 ; le
 * nouvel accès porte la franchise de sa hausse (rien pour une baisse).
 */
create or replace function facturation.acces_relayer(p_acces uuid, p_offre text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      facturation.acces;
  v_grille ref.offres;
  v_id   uuid;
  v_fr   record;
begin
  select * into v from facturation.acces where id = p_acces for update;
  v_grille := ref.offre_a(p_offre, current_date);
  select f.franchise_ht, f.jusqu_au into v_fr
    from facturation.franchise_de_reprise(
           v.licence_id,
           (ref.offre_a(v.offre_code, v.offre_depuis)).prix_mensuel_ht
             - case when v.franchise_jusqu_au > current_date then v.franchise_ht else 0 end,
           v_grille.prix_mensuel_ht, current_date) f;
  update facturation.acces
     set statut = 'termine', effet_au = current_date, motif_fin = 'changement_offre'
   where id = p_acces;
  insert into facturation.acces
    (tenant_id, licence_id, canal, cabinet_tenant_id, offre_code, offre_depuis, statut,
     propose_le, propose_par, repondu_le, repondu_par, effet_du,
     franchise_ht, franchise_jusqu_au)
  values
    (v.tenant_id, v.licence_id, 'cabinet', v.cabinet_tenant_id, v_grille.code,
     v_grille.effective_from, 'actif', current_date, auth.uid(), current_date, auth.uid(),
     current_date, v_fr.franchise_ht, v_fr.jusqu_au)
  returning id into v_id;
  return v_id;
end
$$;

/*
 * La PME répond à la prise en charge. Repris de sa définition en vigueur
 * (20261110090100) ; à l'acceptation, l'accès porte la franchise de ce que la
 * PME a déjà engagé d'avance — lue AVANT que l'accès ne commence.
 */
create or replace function public.acces_repondre(p_acces uuid, p_accepte boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        facturation.acces;
  v_lic    uuid;
  v_rang_c smallint;
  v_rang_o smallint;
  v_offre  text;
  v_fr     record;
begin
  select * into v from facturation.acces where id = p_acces for update;
  if v.id is null or v.statut <> 'propose' then
    raise exception 'refus.abonnement.plus_en_attente' using errcode = '22023';
  end if;
  if not app.has_org_role(v.tenant_id, array['dirigeant']) then
    raise exception 'refus.reserve.dirigeant'
      using errcode = '42501';
  end if;
  select lo.licence_id into v_lic
    from facturation.licence_organisations lo where lo.tenant_id = v.tenant_id;
  if v_lic is null then
    raise exception 'refus.licence.absente' using errcode = 'P0002';
  end if;

  if not p_accepte then
    update facturation.acces
       set statut = 'termine', licence_id = v_lic, effet_du = current_date,
           effet_au = current_date, motif_fin = 'refus_client',
           repondu_le = current_date, repondu_par = auth.uid()
     where id = p_acces;
  else
    select f.franchise_ht, f.jusqu_au into v_fr
      from facturation.franchise_de_reprise(
             v_lic, 0, (ref.offre_a(v.offre_code, v.offre_depuis)).prix_mensuel_ht,
             current_date) f;
    update facturation.acces
       set statut = 'actif', licence_id = v_lic, effet_du = current_date,
           repondu_le = current_date, repondu_par = auth.uid(),
           franchise_ht = v_fr.franchise_ht, franchise_jusqu_au = v_fr.jusqu_au
     where id = p_acces;

    -- L'offre attribuée devient le forfait si elle est AU-DESSUS du forfait
    -- courant ; au-dessous, la PME garde le sien et paie la différence au-dessus
    -- du plancher couvert par le cabinet (`periodes_v`).
    select f.offre_code into v_offre
      from facturation.forfait_courant_v f where f.licence_id = v_lic;
    v_rang_c := (ref.offre_a(v_offre, current_date)).rang;
    v_rang_o := (ref.offre_a(v.offre_code, current_date)).rang;
    if v_rang_o > coalesce(v_rang_c, 0) then
      perform public.forfait_changer(v.offre_code, v.tenant_id, current_date);
    end if;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  values (v.tenant_id, auth.uid(),
          case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          'facturation', 'acces', p_acces, jsonb_build_object('cabinet', v.cabinet_tenant_id));
  insert into collab.notifications (tenant_id, kind, payload)
  values (v.cabinet_tenant_id, case when p_accepte then 'acces.accepte' else 'acces.refuse' end,
          jsonb_build_object('acces_id', p_acces, 'pme_org_id', v.tenant_id,
                             'client', (select name from identity.organizations where id = v.tenant_id),
                             'offre', v.offre_code));
  return jsonb_build_object('acces_id', p_acces,
                            'statut', case when p_accepte then 'actif' else 'termine' end);
end
$$;

-- ------------------------------------------------------------- 7. L'acompte d'une montée gardée reste à régler

/*
 * Repris de 20261117110000. Un acompte de montée non payé est REMPLACÉ quand
 * son forfait n'est plus le forfait en cours — sauf si ce forfait est GARDÉ :
 * une descente ne l'efface pas, il reste à régler jusqu'à l'échéance.
 */
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
    else coalesce(d.etat, 'a_payer')
  end as etat,
  d.prestataire, d.reference, d.lien,
  exists (select 1 from facturation.paiement_imputations i where i.paiement_id = p.id) as impute,
  p.payeur_tenant_id
from facturation.paiements_en_ligne p
left join lateral (
  select e.etat, e.prestataire, e.reference, e.lien
    from facturation.paiement_evenements e
   where e.paiement_id = p.id
   order by e.le desc, e.id desc limit 1
) d on true;

comment on view facturation.paiements_en_ligne_v is
  'Les paiements en ligne et leur état DÉDUIT : payé, remplacé (un acompte de montée non payé '
  'dont le forfait n''est ni le forfait en cours ni un forfait gardé jusqu''à l''échéance), '
  'sinon le dernier événement, sinon à payer.';

/*
 * Repris de 20261128090000. Ce qui change : la montée à régler est celle du
 * forfait en cours OU celle que le forfait en cours garde (une descente ne
 * l'efface pas), et l'acompte se calcule sur l'écart figé de la montée —
 * l'écart de son offre à la précédente pour une ligne d'avant.
 */
create or replace function public.paiement_montee_preparer(p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

    if plateforme.facturation_auto_ouverte('pme') then
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
       'Passage ' || initcap(v_prec.offre_code) || ' -> ' || initcap(r.offre_code)
         || ' — ' || v_restants || '/' || v_jours || ' jours',
       v_ht, f.taux, round(v_ht * f.taux, 3), v_ht + round(v_ht * f.taux, 3), f.devise, auth.uid())
    returning id into v_id;

    return (select to_jsonb(v) from facturation.paiements_en_ligne_v v where v.paiement_id = v_id);
  end loop;

  return null;   -- rien à payer maintenant : aucune montée due.
end
$$;
