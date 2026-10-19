-- Les recharges de lectures, décidées le 19 octobre 2026.
--
--   * quatre paliers : 5, 10, 15, 20 DT HT -> 10, 25, 45, 70 lectures ;
--   * jamais sur le Basic (« le seul sans ajout ») ;
--   * valables douze mois ;
--   * GELÉES si l'abonnement descend sur une offre qui ne les admet pas : elles
--     restent au client, ne se lisent plus, et se rouvrent s'il remonte. Leur
--     échéance, elle, continue de courir ;
--   * on consomme d'abord le forfait du mois, puis la recharge qui expire la
--     première ;
--   * facturées sur la facture d'abonnement du mois (un seul timbre) ;
--   * recharge automatique, avec un plafond mensuel fixé par le client.
--
-- Les prix et les quantités vivent dans `ref.recharges` (R4), datés (R11). Une
-- recharge achetée recopie son prix et ses lectures : une hausse de grille ne
-- réécrit pas ce qui a été vendu (R7). Seul le propriétaire principal achète
-- et règle l'automatique (`20261022110000`).

-- --- 1. Le référentiel ------------------------------------------------------

create table ref.recharges (
  code            text not null,
  libelle         text not null,
  prix_ht         app.money_t not null check (prix_ht > 0),
  lectures        integer not null check (lectures > 0),
  validite_mois   smallint not null check (validite_mois > 0),
  rang            smallint not null,
  effective_from  date not null,
  created_at      timestamptz not null default now(),
  primary key (code, effective_from)
);

comment on table ref.recharges is
  'Les paliers de recharge de lectures, datés. Une ligne ne se réécrit pas : '
  'un nouveau tarif est une nouvelle ligne, à sa date.';

grant select on table ref.recharges to authenticated;

insert into ref.recharges (code, libelle, prix_ht, lectures, validite_mois, rang, effective_from)
values
  ('recharge_5',  'Recharge 10 lectures',  5.000, 10, 12, 1, date '2026-10-19'),
  ('recharge_10', 'Recharge 25 lectures', 10.000, 25, 12, 2, date '2026-10-19'),
  ('recharge_15', 'Recharge 45 lectures', 15.000, 45, 12, 3, date '2026-10-19'),
  ('recharge_20', 'Recharge 70 lectures', 20.000, 70, 12, 4, date '2026-10-19')
on conflict (code, effective_from) do nothing;

create or replace function ref.recharge_a(p_code text, p_a date)
returns ref.recharges
language sql
stable
set search_path = ''
as $$
  select r.* from ref.recharges r
   where r.code = p_code and r.effective_from <= p_a
   order by r.effective_from desc
   limit 1
$$;

-- Une offre admet des recharges, ou non. Le Basic n'en a jamais admis : la
-- colonne le dit pour toutes ses lignes, passées comme présentes.
alter table ref.offres add column recharges_permises boolean not null default true;
update ref.offres set recharges_permises = false where code = 'basic';

comment on column ref.offres.recharges_permises is
  'L''offre admet des recharges de lectures. Faux pour le Basic.';

-- --- 2. Ce qui a été acheté -------------------------------------------------

create table facturation.recharges (
  id             uuid primary key default gen_random_uuid(),
  licence_id     uuid not null references facturation.licences (id),
  recharge_code  text not null,
  lectures       integer not null check (lectures > 0),
  prix_ht        app.money_t not null check (prix_ht >= 0),
  achetee_le     date not null,
  expire_le      date not null,
  origine        text not null check (origine in ('achat', 'automatique', 'plateforme')),
  achetee_par    uuid,
  created_at     timestamptz not null default now(),
  constraint recharges_expire_apres_achat check (expire_le > achetee_le)
);

create index recharges_licence_idx on facturation.recharges (licence_id, expire_le);

comment on table facturation.recharges is
  'Les recharges de lectures vendues. Prix et lectures recopiés à l''achat (R7).';

-- RLS sans `force` : les fonctions de lecture (propriétaire de la table)
-- doivent voir la recharge d'un client quand c'est son collaborateur qui lit.
alter table facturation.recharges enable row level security;
revoke all on table facturation.recharges from public, anon;
grant select on table facturation.recharges to authenticated;

create policy recharges_lire on facturation.recharges
  for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select l.id from facturation.licences l
                            where l.titulaire = (select auth.uid())));

create trigger recharges_ne_se_reecrivent_pas
  before update or delete on facturation.recharges
  for each row execute function app.deny_mutation();

-- Une lecture dit sur quoi elle a été prise : le forfait du mois (vide), ou
-- une recharge.
alter table facturation.lectures
  add column recharge_id uuid references facturation.recharges (id);

create index lectures_recharge_idx on facturation.lectures (recharge_id)
  where recharge_id is not null;

-- --- 3. L'automatique ------------------------------------------------------
--
-- Un réglage est une suite de décisions : la dernière vaut. On n'écrase pas
-- la précédente, on en inscrit une nouvelle (R7).

create table facturation.recharge_automatique (
  id              uuid primary key default gen_random_uuid(),
  licence_id      uuid not null references facturation.licences (id),
  active          boolean not null,
  recharge_code   text,
  plafond_mois_ht app.money_t check (plafond_mois_ht > 0),
  decide_par      uuid not null,
  decide_le       timestamptz not null default now(),
  constraint recharge_automatique_complete
    check (not active or (recharge_code is not null and plafond_mois_ht is not null))
);

create index recharge_automatique_idx on facturation.recharge_automatique (licence_id, decide_le desc);

alter table facturation.recharge_automatique enable row level security;
revoke all on table facturation.recharge_automatique from public, anon;
grant select on table facturation.recharge_automatique to authenticated;

create policy recharge_automatique_lire on facturation.recharge_automatique
  for select to authenticated
  using ((select app.is_platform())
         or licence_id in (select l.id from facturation.licences l
                            where l.titulaire = (select auth.uid())));

create trigger recharge_automatique_ne_se_reecrit_pas
  before update or delete on facturation.recharge_automatique
  for each row execute function app.deny_mutation();

-- --- 4. Ce qui reste, recharge par recharge ---------------------------------

create or replace view facturation.recharges_v with (security_invoker = true) as
select
  r.id as recharge_id,
  r.licence_id,
  r.recharge_code,
  r.lectures,
  r.prix_ht,
  r.achetee_le,
  r.expire_le,
  r.origine,
  (r.lectures - coalesce(u.n, 0))::int as restantes,
  (r.expire_le >= current_date and coalesce(o.recharges_permises, false)) as utilisable,
  (r.expire_le >= current_date and not coalesce(o.recharges_permises, false)) as gelee,
  (r.expire_le < current_date) as expiree
from facturation.recharges r
left join lateral (
  select count(*) as n from facturation.lectures l where l.recharge_id = r.id
) u on true
left join facturation.forfait_courant_v h on h.licence_id = r.licence_id
left join lateral ref.offre_a(h.offre_code, h.offre_depuis) o on true;

grant select on facturation.recharges_v to authenticated;

comment on view facturation.recharges_v is
  'Chaque recharge, ce qu''il en reste, et si elle se lit (utilisable), dort '
  '(gelée : l''offre courante n''en admet pas) ou a passé son échéance.';

-- Le forfait du mois ne compte plus que ce qui a été pris sur lui : une
-- lecture prise sur une recharge n'entame pas le supplément que la plateforme
-- accorde. Corps repris de `20261020110000`, plus la seule condition ajoutée.
create or replace view facturation.consommation_v with (security_invoker = true) as
select
  d.licence_id, d.offre_code, d.statut,
  d.lectures_droit_total                                 as lectures_droit,
  d.lectures_droit                                       as lectures_forfait,
  d.lectures_supplement,
  coalesce(c.consommees, 0)::int                         as lectures_consommees,
  greatest(0, d.lectures_droit_total - coalesce(c.consommees, 0))::int
                                                         as lectures_restantes,
  d.organisations, d.sieges_occupes, d.sieges_inclus, d.sieges_max,
  d.prix_mensuel_ht,
  d.organisations_max, d.offre_libelle,
  d.offre_rang, d.canal, d.origine, d.titulaire
from facturation.droits_reels_v d
left join lateral (
  select count(*) as consommees
  from facturation.lectures l
  where l.licence_id = d.licence_id
    and l.periode = date_trunc('month', current_date)::date
    and l.recharge_id is null
) c on true;

-- --- 5. Où puiser, et quand l'automatique se déclenche -----------------------

create or replace function facturation.recharge_disponible(p_licence uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(0, r.restantes)), 0)::int
    from facturation.recharges_v r
   where r.licence_id = p_licence and r.utilisable
$$;

revoke all on function facturation.recharge_disponible(uuid) from public, anon, authenticated;

-- Le palier que l'automatique achèterait maintenant, ou rien : réglage actif,
-- offre qui admet les recharges, et plafond du mois non dépassé.
create or replace function facturation.recharge_automatique_possible(p_licence uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reglage record;
  v_palier  ref.recharges;
  v_depense numeric;
  v_permis  boolean;
begin
  select * into v_reglage
    from facturation.recharge_automatique a
   where a.licence_id = p_licence
   order by a.decide_le desc, a.id desc
   limit 1;
  if v_reglage.id is null or not v_reglage.active then
    return null;
  end if;

  select o.recharges_permises into v_permis
    from facturation.forfait_courant_v h
    cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
   where h.licence_id = p_licence;
  if not coalesce(v_permis, false) then
    return null;
  end if;

  v_palier := ref.recharge_a(v_reglage.recharge_code, current_date);
  if v_palier.code is null then
    return null;
  end if;

  select coalesce(sum(r.prix_ht), 0) into v_depense
    from facturation.recharges r
   where r.licence_id = p_licence and r.origine = 'automatique'
     and r.achetee_le >= date_trunc('month', current_date)::date;

  if v_depense + v_palier.prix_ht > v_reglage.plafond_mois_ht then
    return null;
  end if;
  return v_palier.code;
end
$$;

revoke all on function facturation.recharge_automatique_possible(uuid) from public, anon, authenticated;

-- La seule écriture d'une recharge. Appelée par l'achat, par l'automatique,
-- et par la plateforme ; jamais exposée.
create or replace function facturation.recharge_inscrire(
  p_licence uuid, p_code text, p_origine text, p_par uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_palier ref.recharges;
  v_id     uuid;
begin
  v_palier := ref.recharge_a(p_code, current_date);
  if v_palier.code is null then
    raise exception 'recharge_refusee:palier_inconnu' using errcode = 'check_violation';
  end if;

  insert into facturation.recharges
    (licence_id, recharge_code, lectures, prix_ht, achetee_le, expire_le, origine, achetee_par)
  values
    (p_licence, v_palier.code, v_palier.lectures, v_palier.prix_ht, current_date,
     (current_date + make_interval(months => v_palier.validite_mois))::date, p_origine, p_par)
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table, object_id, payload)
  select lo.tenant_id, p_par, 'recharge.achetee', 'facturation', 'recharges', v_id,
         jsonb_build_object('palier', v_palier.code, 'origine', p_origine,
                            'lectures', v_palier.lectures, 'prix_ht', v_palier.prix_ht)
    from facturation.licence_organisations lo
   where lo.licence_id = p_licence
   order by lo.tenant_id
   limit 1;

  return v_id;
end
$$;

revoke all on function facturation.recharge_inscrire(uuid, text, text, uuid) from public, anon, authenticated;

-- --- 6. Le verdict sait qu'une recharge existe ------------------------------
--
-- Corps repris de la base (`lecture_verdict`), jusqu'au plafond. Au plafond du
-- forfait, deux verdicts nouveaux avant le refus : `sur_recharge` s'il reste
-- une recharge qui se lit, `recharge_automatique` si l'automatique peut en
-- acheter une. Le refus `plafond_atteint` dit aussi ce qui dort (`gelees`).

create or replace function public.lecture_verdict(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_vis      app.vis_t;
  v_licence  uuid;
  v_conso    record;
  v_deja     boolean;
  v_recharge integer;
  v_auto     text;
begin
  -- La RLS de `capture.pieces` ne s'applique plus ici : la lisibilité de la
  -- pièce pour l'appelant se demande à la fonction qui la porte.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- B6 : une pièce personnelle n'est jamais lue.
  if v_vis = 'personnel'::app.vis_t then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'piece_personnelle',
      'restantes', null, 'droit', null);
  end if;

  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;
  if v_licence is null then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  select * into v_conso from facturation.consommation_v where licence_id = v_licence;
  if v_conso.licence_id is null then
    -- Pas de ligne : on ne sait pas, donc on refuse. Jamais `true` par défaut.
    return jsonb_build_object(
      'autorisee', false, 'motif', 'organisation_sans_licence',
      'restantes', null, 'droit', null);
  end if;

  -- Une pièce déjà comptée se relit sans rien coûter. C'est la correction
  -- gratuite, et c'est volontaire.
  select exists (select 1 from facturation.lectures where piece_id = p_piece)
    into v_deja;
  if v_deja then
    return jsonb_build_object(
      'autorisee', true, 'motif', 'relecture_gratuite',
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  -- Une licence suspendue n'arrête pas la caméra, elle arrête l'œil.
  if v_conso.statut <> 'active' then
    return jsonb_build_object(
      'autorisee', false, 'motif', 'licence_' || v_conso.statut,
      'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
      'licence_id', v_licence);
  end if;

  if v_conso.lectures_restantes <= 0 then
    v_recharge := facturation.recharge_disponible(v_licence);
    if v_recharge > 0 then
      return jsonb_build_object(
        'autorisee', true, 'motif', 'sur_recharge',
        'restantes', 0, 'droit', v_conso.lectures_droit,
        'recharge', v_recharge, 'licence_id', v_licence);
    end if;

    v_auto := facturation.recharge_automatique_possible(v_licence);
    if v_auto is not null then
      return jsonb_build_object(
        'autorisee', true, 'motif', 'recharge_automatique',
        'restantes', 0, 'droit', v_conso.lectures_droit,
        'recharge', 0, 'palier', v_auto, 'licence_id', v_licence);
    end if;

    return jsonb_build_object(
      'autorisee', false, 'motif', 'plafond_atteint',
      'restantes', 0, 'droit', v_conso.lectures_droit,
      'recharge', 0,
      'gelees', (select coalesce(sum(greatest(0, r.restantes)), 0)::int
                   from facturation.recharges_v r
                  where r.licence_id = v_licence and r.gelee),
      'licence_id', v_licence);
  end if;

  return jsonb_build_object(
    'autorisee', true, 'motif', 'dans_le_forfait',
    'restantes', v_conso.lectures_restantes, 'droit', v_conso.lectures_droit,
    'licence_id', v_licence);
end
$$;

-- --- 7. Consommer : le forfait, puis la recharge qui expire la première ----

create or replace function public.lecture_consommer(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid;
  v_licence  uuid;
  v_verdict  jsonb;
  v_motif    text;
  v_recharge uuid;
begin
  -- La porte, nommée, et d'abord. La RLS de `capture.pieces` ne s'applique
  -- plus ici : sans cette ligne, tout compte authentifié ferait compter la
  -- lecture d'une pièce qu'il n'a pas le droit de voir.
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- La règle du plafond vit à UN seul endroit, et c'est ici qu'on l'invoque.
  v_verdict := public.lecture_verdict(p_piece);
  if not (v_verdict ->> 'autorisee')::boolean then
    raise exception 'lecture refusee : %', v_verdict ->> 'motif'
      using errcode = 'check_violation';
  end if;

  v_motif := v_verdict ->> 'motif';
  if v_motif = 'relecture_gratuite' then
    return v_verdict;
  end if;

  -- Rien de ce qui s'écrit ne vient de l'appelant : le tenant est celui de la
  -- pièce, la licence est celle du tenant. C'est ce qui tient les sections 8
  -- et 9 sans la politique.
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  select licence_id into v_licence
    from facturation.licence_organisations where tenant_id = v_tenant;

  if v_motif in ('sur_recharge', 'recharge_automatique') then
    -- Deux lectures simultanées ne prennent pas la même dernière unité : on
    -- verrouille la licence avant de choisir (ou d'acheter) : les lectures sur
    -- recharge d'un même client passent l'une après l'autre.
    perform 1 from facturation.licences l where l.id = v_licence for update;

    -- Une lecture concurrente a pu acheter pendant l'attente : on n'en achète
    -- une que s'il n'en reste toujours aucune.
    if v_motif = 'recharge_automatique' and facturation.recharge_disponible(v_licence) = 0 then
      perform facturation.recharge_inscrire(
        v_licence, v_verdict ->> 'palier', 'automatique', auth.uid());
    end if;

    select r.recharge_id into v_recharge
      from facturation.recharges_v r
     where r.licence_id = v_licence and r.utilisable and r.restantes > 0
     order by r.expire_le, r.achetee_le, r.recharge_id
     limit 1;
    if v_recharge is null then
      raise exception 'lecture refusee : plafond_atteint' using errcode = 'check_violation';
    end if;
  end if;

  insert into facturation.lectures
    (tenant_id, licence_id, piece_id, periode, consommee_par, recharge_id)
  values (v_tenant, v_licence, p_piece,
          date_trunc('month', current_date)::date, auth.uid(), v_recharge)
  on conflict (piece_id) do nothing;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'lecture.consommee', 'capture', 'pieces', p_piece,
          jsonb_build_object('licence_id', v_licence, 'recharge_id', v_recharge));

  return public.lecture_verdict(p_piece);
end
$$;

-- --- 8. Acheter, et régler l'automatique : le propriétaire principal --------

create or replace function public.recharge_acheter(p_code text, p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_permis  boolean;
  v_id      uuid;
begin
  if p_tenant is not null and not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal achete une recharge' using errcode = '42501';
  end if;
  v_licence := facturation.ma_licence(p_tenant);
  if v_licence is null then
    raise exception 'seul le proprietaire principal achete une recharge' using errcode = '42501';
  end if;

  select o.recharges_permises into v_permis
    from facturation.forfait_courant_v h
    cross join lateral ref.offre_a(h.offre_code, h.offre_depuis) o
   where h.licence_id = v_licence;
  if not coalesce(v_permis, false) then
    raise exception 'recharge_refusee:offre_sans_recharge' using errcode = 'check_violation',
      hint = 'Le Basic ne prend pas de recharge : passer au Solo ou au-dessus.';
  end if;

  v_id := facturation.recharge_inscrire(v_licence, p_code, 'achat', auth.uid());
  return (select to_jsonb(r) from facturation.recharges_v r where r.recharge_id = v_id);
end
$$;

revoke all on function public.recharge_acheter(text, uuid) from public, anon;
grant execute on function public.recharge_acheter(text, uuid) to authenticated;

create or replace function public.recharge_automatique_regler(
  p_active boolean, p_code text default null, p_plafond_mois_ht numeric default null,
  p_tenant uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
begin
  if p_tenant is not null and not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le proprietaire principal regle la recharge automatique'
      using errcode = '42501';
  end if;
  v_licence := facturation.ma_licence(p_tenant);
  if v_licence is null then
    raise exception 'seul le proprietaire principal regle la recharge automatique'
      using errcode = '42501';
  end if;
  if p_active and (ref.recharge_a(p_code, current_date)).code is null then
    raise exception 'recharge_refusee:palier_inconnu' using errcode = 'check_violation';
  end if;

  insert into facturation.recharge_automatique
    (licence_id, active, recharge_code, plafond_mois_ht, decide_par)
  values (v_licence, p_active,
          case when p_active then p_code end,
          case when p_active then p_plafond_mois_ht end,
          auth.uid());

  return jsonb_build_object('active', p_active, 'palier', case when p_active then p_code end,
                            'plafond_mois_ht', case when p_active then p_plafond_mois_ht end);
end
$$;

revoke all on function public.recharge_automatique_regler(boolean, text, numeric, uuid) from public, anon;
grant execute on function public.recharge_automatique_regler(boolean, text, numeric, uuid) to authenticated;

-- --- 9. La facture du mois porte les recharges du mois ----------------------
--
-- Un seul timbre : les recharges achetées dans la période, et pas encore
-- facturées, deviennent des lignes de la facture d'abonnement. Le lien est
-- inscrit à part (la recharge ne se réécrit pas), et une recharge ne se
-- facture qu'une fois. Corps de `facturation.emettre` repris de la base ;
-- ce qui change, sur la facture du titulaire : le HT, les lignes, et le lien.

create table facturation.facture_recharges (
  facture_id  uuid not null references facturation.factures (id),
  recharge_id uuid not null unique references facturation.recharges (id),
  primary key (facture_id, recharge_id)
);

alter table facturation.facture_recharges enable row level security;
revoke all on table facturation.facture_recharges from public, anon;
grant select on table facturation.facture_recharges to authenticated;

create policy facture_recharges_lire on facturation.facture_recharges
  for select to authenticated
  using ((select app.is_platform())
         or recharge_id in (select r.id from facturation.recharges r));

create trigger facture_recharges_ne_se_reecrivent_pas
  before update or delete on facturation.facture_recharges
  for each row execute function app.deny_mutation();

-- Corps vivant de la base (dernière définition : 20261020110000), plus les recharges.
CREATE OR REPLACE FUNCTION facturation.emettre(p_licence uuid, p_periode date, p_jours_echeance integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c          record;
  v_emetteur record;
  v_pack     uuid;
  v_taux     numeric(8,6);
  v_timbre   app.money_t;
  v_sieges   smallint;
  l          record;
  v_tva      app.money_t;
  v_nom      text;
  v_legal    text;
  v_numero   text;
  v_id       uuid;
  v_faites   jsonb := '[]'::jsonb;
  v_premiere uuid;
  v_premier  text;
  v_ttc      app.money_t := 0;
  v_ht       app.money_t;
  v_recharge record;
  v_ordinal  smallint;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if extract(day from p_periode) <> 1 then
    raise exception 'une periode est un premier du mois' using errcode = 'check_violation';
  end if;

  select * into c from facturation.consommation_v where licence_id = p_licence;
  if c.licence_id is null then
    raise exception 'licence introuvable' using errcode = 'no_data_found';
  end if;

  -- R4 : l'émetteur est une donnée, pas une hypothèse. Sa devise est celle de
  -- la facture ; sa juridiction désigne le pack dont on lit le taux et le
  -- timbre.
  select o.currency, o.jurisdiction into v_emetteur
    from facturation.emetteurs e
    join identity.organizations o on o.id = e.organisation_id
   where e.valide_des <= current_date
   order by e.valide_des desc limit 1;
  if not found then
    raise exception 'aucun emetteur designe (facturation.emetteurs)'
      using errcode = 'no_data_found';
  end if;

  select p.id into v_pack
    from ref.jurisdiction_packs p
   where p.jurisdiction = v_emetteur.jurisdiction
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc limit 1;
  if v_pack is null then
    raise exception 'aucun pack de juridiction en vigueur pour l''emetteur (ref.jurisdiction_packs)'
      using errcode = 'no_data_found';
  end if;

  select r.rate into v_taux
    from ref.tva_rates r
   where r.pack_version_id = v_pack
     and r.code = 'TVA19'
     and r.valid_from <= current_date
     and (r.valid_to is null or r.valid_to >= current_date)
   order by r.valid_from desc limit 1;

  select coalesce(sp.value_num, sp.value_text::numeric) into v_timbre
    from ref.socle_params sp
   where sp.pack_version_id = v_pack
     and sp.code = 'facture.droit_de_timbre'
     and sp.valid_from <= current_date
     and (sp.valid_to is null or sp.valid_to >= current_date)
   order by sp.valid_from desc limit 1;

  -- Pas de valeur de repli. R4 jusqu'au bout : une facture émise sous un taux
  -- supposé serait fausse sans que personne ne le voie.
  if v_taux is null then
    raise exception 'aucun taux de TVA en vigueur (ref.tva_rates, code TVA19)'
      using errcode = 'no_data_found';
  end if;
  if v_timbre is null then
    raise exception
      'aucun droit de timbre en vigueur (ref.socle_params, code facture.droit_de_timbre)'
      using errcode = 'no_data_found';
  end if;

  v_sieges := greatest(0, c.sieges_occupes - c.sieges_inclus)::smallint;

  -- Une ligne par payeur. `order by payeur_type` fixe l'ordre — `cabinet`
  -- avant `titulaire` — pour que `facture_id` désigne toujours la même facture
  -- d'une exécution à l'autre.
  for l in
    select * from facturation.a_facturer(p_licence, p_periode)
     order by payeur_type
  loop
    if l.payeur_type = 'cabinet' then
      select o.name, o.legal_id into v_nom, v_legal
        from identity.organizations o where o.id = l.payeur_tenant_id;
    else
      select p.display_name, null::text into v_nom, v_legal
        from identity.profiles p where p.user_id = l.payeur_personne;
    end if;

    -- Pas de repli (R4) : une facture sans destinataire nommé n'est pas une
    -- facture. On refuse, et on dit où le nom manque.
    if v_nom is null or length(btrim(v_nom)) = 0 then
      raise exception
        'le destinataire % n''a pas de nom (identity.organizations.name ou identity.profiles.display_name)',
        coalesce(l.payeur_tenant_id, l.payeur_personne)
        using errcode = 'no_data_found';
    end if;

    -- Les recharges vont sur la facture du titulaire : celles achetées jusqu'à
    -- la fin de la période et pas encore facturées (20261022120000).
    v_ht := l.montant_ht;
    if l.payeur_type = 'titulaire' then
      select (l.montant_ht + coalesce(sum(x.prix_ht), 0))::app.money_t into v_ht
        from facturation.recharges x
       where x.licence_id = p_licence
         and x.achetee_le < (p_periode + interval '1 month')::date
         and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id);
    end if;

    v_tva    := round(v_ht * v_taux, 3);
    v_numero := 'ALG-' || to_char(p_periode, 'YYYYMM') || '-'
                || lpad(nextval('facturation.numero_facture_seq')::text, 5, '0');

    insert into facturation.factures
      (licence_id, numero, periode, emise_le, echeance_le, offre_code,
       organisations, sieges_payants, montant_ht, taux_tva, montant_tva,
       timbre, montant_ttc, devise,
       payeur_type, payeur_tenant_id, payeur_personne,
       destinataire_nom, destinataire_legal_id, reference_abonne)
    values
      (p_licence, v_numero, p_periode, current_date,
       current_date + p_jours_echeance, l.offre_code,
       c.organisations, v_sieges, v_ht, v_taux, v_tva, v_timbre,
       v_ht + v_tva + v_timbre, v_emetteur.currency,
       l.payeur_type, l.payeur_tenant_id, l.payeur_personne,
       v_nom, v_legal, l.acces_reference)
    returning id into v_id;

    insert into facturation.facture_lignes
      (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
    values (v_id, 1,
            'Abonnement ' || l.offre_code || ' — '
            || to_char(p_periode, 'TMMonth YYYY')
            || ' (' || l.jours || '/' || l.jours_du_mois || ' jours)',
            1, l.montant_ht, l.montant_ht);

    if l.payeur_type = 'titulaire' then
      v_ordinal := 1;
      for v_recharge in
        select x.id, x.lectures, x.prix_ht, x.achetee_le, x.origine
          from facturation.recharges x
         where x.licence_id = p_licence
           and x.achetee_le < (p_periode + interval '1 month')::date
           and not exists (select 1 from facturation.facture_recharges fr where fr.recharge_id = x.id)
         order by x.achetee_le, x.id
      loop
        v_ordinal := v_ordinal + 1;
        insert into facturation.facture_lignes
          (facture_id, ordinal, libelle, quantite, prix_unitaire, montant_ht)
        values (v_id, v_ordinal,
                'Recharge ' || v_recharge.lectures || ' lectures'
                  || case when v_recharge.origine = 'automatique' then ' (automatique)' else '' end
                  || ' — ' || to_char(v_recharge.achetee_le, 'DD/MM/YYYY'),
                1, v_recharge.prix_ht, v_recharge.prix_ht);
        insert into facturation.facture_recharges (facture_id, recharge_id) values (v_id, v_recharge.id);
      end loop;
    end if;

    if v_premiere is null then
      v_premiere := v_id;
      v_premier  := v_numero;
    end if;
    v_ttc    := v_ttc + v_ht + v_tva + v_timbre;
    v_faites := v_faites || jsonb_build_object(
                  'facture_id', v_id, 'numero', v_numero,
                  'payeur_type', l.payeur_type,
                  'payeur', coalesce(l.payeur_tenant_id, l.payeur_personne),
                  'destinataire', v_nom,
                  'offre_code', l.offre_code,
                  'jours', l.jours, 'jours_du_mois', l.jours_du_mois,
                  'ht', v_ht,
                  'ttc', v_ht + v_tva + v_timbre);
  end loop;

  if jsonb_array_length(v_faites) = 0 then
    raise exception
      'rien a facturer sur cette licence pour % : aucun payeur sur la periode (facturation.a_facturer)',
      p_periode
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'facture_id', v_premiere, 'numero', v_premier, 'ttc', v_ttc,
    'factures', v_faites);
end
$function$;
