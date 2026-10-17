-- Une licence porte le forfait et ses places.
--
-- ================================================================== POURQUOI
--
-- Le dépôt ne sait pas ce qu'est un abonnement. Aucune table, aucune colonne,
-- aucun contrôle : `grep -ri abonnement db/migrations` ne ramène que le mot au
-- sens comptable (« abonnement téléphonique », une nature de charge). La
-- grille commerciale — Basic 9, Solo 19, Team 29, Premium 49 — vit dans des
-- documents et dans des maquettes. Un produit dont le modèle économique
-- n'existe nulle part dans le code ne peut ni facturer, ni refuser, ni même
-- dire au client ce qu'il lui reste.
--
-- ===================================== POURQUOI UNE LICENCE, ET NON UN TENANT
--
-- Le réflexe serait de poser `abonnement.tenant_id -> identity.organizations`.
-- Il est faux pour Premium : une licence Premium couvre DEUX organisations
-- incluses, puis d'autres à 29 DT. Un abonnement par organisation rendrait
-- Premium inexprimable, et obligerait à additionner des forfaits là où le
-- client en achète un seul.
--
-- La licence se pose donc AU-DESSUS du tenant, et les organisations s'y
-- rattachent. C'est aussi ce que dit la règle commerciale du 17 octobre :
-- « la licence porte le forfait et ses places ; un siège est une place, pas
-- une licence ».
--
-- On ne touche pas à `identity.organizations` : une table de rattachement,
-- avec un unique sur `tenant_id`, dit la même chose sans modifier une table
-- que 94 politiques RLS et une quarantaine de clés étrangères regardent déjà.
--
-- ================================================== POURQUOI LA GRILLE EN BASE
--
-- R8, par analogie : « le modèle est une donnée, pas une constante ». Un prix
-- et un nombre de lectures incluses sont des données du même ordre — ils
-- changent sans qu'une ligne de code bouge, et une pièce lue en octobre doit
-- rester explicable avec la grille d'octobre. D'où `effective_from`, et
-- jamais de `current_date` (R11) : la date est écrite.
--
-- ================================================= CE QUE CETTE MIGRATION NE FAIT PAS
--
-- Elle ne compte aucune lecture et n'en refuse aucune : c'est l'objet de
-- `20261018093000`. Elle ne crée aucune facture : `billing.invoices` existe
-- déjà et n'est pas le sujet. Elle pose le socle et la grille, rien d'autre.

begin;

-- --- 1. La grille, versionnée -----------------------------------------------

create table if not exists ref.offres (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null check (code in ('basic','solo','team','premium')),
  libelle                text not null,
  prix_mensuel_ht        app.money_t not null check (prix_mensuel_ht >= 0),

  -- Les lectures incluses se comptent PAR ORGANISATION. Pour Basic, Solo et
  -- Team il n'y en a qu'une, et le nombre se lit tel quel. Pour Premium,
  -- 120 par organisation, mises en commun : trois sociétés donnent 360 pour
  -- le groupe, et non trois murs de 120. C'est le défaut corrigé le 17
  -- octobre — « 200 lectures nécessaires chez El Manar, bloquées à 120,
  -- pendant que 230 dormaient chez les deux autres ».
  lectures_par_organisation integer not null check (lectures_par_organisation > 0),

  -- Le propriétaire ne consomme pas de place : il détient la licence. En
  -- Premium sur trois sociétés il apparaît trois fois comme dirigeant et
  -- occupe zéro siège. Ces nombres ne comptent donc QUE les collaborateurs.
  sieges_inclus          smallint not null check (sieges_inclus >= 0),
  sieges_max             smallint not null check (sieges_max >= 0),
  prix_siege_sup         app.money_t not null check (prix_siege_sup >= 0),
  lectures_par_siege_sup integer not null check (lectures_par_siege_sup >= 0),

  organisations_incluses smallint not null check (organisations_incluses >= 1),
  organisations_max      smallint not null check (organisations_max >= 1),
  prix_organisation_sup  app.money_t not null check (prix_organisation_sup >= 0),

  effective_from         date not null,
  created_at             timestamptz not null default now(),

  unique (code, effective_from),
  constraint offres_sieges_coherents check (sieges_max >= sieges_inclus),
  constraint offres_organisations_coherentes check (organisations_max >= organisations_incluses)
);

comment on table ref.offres is
  'La grille commerciale, versionnée par date d''effet. Une pièce lue en '
  'octobre reste explicable avec la grille d''octobre.';

-- --- 2. La licence ----------------------------------------------------------

create schema if not exists facturation;

create table if not exists facturation.licences (
  id             uuid primary key default gen_random_uuid(),

  -- Le titulaire est une personne, pas une organisation : c'est lui qui paie,
  -- et c'est son départ — non celui d'une société — qui met la licence en
  -- cause. Il est dirigeant de chacune des organisations rattachées ; la
  -- contrainte s'exprime par déclencheur, plus bas.
  titulaire      uuid not null,

  offre_code     text not null check (offre_code in ('basic','solo','team','premium')),

  -- La date qui choisit la ligne de `ref.offres`. Figée à la souscription :
  -- une hausse de tarif ne doit pas réécrire ce qu'un client a acheté.
  offre_depuis   date not null,

  statut         text not null default 'active'
                 check (statut in ('active','suspendue','resiliee')),

  -- « Perdre sa licence n'arrête pas la caméra » : trente jours de capture
  -- restent ouverts au détachement d'un cabinet. Sur impayé, l'entité devient
  -- inactive — sinon le plafond cesse d'être un levier. Les deux cas se
  -- distinguent par ce motif.
  suspendue_le   timestamptz,
  motif_suspension text check (motif_suspension in ('impaye','detachement_cabinet','demande_client')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint licences_suspension_coherente check (
    (statut = 'suspendue') = (suspendue_le is not null)
  )
);

create index licences_titulaire_idx on facturation.licences (titulaire);

create trigger licences_touch before update on facturation.licences
  for each row execute function app.touch_updated_at();

-- --- 3. Les organisations d'une licence -------------------------------------
--
-- L'unique sur `tenant_id` dit l'essentiel : une organisation appartient à
-- exactement une licence. Sans lui, un groupe pourrait apparaître dans deux
-- forfaits et consommer deux fois le même quota.

create table if not exists facturation.licence_organisations (
  licence_id  uuid not null references facturation.licences(id) on delete restrict,
  tenant_id   uuid not null unique references identity.organizations(id) on delete cascade,
  rattachee_le timestamptz not null default now(),
  primary key (licence_id, tenant_id)
);

comment on column facturation.licence_organisations.licence_id is
  'ON DELETE RESTRICT : on ne supprime pas une licence qui porte encore des '
  'organisations. La résiliation est un statut, pas un DELETE — dix ans de '
  'conservation l''exigent.';

-- --- 4. Le droit d'une licence, calculé ------------------------------------
--
-- Une vue plutôt qu'une colonne : le droit se déduit de l'offre, du nombre
-- d'organisations rattachées et du nombre de sièges occupés. Le stocker
-- obligerait à le recalculer à chaque invitation, à chaque rattachement, et
-- à chaque révocation — trois endroits pour une seule vérité.

create or replace view facturation.droits_v as
select
  l.id                                        as licence_id,
  l.titulaire,
  l.offre_code,
  l.statut,
  o.libelle                                   as offre_libelle,
  count(distinct lo.tenant_id)::int           as organisations,
  o.organisations_max,
  -- Les sièges occupés : les collaborateurs, sur toutes les organisations de
  -- la licence, chaque personne comptée une seule fois même si elle siège
  -- dans deux sociétés du groupe. Le dirigeant n'en est pas.
  count(distinct m.user_id) filter (where m.role = 'collaborateur')::int as sieges_occupes,
  o.sieges_inclus,
  o.sieges_max,
  -- Le droit en lectures : le forfait par organisation, multiplié par les
  -- organisations rattachées, plus le bonus des sièges au-delà des inclus.
  (o.lectures_par_organisation * count(distinct lo.tenant_id)
   + o.lectures_par_siege_sup
     * greatest(0, count(distinct m.user_id) filter (where m.role = 'collaborateur')
                   - o.sieges_inclus))::int   as lectures_droit,
  -- Le prix dû, pour que l'écran puisse le dire sans refaire l'arithmétique.
  (o.prix_mensuel_ht
   + o.prix_siege_sup
     * greatest(0, count(distinct m.user_id) filter (where m.role = 'collaborateur')
                   - o.sieges_inclus)
   + o.prix_organisation_sup
     * greatest(0, count(distinct lo.tenant_id) - o.organisations_incluses)
  )                                           as prix_mensuel_ht
from facturation.licences l
join lateral (
  select * from ref.offres r
  where r.code = l.offre_code and r.effective_from <= l.offre_depuis
  order by r.effective_from desc limit 1
) o on true
left join facturation.licence_organisations lo on lo.licence_id = l.id
left join identity.memberships m on m.tenant_id = lo.tenant_id
group by l.id, l.titulaire, l.offre_code, l.statut, o.libelle,
         o.organisations_max, o.sieges_inclus, o.sieges_max,
         o.lectures_par_organisation, o.lectures_par_siege_sup,
         o.prix_mensuel_ht, o.prix_siege_sup, o.organisations_incluses,
         o.prix_organisation_sup;

comment on view facturation.droits_v is
  'Ce à quoi une licence donne droit, déduit et jamais stocké.';

-- --- 5. L'isolation ---------------------------------------------------------
--
-- `facturation.licence_organisations` porte `tenant_id` : elle passe sous le
-- régime commun (R6). `facturation.licences` n'en porte pas — elle est
-- au-dessus — et reçoit donc sa politique à la main : son titulaire la voit,
-- l'exploitant aussi, personne d'autre.

select app.enable_tenant_rls('facturation', 'licence_organisations', false, false);

alter table facturation.licences enable row level security;
alter table facturation.licences force row level security;
revoke all on table facturation.licences from public, anon, service_role;
grant select on table facturation.licences to authenticated;

create policy facturation_licences_sel on facturation.licences
  for select to authenticated
  using (titulaire = auth.uid() or app.is_platform());

-- `ref.offres` est un référentiel public au même titre que `ref.accounts` :
-- tout le monde lit la grille, personne ne l'écrit depuis l'application.
alter table ref.offres enable row level security;
revoke all on table ref.offres from public, anon, service_role;
grant select on table ref.offres to authenticated;
create policy ref_offres_sel on ref.offres for select to authenticated using (true);

-- --- 6. La grille du 17 octobre 2026 ----------------------------------------
--
-- R11 : la date est écrite, pas calculée. Ces cinq lignes sont la grille
-- corrigée du 17 octobre — celle où le croisement Team/Premium est mort, où
-- le siège vaut 8 DT partout, et où le quota se met en commun.
--
-- Montants en dinars hors taxe. `app.money_t` est un numeric(38,3) : 9 DT
-- s'écrit 9.000, et le millime est la plus petite unité du pays.

insert into ref.offres
  (code, libelle, prix_mensuel_ht, lectures_par_organisation,
   sieges_inclus, sieges_max, prix_siege_sup, lectures_par_siege_sup,
   organisations_incluses, organisations_max, prix_organisation_sup,
   effective_from)
values
  ('basic',   'Basic',    9.000,  65, 0,  0, 0.000,  0, 1,  1,  0.000, date '2026-10-17'),
  ('solo',    'Solo',    19.000, 120, 0,  0, 0.000,  0, 1,  1,  0.000, date '2026-10-17'),
  ('team',    'Team',    29.000, 160, 2, 10, 8.000, 25, 1,  1,  0.000, date '2026-10-17'),
  ('premium', 'Premium', 49.000, 120, 4, 20, 8.000, 25, 2, 10, 29.000, date '2026-10-17')
on conflict (code, effective_from) do nothing;

-- --- 7. Le titulaire dirige ce qu'il rattache -------------------------------
--
-- Une organisation ne rejoint une licence que si son titulaire y est
-- dirigeant. Sans ce contrôle, un client pourrait rattacher la société d'un
-- autre à son forfait et lui consommer son quota.

create or replace function facturation.rattachement_legitime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulaire uuid;
begin
  select titulaire into v_titulaire
    from facturation.licences where id = new.licence_id;

  if not exists (
    select 1 from identity.memberships m
    where m.tenant_id = new.tenant_id
      and m.user_id = v_titulaire
      and m.role = 'dirigeant'
  ) then
    raise exception
      'le titulaire de la licence n''est pas dirigeant de cette organisation'
      using errcode = 'check_violation';
  end if;

  -- Le plafond d'organisations de l'offre, lu sur la grille en vigueur.
  if (select organisations from facturation.droits_v where licence_id = new.licence_id)
     >= (select organisations_max from facturation.droits_v where licence_id = new.licence_id)
  then
    raise exception 'cette offre ne porte pas une organisation de plus'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger licence_organisations_legitime
  before insert on facturation.licence_organisations
  for each row execute function facturation.rattachement_legitime();

commit;
