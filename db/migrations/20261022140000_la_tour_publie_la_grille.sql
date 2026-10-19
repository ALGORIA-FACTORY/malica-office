-- La tour publie la grille : offres et recharges, datées, avec des gardes.
--
-- Jusqu'ici une grille ne changeait que par une migration écrite à la main.
-- La tour la publie désormais elle-même, par une seule porte, et cette porte
-- refuse les TROUS que Wissem a demandé de traquer le 19 octobre :
--
--   * une offre de la grille qui disparaît, ou deux offres au même rang ;
--   * une offre supérieure qui ne coûte pas plus, ou ne donne pas plus de
--     lectures, ou moins de personnes ;
--   * une offre supérieure dont la lecture revient PLUS CHER : monter doit
--     toujours être une meilleure affaire, sinon personne ne monte ;
--   * une recharge moins chère, à la lecture, que de monter d'une offre :
--     elle « brûlerait l'abonnement suivant » — le client rechargerait au lieu
--     de monter ;
--   * des paliers de recharge dont le plus gros n'est pas le plus avantageux ;
--   * une date passée : une grille ne se publie que pour demain ou plus tard,
--     et ce qui a été facturé reste explicable avec la grille d'alors (R7).
--
-- Tout se lit dans le document proposé et dans `ref.offres` ; aucune
-- constante n'est écrite ici (R4). Une grille publiée s'inscrit dans
-- `plateforme.grilles_publiees`, qui ne se réécrit pas.

-- --- 1. Les trous d'une grille proposée --------------------------------------

create or replace function plateforme.grille_trous(
  p_effective_from date, p_offres jsonb, p_recharges jsonb)
returns table (code text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o       record;
  r       record;
  -- L'offre et le palier précédents, rang après rang (vides au premier).
  p_code  text;
  p_prix  numeric;
  p_lect  integer;
  p_siege integer;
  p_rech  boolean;
  v_marge numeric := 0;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;

  if p_effective_from is null or p_effective_from <= current_date then
    code := 'date_passee';
    detail := 'une grille se publie pour demain ou plus tard';
    return next;
  end if;

  if jsonb_typeof(p_offres) is distinct from 'array' or jsonb_array_length(p_offres) = 0 then
    code := 'offres_absentes'; detail := 'la grille ne porte aucune offre'; return next;
    return;
  end if;

  -- Une offre connue ne disparaît pas de la grille.
  for o in
    select distinct x.code from ref.offres x
     where not exists (select 1 from jsonb_array_elements(p_offres) e where e ->> 'code' = x.code)
  loop
    code := 'offre_manquante'; detail := o.code; return next;
  end loop;

  for o in
    select e ->> 'rang' as rang, count(*) as n
      from jsonb_array_elements(p_offres) e group by 1 having count(*) > 1
  loop
    code := 'rang_double'; detail := o.rang; return next;
  end loop;

  -- Rang après rang : plus cher, plus de lectures, pas moins de personnes, et
  -- une lecture qui revient moins cher.
  p_code := null;
  for o in
    select e ->> 'code' as code,
           (e ->> 'rang')::int as rang,
           (e ->> 'prix_mensuel_ht')::numeric as prix,
           ((e ->> 'lectures_par_organisation')::int
             * coalesce((e ->> 'organisations_incluses')::int, 1)) as lectures,
           (e ->> 'sieges_inclus')::int as sieges,
           (e ->> 'sieges_max')::int as sieges_max,
           coalesce((e ->> 'recharges_permises')::boolean, true) as recharges
      from jsonb_array_elements(p_offres) e
     order by (e ->> 'rang')::int
  loop
    if o.prix is null or o.lectures is null or o.lectures <= 0 or o.sieges is null then
      code := 'offre_incomplete'; detail := o.code; return next;
      continue;
    end if;
    if o.sieges_max is not null and o.sieges_max < o.sieges then
      code := 'places_incoherentes'; detail := o.code; return next;
    end if;
    if p_code is not null then
      if o.prix <= p_prix then
        code := 'prix_non_croissant'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.lectures <= p_lect then
        code := 'lectures_non_croissantes'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.sieges < p_siege then
        code := 'personnes_decroissantes'; detail := p_code || ' -> ' || o.code; return next;
      end if;
      if o.prix / o.lectures > p_prix / p_lect then
        code := 'monter_coute_plus_a_la_lecture'; detail := p_code || ' -> ' || o.code;
        return next;
      end if;
      -- Ce que coûte une lecture de plus en montant : une recharge ne doit
      -- jamais faire mieux, sur une offre qui admet les recharges.
      if p_rech and o.lectures > p_lect then
        v_marge := greatest(v_marge, (o.prix - p_prix) / (o.lectures - p_lect));
      end if;
    end if;
    p_code := o.code; p_prix := o.prix; p_lect := o.lectures;
    p_siege := o.sieges; p_rech := o.recharges;
  end loop;

  -- Les recharges : plus chères et plus grosses rang après rang, la plus
  -- grosse la plus avantageuse, et aucune moins chère que de monter.
  if jsonb_typeof(p_recharges) = 'array' then
    p_code := null;
    for r in
      select e ->> 'code' as code,
             (e ->> 'rang')::int as rang,
             (e ->> 'prix_ht')::numeric as prix,
             (e ->> 'lectures')::int as lectures
        from jsonb_array_elements(p_recharges) e
       order by (e ->> 'rang')::int
    loop
      if r.prix is null or r.prix <= 0 or r.lectures is null or r.lectures <= 0 then
        code := 'recharge_incomplete'; detail := r.code; return next;
        continue;
      end if;
      if r.prix / r.lectures < v_marge then
        code := 'recharge_brule_l_offre_suivante'; detail := r.code; return next;
      end if;
      if p_code is not null then
        if r.prix <= p_prix or r.lectures <= p_lect then
          code := 'paliers_non_croissants'; detail := p_code || ' -> ' || r.code; return next;
        end if;
        if r.prix / r.lectures > p_prix / p_lect then
          code := 'gros_palier_moins_avantageux'; detail := p_code || ' -> ' || r.code;
          return next;
        end if;
      end if;
      p_code := r.code; p_prix := r.prix; p_lect := r.lectures;
    end loop;
  end if;
end
$$;

revoke all on function plateforme.grille_trous(date, jsonb, jsonb) from public, anon;
grant execute on function plateforme.grille_trous(date, jsonb, jsonb) to authenticated;

comment on function plateforme.grille_trous(date, jsonb, jsonb) is
  'Les trous d''une grille proposée : vide, elle peut se publier. Réservé à la plateforme.';

-- --- 2. La grille en vigueur, au format qu'on propose ------------------------

create or replace function plateforme.grille_en_vigueur(p_le date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'effective_from', p_le,
    'offres', (
      select coalesce(jsonb_agg(to_jsonb(g) - 'id' - 'created_at' - 'effective_from' order by g.rang), '[]')
        from (select distinct on (o.code) o.* from ref.offres o
               where o.effective_from <= p_le order by o.code, o.effective_from desc) g),
    'recharges', (
      select coalesce(jsonb_agg(to_jsonb(g) - 'created_at' - 'effective_from' order by g.rang), '[]')
        from (select distinct on (r.code) r.* from ref.recharges r
               where r.effective_from <= p_le order by r.code, r.effective_from desc) g));
end
$$;

revoke all on function plateforme.grille_en_vigueur(date) from public, anon;
grant execute on function plateforme.grille_en_vigueur(date) to authenticated;

-- --- 3. Publier ---------------------------------------------------------------

create table plateforme.grilles_publiees (
  id              uuid primary key default gen_random_uuid(),
  effective_from  date not null unique,
  offres          jsonb not null,
  recharges       jsonb not null,
  motif           text not null check (length(btrim(motif)) > 0),
  publie_par      uuid not null,
  publie_le       timestamptz not null default now()
);

comment on table plateforme.grilles_publiees is
  'Chaque grille publiée par la tour : ce qui a été posé, à quelle date d''effet, '
  'par qui et pourquoi. On n''y efface rien.';

alter table plateforme.grilles_publiees enable row level security;
revoke all on table plateforme.grilles_publiees from public, anon;
grant select on table plateforme.grilles_publiees to authenticated;

create policy grilles_publiees_lire on plateforme.grilles_publiees
  for select to authenticated using ((select app.is_platform()));

create trigger grilles_publiees_ne_se_reecrivent_pas
  before update or delete on plateforme.grilles_publiees
  for each row execute function app.deny_mutation();

create or replace function plateforme.grille_publier(
  p_effective_from date, p_offres jsonb, p_recharges jsonb, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trous jsonb;
  v_id    uuid;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'detail', t.detail)), '[]')
    into v_trous
    from plateforme.grille_trous(p_effective_from, p_offres, p_recharges) t;
  if jsonb_array_length(v_trous) > 0 then
    raise exception 'grille_refusee:%', v_trous using errcode = 'check_violation';
  end if;

  insert into ref.offres
    (code, libelle, prix_mensuel_ht, lectures_par_organisation, sieges_inclus, sieges_max,
     prix_siege_sup, lectures_par_siege_sup, organisations_incluses, organisations_max,
     prix_organisation_sup, rang, recharges_permises, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_mensuel_ht')::numeric,
         (e ->> 'lectures_par_organisation')::int, (e ->> 'sieges_inclus')::int,
         (e ->> 'sieges_max')::int, coalesce((e ->> 'prix_siege_sup')::numeric, 0),
         coalesce((e ->> 'lectures_par_siege_sup')::int, 0),
         coalesce((e ->> 'organisations_incluses')::int, 1), (e ->> 'organisations_max')::int,
         coalesce((e ->> 'prix_organisation_sup')::numeric, 0), (e ->> 'rang')::int,
         coalesce((e ->> 'recharges_permises')::boolean, true), p_effective_from
    from jsonb_array_elements(p_offres) e;

  insert into ref.recharges (code, libelle, prix_ht, lectures, validite_mois, rang, effective_from)
  select e ->> 'code', e ->> 'libelle', (e ->> 'prix_ht')::numeric, (e ->> 'lectures')::int,
         (e ->> 'validite_mois')::int, (e ->> 'rang')::int, p_effective_from
    from jsonb_array_elements(coalesce(p_recharges, '[]'::jsonb)) e;

  insert into plateforme.grilles_publiees (effective_from, offres, recharges, motif, publie_par)
  values (p_effective_from, p_offres, coalesce(p_recharges, '[]'::jsonb), p_motif, auth.uid())
  returning id into v_id;

  return jsonb_build_object('grille_id', v_id, 'effective_from', p_effective_from,
                            'offres', jsonb_array_length(p_offres),
                            'recharges', jsonb_array_length(coalesce(p_recharges, '[]'::jsonb)));
end
$$;

revoke all on function plateforme.grille_publier(date, jsonb, jsonb, text) from public, anon;
grant execute on function plateforme.grille_publier(date, jsonb, jsonb, text) to authenticated;

comment on function plateforme.grille_publier(date, jsonb, jsonb, text) is
  'La tour publie une grille d''offres et de recharges, datée, motivée — refusée '
  'si elle a un trou (`plateforme.grille_trous`).';

-- --- 4. Les licences, vues de la tour : des compteurs, jamais des papiers ----

create or replace view plateforme.licences_v with (security_invoker = true) as
select
  c.licence_id, c.offre_code, c.offre_libelle, c.statut, c.origine, c.canal,
  c.organisations, c.sieges_occupes, c.sieges_inclus,
  c.lectures_droit, c.lectures_consommees, c.lectures_restantes,
  c.prix_mensuel_ht,
  (select coalesce(sum(greatest(0, r.restantes)), 0)::int
     from facturation.recharges_v r where r.licence_id = c.licence_id and r.utilisable)
    as recharges_disponibles,
  (select coalesce(sum(greatest(0, r.restantes)), 0)::int
     from facturation.recharges_v r where r.licence_id = c.licence_id and r.gelee)
    as recharges_gelees,
  (select a.active from facturation.recharge_automatique a
    where a.licence_id = c.licence_id order by a.decide_le desc, a.id desc limit 1)
    as recharge_automatique
from facturation.consommation_v c
where (select app.is_platform());

grant select on plateforme.licences_v to authenticated;

comment on view plateforme.licences_v is
  'Les licences, pour la tour : offre, places, lectures, recharges. Aucun contenu.';
