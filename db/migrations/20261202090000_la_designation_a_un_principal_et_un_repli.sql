-- La désignation a un principal et un repli : Claude, puis DeepSeek, puis l'arrêt.
--
-- ================================================================== LA DÉCISION
--
-- 8 novembre 2026, décision du dirigeant, appliquée telle quelle :
--
--   1. CLAUDE est le modèle principal de la désignation (la passe 2 : il
--      reçoit le plan de jetons et ne rend que des `page`/`ordinal`, R2).
--   2. DEEPSEEK est le repli, « pour ne pas s'arrêter » : il prend la main
--      quand Claude est en défaut technique (erreur, délai, indisponibilité,
--      clé absente) OU quand le budget de Claude est épuisé.
--   3. Les DEUX budgets épuisés : on s'arrête. Aucun modèle n'est appelé, la
--      pièce reste lue par le moteur Sudoku seul — ce qu'il prouve est
--      désigné, le reste est vide et drapé — et le motif est journalisé.
--      Jamais de repli silencieux vers un troisième fournisseur.
--   4. Les plafonds (par fournisseur et par période) et le choix des modèles
--      se règlent depuis la tour : datés, motivés, jamais réécrits.
--
-- ================================================================== CE QUI EST POSÉ
--
-- 1. Les tarifs de Claude (R8 : choisir un modèle et savoir ce qu'il coûte sont
--    la même lecture). Identifiants et prix relevés le 8 novembre 2026 sur la
--    documentation officielle (platform.claude.com/docs/en/about-claude/models/
--    overview et …/pricing) : `claude-sonnet-5-5` à 2 $ / 10 $ par million de
--    jetons, `claude-haiku-5-5` à 0,10 $ / 0,50 $ (palier des invites de moins
--    de 100 000 jetons — le plan de la désignation est borné à 60 000
--    caractères, `planBorne`). Chaque identifiant est un instantané figé chez
--    le fournisseur : aucun « -latest ».
-- 2. `plateforme.reglages_designation` : la chaîne, rang par rang (1 le
--    principal, 2 le repli), en ajout seul. La dernière décision d'un rang vaut.
-- 3. `app.chaine_de_designation()` : la chaîne en vigueur, avec, pour chaque
--    maillon, la dépense de la période en cours et son verdict (`epuise`).
--    La dépense est celle du FOURNISSEUR, toutes organisations et tous organes
--    confondus (`agents.agent_runs`) : c'est sa facture réelle.
-- 4. `public.designation_chaine()` : ce que le serveur lit avant chaque
--    désignation — réservé au serveur (`malica.origine`).
-- 5. `plateforme.designation_regler(…)` et `plateforme.designation_etat()` :
--    la tour règle et voit (maillons, dépenses, dernières bascules).
--
-- Valeurs initiales volontairement prudentes : 50 $ par mois pour Claude,
-- 20 $ par mois pour DeepSeek. Un arbitrage commercial : la tour les règle
-- (docs/livraison-2026-10-19/10-ce-qui-reste-ouvert.md).
--
-- REJEU (R11) : dates en littéral, `if not exists`, `create or replace`,
-- `on conflict do nothing`, semences gardées par `where not exists`.

begin;

-- --- 1. Les tarifs de Claude ---------------------------------------------------------------------

insert into agents.model_pricing
  (provider, model, role, price_in_per_mtok, price_out_per_mtok, currency, sovereign, effective_from)
values
  ('anthropic', 'claude-sonnet-5-5', 'chat', 2.00, 10.00, 'USD', false, date '2026-11-01'),
  ('anthropic', 'claude-haiku-5-5',  'chat', 0.10,  0.50, 'USD', false, date '2026-11-01')
on conflict do nothing;

-- --- 2. La chaîne, rang par rang -----------------------------------------------------------------

create table if not exists plateforme.reglages_designation (
  id            uuid primary key default gen_random_uuid(),
  rang          smallint not null check (rang in (1, 2)),
  fournisseur   text not null check (fournisseur in ('anthropic', 'deepseek')),
  modele        text not null check (length(btrim(modele)) > 0),
  role          text not null check (role in ('chat', 'reasoner')),
  periode       text not null check (periode in ('jour', 'mois')),
  plafond_usd   numeric(12,4) not null check (plafond_usd >= 0),
  motif         text not null check (length(btrim(motif)) > 0),
  decide_par    uuid,
  decide_le     timestamptz not null default now()
);

comment on table plateforme.reglages_designation is
  'La chaîne de désignation réglée par la tour : rang 1 le principal, rang 2 le '
  'repli. Par rang, la dernière décision vaut ; rien ne se réécrit. Le plafond '
  'est en dollars, par fournisseur et par période (jour ou mois). Les deux '
  'plafonds atteints, la désignation par modèle s''arrête : la pièce est lue '
  'par le moteur Sudoku seul.';

create index if not exists reglages_designation_rang_idx
  on plateforme.reglages_designation (rang, decide_le desc);

alter table plateforme.reglages_designation enable row level security;
revoke all on table plateforme.reglages_designation from public, anon;
grant select on table plateforme.reglages_designation to authenticated;

drop policy if exists reglages_designation_lire on plateforme.reglages_designation;
create policy reglages_designation_lire on plateforme.reglages_designation
  for select to authenticated using ((select app.is_platform()));

drop trigger if exists reglages_designation_ne_se_reecrivent_pas on plateforme.reglages_designation;
create trigger reglages_designation_ne_se_reecrivent_pas
  before update or delete on plateforme.reglages_designation
  for each row execute function app.deny_mutation();

insert into plateforme.reglages_designation
  (rang, fournisseur, modele, role, periode, plafond_usd, motif, decide_le)
select 1, 'anthropic', 'claude-sonnet-5-5', 'chat', 'mois', 50,
       'Décision du dirigeant du 8 novembre 2026 : Claude désigne. Valeur initiale à régler par la tour.',
       timestamptz '2026-11-08 00:00:00+00'
 where not exists (select 1 from plateforme.reglages_designation where rang = 1);

insert into plateforme.reglages_designation
  (rang, fournisseur, modele, role, periode, plafond_usd, motif, decide_le)
select 2, 'deepseek', 'deepseek-chat', 'chat', 'mois', 20,
       'Décision du dirigeant du 8 novembre 2026 : DeepSeek prend la main pour ne pas s''arrêter. Valeur initiale à régler par la tour.',
       timestamptz '2026-11-08 00:00:00+00'
 where not exists (select 1 from plateforme.reglages_designation where rang = 2);

-- La dépense de la plateforme se compte sur la période : un index par date.
create index if not exists agent_runs_created_idx on agents.agent_runs (created_at);

-- --- 3. La chaîne en vigueur, et son verdict de budget ------------------------------------------

-- Ce qu'un fournisseur a coûté depuis le début de la période en cours.
create or replace function app.depense_du_fournisseur(p_fournisseur text, p_periode text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.cost), 0)
    from agents.agent_runs r
   where r.created_at >= date_trunc(case p_periode when 'jour' then 'day' else 'month' end, now())
     and r.model in (select p.model from agents.model_pricing p where p.provider = p_fournisseur)
$$;

revoke all on function app.depense_du_fournisseur(text, text) from public, anon, authenticated;

create or replace function app.chaine_de_designation()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with en_vigueur as (
    select distinct on (r.rang) r.rang, r.fournisseur, r.modele, r.role, r.periode,
           r.plafond_usd, r.motif, r.decide_le
      from plateforme.reglages_designation r
     order by r.rang, r.decide_le desc, r.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rang', e.rang,
           'fournisseur', e.fournisseur,
           'modele', e.modele,
           'role', e.role,
           'periode', e.periode,
           'plafond', e.plafond_usd,
           'depense', d.depense,
           'epuise', d.depense >= e.plafond_usd,
           'motif', e.motif,
           'decide_le', e.decide_le) order by e.rang), '[]'::jsonb)
    from en_vigueur e
    cross join lateral (select app.depense_du_fournisseur(e.fournisseur, e.periode) as depense) d
$$;

revoke all on function app.chaine_de_designation() from public, anon, authenticated;

-- --- 4. Ce que le serveur lit avant de désigner --------------------------------------------------

create or replace function public.designation_chaine()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('malica.origine', true), '') <> 'serveur' then
    raise exception 'refus.reserve.serveur' using errcode = '42501';
  end if;
  return app.chaine_de_designation();
end
$function$;

revoke all on function public.designation_chaine() from public, anon;
grant execute on function public.designation_chaine() to authenticated;

-- --- 5. La tour règle, et voit ------------------------------------------------------------------

create or replace function plateforme.designation_regler(
  p_rang smallint, p_modele text, p_role text, p_periode text, p_plafond numeric, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_fournisseur text;
  v_autre text;
  v_id uuid;
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  if p_rang is null or p_rang not in (1, 2)
     or p_periode is null or p_periode not in ('jour', 'mois')
     or p_role is null or p_role not in ('chat', 'reasoner')
     or p_plafond is null or p_plafond < 0
     or coalesce(btrim(p_motif), '') = '' then
    raise exception 'refus.designation.saisie' using errcode = 'check_violation';
  end if;

  -- R8 : un modèle sans tarif en vigueur s'appellerait sans que son coût
  -- s'inscrive — et aucun plafond ne mordrait sur lui.
  select p.provider into v_fournisseur
    from agents.model_pricing p
   where p.model = btrim(p_modele) and p.role = p_role
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;
  if v_fournisseur is null or v_fournisseur not in ('anthropic', 'deepseek') then
    raise exception 'refus.designation.modele_sans_tarif' using errcode = 'check_violation';
  end if;

  -- Deux maillons, deux fournisseurs : un repli chez le même fournisseur ne
  -- couvre ni sa panne, ni son budget.
  select r.fournisseur into v_autre
    from plateforme.reglages_designation r
   where r.rang <> p_rang
   order by r.decide_le desc, r.id desc
   limit 1;
  if v_autre = v_fournisseur then
    raise exception 'refus.designation.meme_fournisseur' using errcode = 'check_violation';
  end if;

  insert into plateforme.reglages_designation
    (rang, fournisseur, modele, role, periode, plafond_usd, motif, decide_par)
  values (p_rang, v_fournisseur, btrim(p_modele), p_role, p_periode, p_plafond, btrim(p_motif),
          auth.uid())
  returning id into v_id;
  return (select to_jsonb(r) - 'decide_par' from plateforme.reglages_designation r where r.id = v_id);
end
$function$;

revoke all on function plateforme.designation_regler(smallint, text, text, text, numeric, text)
  from public, anon;
grant execute on function plateforme.designation_regler(smallint, text, text, text, numeric, text)
  to authenticated;

/*
 * Ce que la tour voit : la chaîne et ses dépenses, les modèles qu'elle peut
 * choisir (ceux qui ont un tarif en vigueur chez les deux fournisseurs), et les
 * dernières bascules — `agents.agent_runs` de la désignation dont l'erreur dit
 * le motif (`bascule.technique`, `bascule.budget`, `arret.budgets_epuises`)
 * ou dont le statut dit qu'un repli a désigné (`degraded`).
 */
create or replace function plateforme.designation_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app.is_platform() then
    raise exception 'refus.reserve.plateforme' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'maillons', app.chaine_de_designation(),
    'modeles', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'fournisseur', m.provider, 'modele', m.model, 'role', m.role,
               'prix_entree', m.price_in_per_mtok, 'prix_sortie', m.price_out_per_mtok)
               order by m.provider, m.model, m.role), '[]'::jsonb)
        from (select distinct on (p.model, p.role) p.provider, p.model, p.role,
                     p.price_in_per_mtok, p.price_out_per_mtok
                from agents.model_pricing p
               where p.provider in ('anthropic', 'deepseek')
                 and p.role in ('chat', 'reasoner')
                 and p.effective_from <= current_date
                 and (p.effective_to is null or p.effective_to >= current_date)
               order by p.model, p.role, p.effective_from desc) m),
    'bascules', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'le', b.created_at, 'modele', b.model, 'statut', b.status,
               'motif', split_part(coalesce(b.error, ''), ':', 1))
               order by b.created_at desc), '[]'::jsonb)
        from (select r.created_at, r.model, r.status, r.error
                from agents.agent_runs r
               where r.agent = 'malica.lecture.designation'
                 and r.status in ('error', 'degraded')
                 and r.created_at >= now() - interval '30 days'
               order by r.created_at desc
               limit 30) b));
end
$function$;

revoke all on function plateforme.designation_etat() from public, anon;
grant execute on function plateforme.designation_etat() to authenticated;

-- Le geste de la tour, comme ses autres réglages (20261118150000).
insert into observabilite.gestes (depot, methode, etape, geste, objet_type, objet_chemin, dossier_chemin)
values ('tour', 'reglerDesignation', 'reglage', 'plateforme.designation_regler', 'plateforme', null, null)
on conflict do nothing;

commit;
