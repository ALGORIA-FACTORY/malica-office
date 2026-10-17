-- La tour compte, suspend et reprend — elle ne lit pas.
--
-- ================================================================== POURQUOI
--
-- ALGORIA n'a aujourd'hui aucun moyen de savoir combien de clients elle a,
-- ce qu'ils consomment, lesquels vont dépasser, lesquels n'ont rien déposé
-- depuis trois semaines, et lesquels doivent de l'argent. Le dépôt sert
-- parfaitement la PME et le cabinet, et n'a pas d'étage au-dessus.
--
-- Cette migration pose cet étage, en respectant la frontière de
-- `20261019090000` : tout ce qui suit est un COMPTE, jamais un contenu.
--
-- ======================================== POURQUOI LA SUSPENSION EST UNE ÉCRITURE
--
-- `facturation.licences.statut` existe déjà, et il suffirait de l'écrire.
-- Mais suspendre un client est l'acte le plus lourd de la relation : il
-- arrête son outil de travail. Il doit donc laisser une trace qui dit QUI,
-- QUAND, POURQUOI, et ce qui a été fait pour l'éviter — sinon la seule
-- mémoire de l'incident sera celle des deux personnes qui s'en souviennent.
--
-- R7 : la table des interventions est en ajout seul. Une suspension se défait
-- par une reprise inscrite, jamais par l'effacement de la suspension.
--
-- ============================================= POURQUOI UN QUOTA PAR LICENCE
--
-- La grille vit dans `ref.offres` et c'est très bien pour vendre. Mais un
-- client qui a besoin de 200 lectures sur Solo ne doit pas obliger à
-- inventer une offre : la tour pose un supplément sur SA licence, daté et
-- motivé, et la grille ne bouge pas.
--
-- C'est aussi ce qui rend le volume mensuel réellement paramétrable, au sens
-- où Wissem l'a demandé : par la grille pour tout le monde, et par la licence
-- pour un cas.

begin;

-- --- 1. Ce que la tour fait, et qui en répond ------------------------------

create table if not exists plateforme.interventions (
  id          uuid primary key default gen_random_uuid(),
  licence_id  uuid not null references facturation.licences(id) on delete restrict,

  acte        text not null check (acte in (
                'suspension', 'reprise', 'supplement_lectures',
                'remise_commerciale', 'changement_offre', 'note')),

  -- Pourquoi, en toutes lettres. Pas d'énuméré ici : le motif d'une
  -- suspension se relit un an après devant un client mécontent, et un code
  -- ne se relit pas.
  motif       text not null check (length(btrim(motif)) > 0),

  -- Ce qui a été tenté avant. Vide est une réponse, et elle se verra.
  avant       text,

  -- La valeur de l'acte, quand il en porte une : le nombre de lectures
  -- accordées, le montant remisé, le code de la nouvelle offre.
  valeur      numeric(38,3),
  valeur_text text,

  -- La fenêtre, pour ce qui en a une (un supplément vaut pour un mois).
  effet_du    date,
  effet_au    date,

  operateur   uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),

  constraint interventions_fenetre check (effet_au is null or effet_du is null
                                          or effet_au >= effet_du)
);

create index interventions_licence_idx
  on plateforme.interventions (licence_id, created_at desc);

comment on table plateforme.interventions is
  'Tout ce qu''un opérateur d''ALGORIA fait à une licence. Ajout seul : une '
  'suspension se défait par une reprise inscrite, jamais par un effacement.';

-- --- 2. Suspendre -----------------------------------------------------------
--
-- La règle commerciale du 17 octobre, tenue ici : « perdre sa licence
-- n'arrête pas la caméra ». La suspension arrête l'ŒIL — `lecture_autorisee`
-- rend déjà `licence_suspendue` — et la capture continue. Les pièces
-- s'empilent, non lues, et rien n'est perdu quand le client régularise.

create or replace function plateforme.suspendre(
  p_licence uuid, p_motif text, p_avant text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_statut text;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;

  select statut into v_statut from facturation.licences where id = p_licence;
  if v_statut is null then
    raise exception 'licence introuvable' using errcode = 'no_data_found';
  end if;
  if v_statut = 'suspendue' then
    return jsonb_build_object('licence_id', p_licence, 'change', false,
                              'statut', 'suspendue');
  end if;
  if v_statut = 'resiliee' then
    raise exception 'une licence resiliee ne se suspend pas' using errcode = 'check_violation';
  end if;

  update facturation.licences
     set statut = 'suspendue', suspendue_le = now(),
         motif_suspension = 'impaye', updated_at = now()
   where id = p_licence;

  insert into plateforme.interventions (licence_id, acte, motif, avant)
  values (p_licence, 'suspension', p_motif, p_avant);

  return jsonb_build_object('licence_id', p_licence, 'change', true,
                            'statut', 'suspendue');
end
$$;

-- --- 3. Reprendre -----------------------------------------------------------
--
-- Et rattraper ce qui s'est empilé : la reprise ne se contente pas de
-- rouvrir, elle DIT combien de pièces attendent. C'est le premier chiffre
-- que le client demandera, et le premier que l'opérateur doit avoir.

create or replace function plateforme.reprendre(
  p_licence uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statut   text;
  v_attente  integer;
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;

  select statut into v_statut from facturation.licences where id = p_licence;
  if v_statut is distinct from 'suspendue' then
    return jsonb_build_object('licence_id', p_licence, 'change', false,
                              'statut', v_statut);
  end if;

  update facturation.licences
     set statut = 'active', suspendue_le = null,
         motif_suspension = null, updated_at = now()
   where id = p_licence;

  select count(*) into v_attente
    from capture.pieces p
    join facturation.licence_organisations lo on lo.tenant_id = p.tenant_id
   where lo.licence_id = p_licence
     and p.status = 'capturee'
     and p.vis <> 'personnel'::app.vis_t;

  insert into plateforme.interventions (licence_id, acte, motif, valeur)
  values (p_licence, 'reprise', p_motif, v_attente);

  return jsonb_build_object('licence_id', p_licence, 'change', true,
                            'statut', 'active', 'pieces_en_attente', v_attente);
end
$$;

-- --- 4. Accorder des lectures en plus ---------------------------------------

create or replace function plateforme.accorder_lectures(
  p_licence uuid, p_nombre integer, p_motif text,
  p_du date default null, p_au date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform() then
    raise exception 'reserve aux operateurs de la plateforme' using errcode = '42501';
  end if;
  if p_nombre <= 0 then
    raise exception 'un supplement se compte en lectures positives'
      using errcode = 'check_violation';
  end if;

  insert into plateforme.interventions
    (licence_id, acte, motif, valeur, effet_du, effet_au)
  values (p_licence, 'supplement_lectures', p_motif, p_nombre,
          coalesce(p_du, date_trunc('month', current_date)::date),
          p_au);

  return jsonb_build_object('licence_id', p_licence, 'lectures_accordees', p_nombre);
end
$$;

-- --- 5. Le droit tient compte des suppléments -------------------------------
--
-- `facturation.droits_v` calculait le droit à partir de la seule grille. On
-- l'enveloppe plutôt que de la réécrire : la grille reste la vérité
-- commerciale, et le supplément est un fait daté qui s'y ajoute.

create or replace view facturation.droits_reels_v as
select
  d.*,
  coalesce(s.supplement, 0)::int               as lectures_supplement,
  (d.lectures_droit + coalesce(s.supplement, 0))::int as lectures_droit_total
from facturation.droits_v d
left join lateral (
  select sum(i.valeur)::int as supplement
  from plateforme.interventions i
  where i.licence_id = d.licence_id
    and i.acte = 'supplement_lectures'
    and coalesce(i.effet_du, '-infinity'::date) <= current_date
    and coalesce(i.effet_au, 'infinity'::date)  >= current_date
) s on true;

comment on view facturation.droits_reels_v is
  'Le droit de la grille, plus les suppléments en vigueur. C''est ce que la '
  'porte `lecture_autorisee` doit lire.';

-- `lecture_autorisee` et la vue de consommation lisent désormais le droit réel.
--
-- `create or replace view` refuse de renommer une colonne : on repose la vue.
-- Aucune autre vue ne s'y adosse, et `lecture_autorisee` est en plpgsql — une
-- fonction ne crée pas de dépendance que PostgreSQL suivrait, elle se
-- recompile au premier appel.
drop view if exists facturation.consommation_v;
create view facturation.consommation_v as
select
  d.licence_id, d.offre_code, d.statut,
  d.lectures_droit_total                                 as lectures_droit,
  d.lectures_droit                                       as lectures_forfait,
  d.lectures_supplement,
  coalesce(c.consommees, 0)::int                         as lectures_consommees,
  greatest(0, d.lectures_droit_total - coalesce(c.consommees, 0))::int
                                                         as lectures_restantes,
  d.organisations, d.sieges_occupes, d.sieges_inclus, d.sieges_max,
  d.prix_mensuel_ht
from facturation.droits_reels_v d
left join lateral (
  select count(*) as consommees
  from facturation.lectures l
  where l.licence_id = d.licence_id
    and l.periode = date_trunc('month', current_date)::date
) c on true;

-- --- 6. Ce que la tour voit --------------------------------------------------
--
-- Une vue par question qu'un opérateur se pose vraiment, et aucune colonne
-- qui ne réponde à l'une d'elles. Toutes sont des compteurs.

create or replace view plateforme.clients_v as
select
  l.id                             as licence_id,
  l.titulaire,
  p.display_name                   as titulaire_nom,
  c.offre_code, c.statut,
  c.organisations, c.sieges_occupes, c.sieges_max,
  c.lectures_droit, c.lectures_consommees, c.lectures_restantes,
  c.prix_mensuel_ht,
  -- Le signal qui compte : depuis quand plus rien n'arrive. Un client qui ne
  -- dépose plus est un client qui part, et il part en silence.
  (select max(pi.created_at) from capture.pieces pi
    join facturation.licence_organisations lo on lo.tenant_id = pi.tenant_id
   where lo.licence_id = l.id)     as derniere_piece_le,
  (select count(*) from facturation.licence_organisations lo
    where lo.licence_id = l.id)    as organisations_rattachees,
  l.created_at                     as cliente_depuis
from facturation.licences l
join facturation.consommation_v c on c.licence_id = l.id
left join identity.profiles p on p.user_id = l.titulaire;

comment on view plateforme.clients_v is
  'Un client, une ligne. Des compteurs uniquement — aucun contenu n''y entre.';

-- --- 7. L'isolation de l'étage ----------------------------------------------
--
-- Ces tables n'ont pas de `tenant_id` : elles sont au-dessus. Elles reçoivent
-- donc leurs politiques à la main, et une seule règle — la plateforme, et
-- personne d'autre.

alter table plateforme.interventions enable row level security;
alter table plateforme.interventions force row level security;
revoke all on table plateforme.interventions from public, anon, service_role;
grant select, insert on table plateforme.interventions to authenticated;
create policy plateforme_interventions_sel on plateforme.interventions
  for select to authenticated using (app.is_platform());
create policy plateforme_interventions_ins on plateforme.interventions
  for insert to authenticated with check (app.is_platform());
create trigger plateforme_interventions_no_upd
  before update or delete on plateforme.interventions
  for each row execute function app.deny_mutation();

alter table plateforme.requisitions enable row level security;
alter table plateforme.requisitions force row level security;
revoke all on table plateforme.requisitions from public, anon, service_role;
grant select, insert, update on table plateforme.requisitions to authenticated;
-- Le client voit les réquisitions qui le concernent, sauf secret imposé par
-- l'autorité. C'est la règle inverse de celle qu'on écrirait par réflexe, et
-- c'est la bonne : il a le droit de savoir qu'on a ouvert son dossier.
create policy plateforme_requisitions_sel on plateforme.requisitions
  for select to authenticated
  using (app.is_platform()
         or (not secret_impose and tenant_id in (select app.member_orgs())));
create policy plateforme_requisitions_ins on plateforme.requisitions
  for insert to authenticated with check (app.is_platform());
create policy plateforme_requisitions_upd on plateforme.requisitions
  for update to authenticated using (app.is_platform()) with check (app.is_platform());

revoke all on function plateforme.suspendre(uuid, text, text) from public, anon;
revoke all on function plateforme.reprendre(uuid, text) from public, anon;
revoke all on function plateforme.accorder_lectures(uuid, integer, text, date, date)
  from public, anon;
grant execute on function plateforme.suspendre(uuid, text, text) to authenticated;
grant execute on function plateforme.reprendre(uuid, text) to authenticated;
grant execute on function plateforme.accorder_lectures(uuid, integer, text, date, date)
  to authenticated;

grant usage on schema plateforme to authenticated;
grant select on plateforme.clients_v to authenticated;
grant select on facturation.droits_reels_v to authenticated;

commit;
