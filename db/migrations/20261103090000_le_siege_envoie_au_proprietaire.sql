-- Le siège envoie au propriétaire (« Malica sans blocage », lot 4).
--
-- Décisions du dirigeant, 18 et 28 octobre 2026 (docs/sans-blocage.md §1-§3,
-- maquette « Matrice des droits ») : UN SEUL CIRCUIT, DEUX FOIS — siège →
-- propriétaire → comptable. Le propriétaire est au siège ce que le comptable
-- est au propriétaire : il reçoit, voit (« Vue par {prénom} », à l'ouverture),
-- retourne avec un motif gouverné et une note, accorde ou refuse les demandes.
--
-- Relevé sur la base de test le 28 octobre (colonne « Aujourd'hui ») :
--   - le siège voyait TOUTES les pièces de la société, et celles chez le comptable ;
--   - il envoyait au comptable, même la pièce d'un autre, et pouvait « Garder » ;
--   - il supprimait la pièce d'un autre siège ;
--   - le retour du comptable sur sa pièce ne lui apparaissait pas ;
--   - « Envoyer au propriétaire », sa « Vue », son retour, ses demandes
--     n'existaient pas ; rendre une pièce de la société à Mon espace lui était
--     refusé ; son départ n'était pas défini (il restait bloqué par son espace
--     privé, que la société n'a jamais le droit de lire).
--
-- Ce que ce fichier pose :
--   1. Les DROITS vivent au référentiel (`ref.droits`, `ref.droits_des_roles`),
--      par type d'organisation et rôle d'adhésion, datés : aucun nom de rôle
--      n'est plus écrit dans une règle du circuit. `app.a_le_droit`,
--      `app.orgs_avec_droit` et `app.droits_dans` sont leurs seules lectures.
--   2. La visibilité (R6) : un membre sans `societe.tout_voir` ne lit que les
--      pièces qu'il a faites ; Mon espace reste à son auteur seul.
--   3. Le passage siège → propriétaire est un registre de FAITS en ajout seul
--      (`capture.circuit` : envoyée, retournée, rappelée) ; la « Vue » du
--      propriétaire est une ligne de `capture.vues` dont l'organisation qui a
--      vu est la société elle-même — l'index unique y tient la concurrence
--      (deux propriétaires qui ouvrent ensemble donnent UNE vue).
--   4. Les mêmes portes servent les deux passages : `piece_envoyer`,
--      `piece_voir`, `piece_retourner`, `piece_retour` (la carte),
--      `piece_renvoyer`, `piece_demander`, `piece_repondre`. Chacune choisit
--      le passage d'après les droits de l'appelant, jamais d'après l'écran.
--   5. Transmettre au comptable exige `envoi.cabinet` : un déclencheur sur la
--      table, une règle écrite une fois, quelle que soit la porte.
--   6. Le départ d'un siège : sa place se libère toujours ; ses pièces de la
--      société restent à la société, son Mon espace part avec son compte (il
--      reste lisible de lui seul). Aucun fait n'est effacé.
--   7. Les notifications suivent la pièce : on ne lit que celles d'une pièce
--      qu'on lit, ou celles qui nous sont adressées. Les écritures aussi : un
--      siège ne lit pas, par la porte de service, l'écriture d'une pièce
--      qu'il ne voit pas.
--   8. Une pièce prise en charge se demande (spec §3) : le comptable qui
--      accorde contre-passe son écriture au journal du jour, puis la pièce
--      revient à la société, ou s'archive. Seul un RÈGLEMENT inscrit retient
--      la demande : il s'annule d'abord.

begin;

-- --- 1. Les droits, au référentiel ---------------------------------------------------------------

create table if not exists ref.droits (
  code       text primary key,
  sort_order smallint not null
);

comment on table ref.droits is
  'Les gestes gouvernés du circuit siège → propriétaire → comptable (Malica sans blocage, lot 4).';

alter table ref.droits enable row level security;
alter table ref.droits force row level security;
revoke all on table ref.droits from public, anon;
grant select on table ref.droits to authenticated;
drop policy if exists ref_droits_sel on ref.droits;
create policy ref_droits_sel on ref.droits for select to authenticated using (true);

create table if not exists ref.droits_des_roles (
  -- Le type d'organisation : un « collaborateur » de cabinet n'est pas un siège.
  org_kind   text not null,
  -- Le rôle d'adhésion (`identity.memberships.role`).
  role       text not null,
  droit      text not null references ref.droits(code),
  valid_from date not null,
  valid_to   date,
  primary key (org_kind, role, droit, valid_from),
  constraint droits_des_roles_periode check (valid_to is null or valid_to > valid_from)
);

comment on table ref.droits_des_roles is
  'Qui peut quoi, par type d''organisation et rôle d''adhésion, daté. Changer un droit est une ligne, jamais un déploiement.';

alter table ref.droits_des_roles enable row level security;
alter table ref.droits_des_roles force row level security;
revoke all on table ref.droits_des_roles from public, anon;
grant select on table ref.droits_des_roles to authenticated;
drop policy if exists ref_droits_des_roles_sel on ref.droits_des_roles;
create policy ref_droits_des_roles_sel on ref.droits_des_roles
  for select to authenticated using (true);

insert into ref.droits (code, sort_order) values
  ('societe.tout_voir',       10),
  ('envoi.proprietaire',      20),
  ('envoi.cabinet',           30),
  ('piece.garder',            40),
  ('circuit.recevoir',        50),
  ('piece.supprimer_toutes',  60)
on conflict (code) do nothing;

-- Le 28 octobre 2026 : la décision du dirigeant. Un cabinet garde, sur ses
-- propres pièces, ce que ses membres avaient avant ce lot : tout voir,
-- transmettre, garder, supprimer.
insert into ref.droits_des_roles (org_kind, role, droit, valid_from) values
  ('pme',     'dirigeant',     'societe.tout_voir',      date '2026-10-28'),
  ('pme',     'dirigeant',     'envoi.cabinet',          date '2026-10-28'),
  ('pme',     'dirigeant',     'piece.garder',           date '2026-10-28'),
  ('pme',     'dirigeant',     'circuit.recevoir',       date '2026-10-28'),
  ('pme',     'dirigeant',     'piece.supprimer_toutes', date '2026-10-28'),
  ('pme',     'collaborateur', 'envoi.proprietaire',     date '2026-10-28'),
  ('cabinet', 'expert',        'societe.tout_voir',      date '2026-10-28'),
  ('cabinet', 'expert',        'envoi.cabinet',          date '2026-10-28'),
  ('cabinet', 'expert',        'piece.garder',           date '2026-10-28'),
  ('cabinet', 'expert',        'piece.supprimer_toutes', date '2026-10-28'),
  ('cabinet', 'collaborateur', 'societe.tout_voir',      date '2026-10-28'),
  ('cabinet', 'collaborateur', 'envoi.cabinet',          date '2026-10-28'),
  ('cabinet', 'collaborateur', 'piece.garder',           date '2026-10-28'),
  ('cabinet', 'collaborateur', 'piece.supprimer_toutes', date '2026-10-28'),
  ('cabinet', 'assistant',     'societe.tout_voir',      date '2026-10-28'),
  ('cabinet', 'assistant',     'envoi.cabinet',          date '2026-10-28'),
  ('cabinet', 'assistant',     'piece.garder',           date '2026-10-28'),
  ('cabinet', 'assistant',     'piece.supprimer_toutes', date '2026-10-28')
on conflict do nothing;

-- Les organisations où l'appelant tient ce droit, aujourd'hui. Une clé d'API
-- agit pour son organisation entière, comme `app.member_orgs()` le dit déjà.
-- Sans corrélation : sous `tenant_id in (select …)`, la politique la hache une
-- fois par requête.
create or replace function app.orgs_avec_droit(p_droit text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from identity.memberships m
    join identity.organizations o on o.id = m.tenant_id
    join ref.droits_des_roles d
      on d.org_kind = o.kind and d.role = m.role and d.droit = p_droit
     and d.valid_from <= current_date
     and (d.valid_to is null or d.valid_to > current_date)
   where app.api_tenant() is null
     and m.user_id = auth.uid()
  union all
  select app.api_tenant()
   where app.api_tenant() is not null
$$;

revoke all on function app.orgs_avec_droit(text) from public, anon;
grant execute on function app.orgs_avec_droit(text) to authenticated;

create or replace function app.a_le_droit(p_org uuid, p_droit text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org in (select app.orgs_avec_droit(p_droit))
$$;

revoke all on function app.a_le_droit(uuid, text) from public, anon;
grant execute on function app.a_le_droit(uuid, text) to authenticated;

-- Les droits de l'appelant dans une organisation : ce que l'écran montre.
-- L'écran ne décide rien — chaque porte refait le contrôle.
create or replace function app.droits_dans(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(d.code order by d.sort_order), '{}')
    from ref.droits d
   where app.a_le_droit(p_org, d.code)
$$;

revoke all on function app.droits_dans(uuid) from public, anon;
grant execute on function app.droits_dans(uuid) to authenticated;

-- Les personnes qui reçoivent les pièces des sièges, dans cette société.
create or replace function app.receveurs_du_circuit(p_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
    from identity.memberships m
    join identity.organizations o on o.id = m.tenant_id
    join ref.droits_des_roles d
      on d.org_kind = o.kind and d.role = m.role and d.droit = 'circuit.recevoir'
     and d.valid_from <= current_date
     and (d.valid_to is null or d.valid_to > current_date)
   where m.tenant_id = p_org
$$;

revoke all on function app.receveurs_du_circuit(uuid) from public, anon;

-- « Vue par {prénom} » : le prénom au moment du fait ; à défaut, le nom
-- d'affichage, jamais un prénom deviné.
create or replace function app.prenom_au_moment(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(pr.prenom), '') from identity.profiles pr where pr.user_id = p_user),
    app.nom_au_moment(p_user))
$$;

revoke all on function app.prenom_au_moment(uuid) from public, anon;

-- --- 2. Qui lit quelle pièce (R6) ----------------------------------------------------------------
--
-- La SEULE règle de lecture d'une pièce, reprise de `20261029140000` : la
-- société entière ne se lit plus que par `societe.tout_voir`. Un siège lit ce
-- qu'il a fait — dans la société comme chez le comptable. Mon espace : son
-- auteur seul, même pour le patron (décision du 18 octobre maintenue).

create or replace function app.piece_lisible(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from capture.pieces p
    -- La version courante juge : une version précédente n'a pas de
    -- visibilité propre.
    where p.id = app.version_courante(p_piece)
      and (
        (p.archivee_le is null and (
             (p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
          or (p.vis in ('entite'::app.vis_t, 'partage'::app.vis_t) and (
                p.tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
                or (p.tenant_id in (select app.member_orgs()) and p.created_by = auth.uid())))
          or (p.vis = 'partage'::app.vis_t and p.tenant_id in (select app.engaged_orgs()))))
        or (p.archivee_le is not null
            and p.tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(p.id))
        -- L'exception, et elle est nommée.
        or app.plateforme_requise(p.tenant_id)
      )
  )
$$;

drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    case
      when app.piece_remplacee(id) then app.piece_lisible(id)
      else (
        (archivee_le is null and (
             (vis = 'personnel'::app.vis_t and created_by = auth.uid())
          or (vis in ('entite'::app.vis_t, 'partage'::app.vis_t) and (
                tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
                or (tenant_id in (select app.member_orgs()) and created_by = auth.uid())))
          or (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))))
        or (archivee_le is not null
            and tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(id))
        or app.plateforme_requise(tenant_id))
    end);

-- Modifier ou effacer une ligne exige d'abord de la lire : un siège ne touche
-- pas, même par la table, la pièce d'un autre.
drop policy if exists capture_pieces_upd on capture.pieces;
create policy capture_pieces_upd on capture.pieces
  for update to authenticated
  using (tenant_id in (select app.member_orgs()) and app.piece_lisible(id))
  with check (tenant_id in (select app.member_orgs()));

drop policy if exists capture_pieces_del on capture.pieces;
create policy capture_pieces_del on capture.pieces
  for delete to authenticated
  using (tenant_id in (select app.member_orgs()) and app.piece_lisible(id));

-- --- 2 bis. La chaîne des versions se lit sans la RLS de l'appelant ---------------------------------
--
-- Trouvé en éprouvant ce lot (le 30 octobre 2026, sur une base de test de
-- 2 115 pièces) : `rattachements_v` mettait 5,2 s à rendre UNE ligne, et la
-- suite tombait sur « statement timeout ». La cause précède ce lot :
-- `app.version_courante` et `app.versions_de_la_piece` parcouraient
-- `capture.remplacements` SOUS LA RLS de l'appelant, dont la politique appelle
-- `app.piece_lisible` par ligne — qui appelle à son tour
-- `app.version_courante`. Chaque appel relisait tout le registre, toutes
-- sociétés confondues : un coût quadratique, que la règle de lecture de ce lot
-- (un appel de plus par ligne) a fait franchir le délai.
--
-- La chaîne des versions est une STRUCTURE (des identifiants qui se suivent),
-- pas un contenu : elle se lit en `security definer`, et chaque appelant juge
-- ensuite la lisibilité de ce qu'il en tire, comme avant. Mesuré : 5 172 ms →
-- 6 ms. Et la version courante devient juste pour qui ne lit pas le fait de
-- remplacement : elle ne s'arrête plus à mi-chemin.
alter function app.version_courante(uuid) security definer;
alter function app.versions_de_la_piece(uuid) security definer;

-- --- 3. Le passage siège → propriétaire, en faits ------------------------------------------------

create table if not exists capture.circuit (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references identity.organizations(id) on delete cascade,
  piece_id  uuid not null references capture.pieces(id) on delete cascade,
  -- envoyée : le siège l'envoie (ou la renvoie) au propriétaire ;
  -- retournée : le propriétaire la lui retourne, motif et note ;
  -- rappelée : une demande de récupération accordée la rend au siège.
  fait      text not null check (fait in ('envoyee', 'retournee', 'rappelee')),
  par       uuid,
  -- Le prénom au moment du fait : un compte renommé ne réécrit pas l'histoire.
  par_nom   text,
  motif_id  uuid references ref.rejet_motifs(id),
  note      text,
  le        timestamptz not null default now(),
  constraint circuit_retour_motive check (fait <> 'retournee' or motif_id is not null)
);

create index if not exists circuit_tenant_piece_idx on capture.circuit (tenant_id, piece_id, le desc);
create index if not exists circuit_piece_idx on capture.circuit (piece_id, le desc);
create index if not exists circuit_motif_id_fk_idx on capture.circuit (motif_id);

select app.enable_tenant_rls('capture', 'circuit', false, true);

-- Personne ne l'écrit à la main : les portes du circuit sont ses seules entrées.
revoke insert, update, delete on table capture.circuit from authenticated;

-- Il se lit avec la pièce, et seulement dans la société : le comptable n'a pas
-- à savoir ce que se disent le siège et le propriétaire.
drop policy if exists capture_circuit_sel on capture.circuit;
create policy capture_circuit_sel on capture.circuit
  for select to authenticated
  using (tenant_id in (select app.member_orgs()) and app.piece_lisible(piece_id));

-- Un fait ne se modifie pas (R7) ; il part seulement avec sa pièce.
drop trigger if exists capture_circuit_no_upd on capture.circuit;
create trigger capture_circuit_no_upd
  before update or delete on capture.circuit
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists pas_de_geste_sur_une_version_precedente on capture.circuit;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.circuit
  for each row execute function app.pas_de_geste_sur_une_version_precedente();

comment on table capture.circuit is
  'Le passage siège → propriétaire : envoyée, retournée (motif, note), rappelée. En ajout seul (Malica sans blocage, lot 4).';

-- La « Vue » du propriétaire : l'organisation qui a vu est la société elle-même.
comment on column capture.vues.cabinet_org_id is
  'L''organisation qui a vu : le cabinet engagé, ou la société elle-même quand un propriétaire ouvre la pièce d''un siège.';

-- Le cabinet ne lit que ses vues ; la société, les siennes sur les pièces
-- qu'elle lit.
drop policy if exists capture_vues_sel on capture.vues;
create policy capture_vues_sel on capture.vues
  for select to authenticated
  using ((cabinet_org_id in (select app.member_orgs())
          and (cabinet_org_id <> tenant_id or app.piece_lisible(piece_id)))
         or (select app.is_platform()));

-- Le dernier fait du passage, toutes versions confondues (une photo reprise
-- hérite du passage de l'ancienne). Rien pour qui ne lit pas la pièce : les
-- portes `security invoker` l'appellent sous l'identité de la personne.
create or replace function app.dernier_fait_du_circuit(p_piece uuid)
returns table (fait text, le timestamptz, par uuid, par_nom text, motif_id uuid, note text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.fait, c.le, c.par, c.par_nom, c.motif_id, c.note
    from capture.circuit c
   where c.piece_id in (select app.versions_de_la_piece(p_piece))
     and app.piece_lisible(p_piece)
     and c.tenant_id in (select app.member_orgs())
   order by c.le desc, c.id desc
   limit 1
$$;

revoke all on function app.dernier_fait_du_circuit(uuid) from public, anon;
grant execute on function app.dernier_fait_du_circuit(uuid) to authenticated;

-- Le dernier envoi au propriétaire ; `null` si la pièce n'y est jamais partie.
create or replace function app.dernier_envoi_au_proprietaire(p_piece uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(c.le) from capture.circuit c
   where c.piece_id in (select app.versions_de_la_piece(p_piece)) and c.fait = 'envoyee'
$$;

revoke all on function app.dernier_envoi_au_proprietaire(uuid) from public, anon;

-- La dernière correction de l'AUTEUR après son dernier envoi au propriétaire :
-- une précision qu'il a posée, ou une photo qu'il a reprise. Celle que le
-- propriétaire pose lui-même n'en est pas une — il l'a sous les yeux.
create or replace function app.corrigee_par_l_auteur(p_piece uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select created_by as auteur, app.dernier_envoi_au_proprietaire(p_piece) as envoyee_le
      from capture.pieces where id = app.version_courante(p_piece)
  ),
  c as (
    select pr.decided_at as le, pr.decided_by as par
      from capture.precisions pr
     where pr.piece_id in (select app.versions_de_la_piece(p_piece))
    union all
    select r.created_at, r.auteur
      from capture.remplacements r
     where r.remplacee_par in (select app.versions_de_la_piece(p_piece))
  )
  select max(c.le) from c, p
   where p.envoyee_le is not null and c.le > p.envoyee_le and c.par = p.auteur
$$;

revoke all on function app.corrigee_par_l_auteur(uuid) from public, anon;

-- Ce que la société lit du passage siège → propriétaire (le pendant de
-- `app.suivi_de_la_piece` pour le comptable). Le Socle en dérive le mot
-- (`statut-d-envoi.ts`) : « Envoyée au propriétaire · Vue par {prénom} ·
-- Retour de {prénom} » côté siège ; « Reçue · Corrigée · Retournée à {prénom} »
-- côté propriétaire. `recoit` dit de quel côté est l'appelant.
drop function if exists app.circuit_de_la_piece(uuid);
create or replace function app.circuit_de_la_piece(p_piece uuid)
returns table (
  recoit       boolean,
  dernier      text,
  envoyee_le   timestamptz,
  vue_le       timestamptz,
  vue_par      text,
  retournee_le timestamptz,
  retour_par   text,
  corrigee_le  timestamptz,
  auteur       text,
  mienne       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_auteur uuid;
  v_fait   record;
begin
  if not app.piece_lisible(p_piece) then
    return;
  end if;
  select tenant_id, created_by into v_tenant, v_auteur
    from capture.pieces where id = app.version_courante(p_piece);
  -- Le comptable ne lit pas ce passage : il n'en est pas.
  if v_tenant not in (select app.member_orgs()) then
    return;
  end if;

  recoit := app.a_le_droit(v_tenant, 'circuit.recevoir');
  auteur := app.prenom_au_moment(v_auteur);
  mienne := v_auteur is not distinct from auth.uid();

  select * into v_fait from app.dernier_fait_du_circuit(p_piece);
  dernier := v_fait.fait;
  envoyee_le := app.dernier_envoi_au_proprietaire(p_piece);

  select v.vue_le, v.par_nom into vue_le, vue_par
    from capture.vues v
   where v.piece_id in (select app.versions_de_la_piece(p_piece))
     and v.cabinet_org_id = v.tenant_id
   order by v.vue_le desc
   limit 1;

  select c.le, c.par_nom into retournee_le, retour_par
    from capture.circuit c
   where c.piece_id in (select app.versions_de_la_piece(p_piece)) and c.fait = 'retournee'
   order by c.le desc
   limit 1;

  corrigee_le := app.corrigee_par_l_auteur(p_piece);
  return next;
end
$$;

revoke all on function app.circuit_de_la_piece(uuid) from public, anon;
grant execute on function app.circuit_de_la_piece(uuid) to authenticated;

-- --- 4. Le suivi du comptable ne lit que SES vues -------------------------------------------------
--
-- Repris de `20261101090000` : la vue d'un propriétaire n'est pas celle du
-- cabinet (`cabinet_org_id <> tenant_id`).

create or replace function app.suivi_de_la_piece(p_piece uuid)
returns table (
  envoyee_le  timestamptz,
  vue_le      timestamptz,
  vue_par     text,
  corrigee_le timestamptz,
  prise_le    timestamptz,
  prise       text,
  prise_par   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_client boolean;
  v_ecriture uuid;
  v_cabinet  uuid;
begin
  if not app.piece_lisible(p_piece) then
    return;
  end if;
  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = app.version_courante(p_piece);
  -- Client SEULEMENT : membre de la société sans superviser son dossier.
  v_client := v_tenant in (select app.member_orgs())
              and not app.supervise_le_dossier(v_tenant);

  if v_vis = 'partage'::app.vis_t then
    envoyee_le := app.dernier_envoi(p_piece);
  end if;

  select v.vue_le, o.name into vue_le, vue_par
    from capture.vues v
    join identity.organizations o on o.id = v.cabinet_org_id
   where v.piece_id in (select app.versions_de_la_piece(p_piece))
     -- La vue d'un propriétaire (lot 4) n'est pas celle du cabinet.
     and v.cabinet_org_id <> v.tenant_id
   order by v.vue_le desc
   limit 1;

  corrigee_le := app.corrigee_par_le_client(p_piece);

  v_ecriture := app.ecriture_prise_en_charge_de(p_piece);
  if v_ecriture is not null then
    select pc.tenant_id, pc.prise_le, pc.par_nom
      into v_cabinet, prise_le, prise_par
      from socle.prises_en_charge pc
     where pc.ecriture_id = v_ecriture
     order by pc.prise_le desc
     limit 1;
    select x.origine into prise from app.ecriture_prise_en_charge(v_cabinet, v_ecriture) x;
  end if;
  -- Le client lit « Prise en charge » ; le nom du comptable reste au cabinet.
  if v_client then
    prise_par := null;
  end if;

  return next;
end
$$;

-- --- 5. Transmettre au comptable : `envoi.cabinet`, une fois, sur la table -------------------------
--
-- Quelle que soit la porte (`capture_piece_set_vis`, `capture_piece_register`,
-- une mise à jour directe), une pièce d'une société n'entre chez le comptable
-- que par qui en a le droit. Deux exceptions, nommées : la photo qui en
-- remplace une déjà partie (`piece_remplacer` : ce n'est pas un envoi), et la
-- pièce issue d'une autre (reçu, justificatif) qui suit sa source. Sans
-- identité (une migration, une maintenance), rien n'est jugé.

create or replace function app.seul_qui_en_a_le_droit_transmet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vis = 'partage'::app.vis_t
     and (tg_op = 'INSERT' or old.vis is distinct from new.vis)
     and coalesce(current_setting('malica.remplacement', true), '') <> new.id::text
     and new.source_piece_id is null
     and (auth.uid() is not null or app.api_tenant() is not null)
     and not app.a_le_droit(new.tenant_id, 'envoi.cabinet') then
    raise exception 'refus.envoi.reserve_au_proprietaire'
      using errcode = '42501', hint = 'envoi.proprietaire';
  end if;
  return new;
end
$$;

revoke all on function app.seul_qui_en_a_le_droit_transmet() from public, anon, authenticated;

drop trigger if exists seul_qui_en_a_le_droit_transmet on capture.pieces;
create trigger seul_qui_en_a_le_droit_transmet
  before insert or update of vis on capture.pieces
  for each row execute function app.seul_qui_en_a_le_droit_transmet();

-- --- 6. Envoyer : un geste, deux passages ----------------------------------------------------------

-- Notifier les propriétaires, chacun la sienne : la pièce d'un siège ne se
-- lit que d'eux et de lui.
create or replace function app.notifier_les_receveurs(p_tenant uuid, p_kind text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into collab.notifications (tenant_id, user_id, kind, payload)
  select p_tenant, r, p_kind, p_payload
    from app.receveurs_du_circuit(p_tenant) r
   where r is distinct from auth.uid()
     -- Seul un membre de la société prévient ses propriétaires.
     and p_tenant in (select app.member_orgs())
$$;

revoke all on function app.notifier_les_receveurs(uuid, text, jsonb) from public, anon;
grant execute on function app.notifier_les_receveurs(uuid, text, jsonb) to authenticated;

-- Le siège envoie au propriétaire (ou lui renvoie, après un retour).
create or replace function app.envoyer_au_proprietaire(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_auteur uuid;
  v_dernier text;
  v_le     timestamptz;
begin
  select tenant_id, vis, created_by into v_tenant, v_vis, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or not app.piece_lisible(p_piece)
     or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not app.a_le_droit(v_tenant, 'envoi.proprietaire') then
    raise exception 'refus.envoi.proprietaire.droit' using errcode = '42501';
  end if;
  -- Le siège envoie les siennes.
  if v_auteur is distinct from auth.uid() then
    raise exception 'refus.envoi.proprietaire.pas_la_sienne' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  -- Mon espace : il la met d'abord dans la société. Chez le comptable : elle
  -- y est déjà, par le propriétaire.
  if v_vis <> 'entite'::app.vis_t then
    raise exception 'refus.envoi.proprietaire.hors_societe' using errcode = 'check_violation';
  end if;

  select fait, le into v_dernier, v_le from app.dernier_fait_du_circuit(p_piece);
  -- Le doigt ripe : elle est déjà chez le propriétaire, rien de nouveau.
  if v_dernier = 'envoyee' then
    return jsonb_build_object('piece_id', p_piece, 'le', v_le, 'deja', true, 'chez', 'proprietaire');
  end if;

  insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
  values (v_tenant, p_piece, 'envoyee', auth.uid(), app.prenom_au_moment(auth.uid()))
  returning le into v_le;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(),
          case when v_dernier = 'retournee' then 'piece.renvoyee_au_proprietaire'
               else 'piece.envoyee_au_proprietaire' end,
          'capture', 'pieces', p_piece, '{}'::jsonb);

  perform app.notifier_les_receveurs(v_tenant, 'piece.recue_du_siege',
                                     jsonb_build_object('piece_id', p_piece,
                                                        'renvoi', v_dernier = 'retournee'));

  return jsonb_build_object('piece_id', p_piece, 'le', v_le, 'deja', false, 'chez', 'proprietaire');
end
$$;

revoke all on function app.envoyer_au_proprietaire(uuid) from public, anon;
grant execute on function app.envoyer_au_proprietaire(uuid) to authenticated;

-- LE geste « Envoyer ». Le siège envoie au propriétaire ; qui a `envoi.cabinet`
-- transmet au comptable (une pièce retournée par le comptable se renvoie).
create or replace function public.piece_envoyer(p_piece uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_r      jsonb;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    if v_vis = 'partage'::app.vis_t and v_status = 'retournee' then
      return public.piece_renvoyer(p_piece) || jsonb_build_object('chez', 'cabinet');
    end if;
    v_r := public.capture_piece_set_vis(p_piece, 'partage'::app.vis_t);
    return jsonb_build_object('piece_id', p_piece, 'le', now(),
                              'deja', not (v_r ->> 'changed')::boolean, 'chez', 'cabinet');
  end if;
  return app.envoyer_au_proprietaire(p_piece);
end
$$;

revoke all on function public.piece_envoyer(uuid) from public, anon;
grant execute on function public.piece_envoyer(uuid) to authenticated;

-- « Renvoyer » : la même porte que la carte de retour. Côté comptable, repris
-- de `20261029100000` avec le droit de transmettre ; côté propriétaire, le
-- siège la lui renvoie.
create or replace function public.piece_renvoyer(p_piece uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Le retour du propriétaire : le siège la lui renvoie.
  if v_vis = 'entite'::app.vis_t
     and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'retournee' then
    return app.envoyer_au_proprietaire(p_piece);
  end if;

  if v_vis <> 'partage'::app.vis_t or v_status <> 'retournee' then
    raise exception 'refus.renvoi.sans_retour' using errcode = 'check_violation';
  end if;
  -- Seul qui transmet au comptable lui renvoie : le siège fait le geste, le
  -- propriétaire renvoie.
  if not app.a_le_droit(v_tenant, 'envoi.cabinet') then
    raise exception 'refus.envoi.reserve_au_proprietaire'
      using errcode = '42501', hint = 'envoi.proprietaire';
  end if;

  perform app.piece_oublie_ses_propositions(p_piece);

  update capture.pieces
     set status = app.statut_hors_retour(p_piece), updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.renvoyee', 'capture', 'pieces', p_piece, '{}'::jsonb);

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.renvoyee', jsonb_build_object('piece_id', p_piece));

  return jsonb_build_object('piece_id', p_piece, 'le', now());
end
$$;

-- --- 7. Ouvrir, c'est voir — des deux côtés -------------------------------------------------------

create or replace function public.piece_voir(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_cabinet uuid;
  v_archivee timestamptz;
  v_depuis  timestamptz;
  v_le      timestamptz;
begin
  select tenant_id, vis, archivee_le into v_tenant, v_vis, v_archivee
    from capture.pieces where id = p_piece;

  -- Dans la société : le propriétaire qui ouvre la pièce qu'un siège lui a
  -- envoyée la « voit ». Ouvrir n'importe quelle autre pièce de la société
  -- n'écrit rien, et ne refuse rien : l'écran ouvre, la base décide.
  if v_tenant is not null and v_tenant in (select app.member_orgs())
     and app.piece_lisible(p_piece) then
    if v_vis <> 'entite'::app.vis_t
       or v_archivee is not null
       or not app.a_le_droit(v_tenant, 'circuit.recevoir')
       or exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
       or (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      return jsonb_build_object('piece_id', p_piece, 'vue_le', null, 'deja', false);
    end if;
    -- Une « Vue » par envoi et par correction de l'auteur — la première, quel
    -- que soit le propriétaire : deux propriétaires qui ouvrent ensemble n'en
    -- écrivent qu'une (l'index unique tranche).
    v_depuis := greatest(app.dernier_envoi_au_proprietaire(p_piece),
                         coalesce(app.corrigee_par_l_auteur(p_piece), '-infinity'::timestamptz));
    insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
    values (v_tenant, p_piece, v_tenant, auth.uid(), app.prenom_au_moment(auth.uid()), v_depuis)
    on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
    returning vue_le into v_le;
    if v_le is not null then
      return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
    end if;
    select v.vue_le into v_le
      from capture.vues v
     where v.tenant_id = v_tenant and v.piece_id = p_piece
       and v.cabinet_org_id = v_tenant and v.depuis = v_depuis;
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
  end if;

  -- Le comptable : repris de `20261030090000`.
  if v_tenant is null or v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id
   where e.pme_org_id = v_tenant and e.status = 'actif' and m.user_id = auth.uid()
     and v_tenant in (select app.mandats_visibles(e.cabinet_org_id))
   order by e.starts_on desc nulls last
   limit 1;
  if v_cabinet is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_archivee is not null
     or exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', null, 'deja', false);
  end if;

  v_depuis := coalesce(greatest(app.dernier_envoi(p_piece), app.corrigee_par_le_client(p_piece)),
                       '-infinity'::timestamptz);
  insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
  values (v_tenant, p_piece, v_cabinet, auth.uid(), app.nom_au_moment(auth.uid()), v_depuis)
  on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
  returning vue_le into v_le;
  if v_le is not null then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
  end if;

  select v.vue_le into v_le
    from capture.vues v
   where v.tenant_id = v_tenant and v.piece_id = p_piece
     and v.cabinet_org_id = v_cabinet and v.depuis = v_depuis;
  return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
end
$$;

-- --- 8. Retourner : au siège, ou au client ---------------------------------------------------------
--
-- Le propriétaire retourne au siège la pièce que celui-ci lui a envoyée, avec
-- le motif gouverné et sa note — la même carte que le retour du comptable.
-- Le reste est repris de `20261030090000`.

create or replace function public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_pack   uuid;
  v_note_requise boolean;
  v_vivante uuid;
  v_rev    uuid;
begin
  select tenant_id, vis, status, created_by into v_tenant, v_vis, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Le propriétaire, sur la pièce d'un siège qu'il a reçue.
  if v_vis = 'entite'::app.vis_t and v_tenant in (select app.member_orgs()) then
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') or not app.piece_lisible(p_piece) then
      raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
    end if;
    if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
      raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
    end if;
    if (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee' then
      raise exception 'refus.retour.rien_recu' using errcode = 'check_violation';
    end if;
    select requires_note into v_note_requise
      from ref.rejet_motifs where id = p_motif and active;
    if v_note_requise is null then
      raise exception 'motif inconnu' using errcode = 'check_violation';
    end if;
    if v_note_requise and coalesce(btrim(p_note), '') = '' then
      raise exception 'ce motif exige une note' using errcode = 'check_violation';
    end if;

    insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom, motif_id, note)
    values (v_tenant, p_piece, 'retournee', auth.uid(), app.prenom_au_moment(auth.uid()),
            p_motif, nullif(btrim(p_note), ''));

    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_auteur, 'piece.retournee_par_le_proprietaire',
            jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                               'note', nullif(btrim(p_note), ''), 'chez', 'proprietaire'));

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, motif_id, payload)
    values (v_tenant, auth.uid(), 'piece.retournee_au_siege', 'capture', 'pieces', p_piece,
            p_motif, jsonb_build_object('note', nullif(btrim(p_note), '')));

    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null,
                              'chez', 'siege');
  end if;

  if not app.supervise_le_dossier(v_tenant) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  if v_status = 'retournee' then
    raise exception 'refus.retour.deja' using errcode = 'check_violation';
  end if;

  select requires_note into v_note_requise
    from ref.rejet_motifs where id = p_motif and active;
  if v_note_requise is null then
    raise exception 'motif inconnu' using errcode = 'check_violation';
  end if;
  if v_note_requise and coalesce(btrim(p_note), '') = '' then
    raise exception 'ce motif exige une note' using errcode = 'check_violation';
  end if;

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and app.ecriture_vivante(e.id)) then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  select e.id into v_vivante
    from socle.ecritures e
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_vivante is not null then
    v_rev := public.socle_ecriture_review(v_vivante, 'retourne', p_motif, p_note);
    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                              'contre_passation', v_rev);
  end if;

  v_pack := app.pack_de_la_piece(p_piece);

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, p_piece, 'a_corriger'::app.verdict_t, p_motif, nullif(btrim(p_note), ''),
          v_pack, auth.uid());

  update capture.pieces set status = 'retournee', updated_at = now() where id = p_piece;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.retournee',
          jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                             'note', nullif(btrim(p_note), '')));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.retournee', 'capture', 'pieces', p_piece, p_motif, v_pack,
          jsonb_build_object('note', nullif(btrim(p_note), ''), 'sans_ecriture', true));

  return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null);
end
$$;

-- --- 9. La carte de retour : la même, des deux passages ------------------------------------------
--
-- Reprise de `20261029100000` : le retour en cours est celui du propriétaire
-- (dernier fait du passage, pièce dans la société) ou celui du comptable
-- (pièce retournée, dernier verdict « à corriger »). La preuve du geste se
-- juge pareil. `qui` nomme l'autre : le prénom du propriétaire, ou le cabinet.

create or replace function public.piece_retour(p_piece uuid, p_locale text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive p as (
    select id, tenant_id, status, vis from capture.pieces
     where id = p_piece and tenant_id in (select app.member_orgs())
       and app.piece_lisible(p_piece)
       and not exists (select 1 from capture.remplacements r where r.piece_id = p_piece)
  ),
  versions(id) as (
    select id from p
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  ),
  du_proprietaire as (
    select f.le as decided_at, f.note, f.motif_id, f.par_nom as qui
      from app.dernier_fait_du_circuit(p_piece) f, p
     where p.vis = 'entite'::app.vis_t and f.fait = 'retournee'
  ),
  du_cabinet as (
    select c.decided_at, c.note, c.motif_id,
           (select o.name
              from identity.engagements e
              join identity.organizations o on o.id = e.cabinet_org_id
             where e.pme_org_id = (select tenant_id from p) and e.status = 'actif'
             order by e.starts_on desc nulls last limit 1) as qui
      from capture.conformite c join versions v on v.id = c.piece_id
     where c.verdict = 'a_corriger'::app.verdict_t
       and (select status from p) = 'retournee'
       and (select vis from p) = 'partage'::app.vis_t
     order by c.decided_at desc limit 1
  ),
  c as (
    select *, 'proprietaire'::text as chez from du_proprietaire
    union all
    select *, 'cabinet'::text from du_cabinet
  )
  select jsonb_build_object(
      'le', c.decided_at,
      'note', c.note,
      'motif', m.code,
      'motifLibelle', coalesce(l.value, lf.value, m.code),
      'geste', m.geste,
      'chez', c.chez,
      'qui', c.qui,
      'fait', case m.preuve
        when 'aucune' then true
        when 'rattachement' then exists (
          select 1 from public.rattachements_v r join versions v
              on v.id in (r.piece_id, r.piece_liee_id)
           where r.fait = 'rattache'
             and r.created_at > c.decided_at)
          or (m.geste = 'reprendre_photo' and exists (
          select 1 from capture.remplacements r join versions v on v.id = r.remplacee_par
           where r.created_at > c.decided_at))
        when 'precision' then exists (
          select 1 from capture.precisions pr join versions v on v.id = pr.piece_id
           where pr.champ = 'document_date'
             and pr.decided_at > c.decided_at)
        when 'reponse' then exists (
          select 1 from audit.event_log ev join versions v on v.id = ev.object_id
           where ev.action = 'piece.reponse_client'
             and ev.at > c.decided_at)
        else false end)
    from c
    join ref.rejet_motifs m on m.id = c.motif_id
    left join ref.labels l on l.ns = 'rejet_motif' and l.key = m.code and l.locale = p_locale
    left join ref.labels lf on lf.ns = 'rejet_motif' and lf.key = m.code and lf.locale = 'fr'
   limit 1
$$;

-- Répondre à un retour : au comptable, ou au propriétaire qui a retourné la
-- pièce au siège. Repris de `20261026100000`.
create or replace function public.piece_repondre_au_cabinet(p_piece uuid, p_texte text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_au_proprietaire boolean;
begin
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  v_au_proprietaire := v_vis = 'entite'::app.vis_t
    and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'retournee';
  if v_vis <> 'partage'::app.vis_t and not v_au_proprietaire then
    raise exception 'cette piece n''est pas partagee : personne a qui repondre'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_texte), '') = '' then
    raise exception 'refus.reponse.vide' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.reponse_client', 'capture', 'pieces', p_piece,
          jsonb_build_object('texte', btrim(p_texte)));

  if v_au_proprietaire then
    perform app.notifier_les_receveurs(v_tenant, 'piece.reponse_client',
                                       jsonb_build_object('piece_id', p_piece,
                                                          'note', btrim(p_texte)));
  else
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.reponse_client',
            jsonb_build_object('piece_id', p_piece, 'note', btrim(p_texte)));
  end if;

  return jsonb_build_object('piece_id', p_piece);
end
$$;

-- --- 10. Garder : `piece.garder` ------------------------------------------------------------------
--
-- Repris de `20261029100000`, la première garde en plus.

create or replace function public.capture_piece_garder(p_piece uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_deja timestamptz;
begin
  select tenant_id, vis, status, gardee_le into v_tenant, v_vis, v_status, v_deja
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Garder, c'est décider de ne pas l'envoyer au comptable : la décision de
  -- qui l'y envoie (le siège, lui, l'envoie au propriétaire).
  if not app.a_le_droit(v_tenant, 'piece.garder') then
    raise exception 'refus.garder.reserve_au_proprietaire' using errcode = '42501';
  end if;

  if v_vis = 'partage'::app.vis_t then
    if v_status = 'retournee' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t);
      update capture.pieces set gardee_le = now(), updated_at = now() where id = p_piece;
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
              jsonb_build_object('vis', 'entite', 'retour', true));
      return jsonb_build_object('piece_id', p_piece, 'changed', true);
    end if;
    raise exception 'une piece transmise ne revient que par accord du cabinet'
      using errcode = 'check_violation';
  end if;

  if v_deja is not null then
    return jsonb_build_object('piece_id', p_piece, 'gardee_le', v_deja, 'changed', false);
  end if;

  update capture.pieces
     set gardee_le = now(),
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis));

  return jsonb_build_object('piece_id', p_piece, 'changed', true);
end
$$;

-- --- 11. Déplacer entre Mon espace et la société : chacun les siennes -----------------------------
--
-- Repris de `20261029100000`. Ce qui change : « sortir une pièce de la
-- société relevait du propriétaire » — ce qui le laissait mettre la pièce
-- d'un siège dans un espace privé, et le refusait au siège pour la sienne.
-- Désormais chacun déplace les SIENNES, dans les deux sens ; jamais une pièce
-- en route chez le propriétaire (elle se demande).

create or replace function public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
  v_rendue boolean := false;
  v_derive record;
begin
  select tenant_id, vis, status, created_by
    into v_tenant, v_old, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_old = p_vis then
    return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', false);
  end if;

  if p_vis = 'personnel'::app.vis_t
     and (v_status in ('comptabilisee','supervisee')
          or exists (select 1 from socle.ecritures e
                      where e.piece_id in (select app.versions_de_la_piece(p_piece))
                        and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'une piece comptabilisee reste dans la societe' using errcode = 'check_violation';
  end if;

  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee')
       or exists (select 1 from socle.ecritures e
                   where e.piece_id in (select app.versions_de_la_piece(p_piece))
                     and e.status = 'booked'
                     and app.ecriture_vivante(e.id)) then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    v_rendue := v_status = 'retournee' and p_vis = 'entite'::app.vis_t;
    if not v_rendue and not app.accord_donne(p_piece, 'rappel') then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Entre Mon espace et la société : chacun les siennes, dans les deux sens.
  if (p_vis = 'personnel'::app.vis_t and v_old = 'entite'::app.vis_t)
     or (p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t) then
    if v_auteur is distinct from auth.uid() then
      raise exception 'refus.deplacer.pas_la_sienne' using errcode = '42501';
    end if;
    -- Partie chez le propriétaire, ou retournée par lui : elle se demande,
    -- elle ne se reprend pas en douce.
    if p_vis = 'personnel'::app.vis_t
       and (select fait from app.dernier_fait_du_circuit(p_piece)) in ('envoyee', 'retournee') then
      raise exception 'refus.deplacer.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
  end if;

  if v_rendue then
    perform app.piece_oublie_ses_propositions(p_piece);
  end if;

  update capture.pieces
     set vis = p_vis,
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         gardee_le = null,
         status = case when v_rendue then app.statut_hors_retour(p_piece) else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id in (select app.versions_de_la_piece(p_piece))
         and vis = 'partage'::app.vis_t
         and status not in ('comptabilisee', 'supervisee')
      returning id
    loop
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', v_derive.id,
              jsonb_build_object('from', 'partage', 'to', p_vis,
                                 'par_accord', p_par_accord, 'suit_la_source', p_piece));
    end loop;
  end if;

  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t and v_old = 'personnel'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.a_valider',
            jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  if v_rendue and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.gardee', jsonb_build_object('piece_id', p_piece, 'vis', p_vis));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

-- --- 12. Supprimer : les siennes, et le propriétaire toutes celles pas envoyées -------------------
--
-- Repris de `20261029100000`, trois gardes de plus, avant toute autre :
--   - Mon espace : son auteur seul (la porte, `security definer`, ne voyait
--     que l'adhésion) ;
--   - la société : les siennes, ou toutes avec `piece.supprimer_toutes` — et
--     l'auteur est prévenu ;
--   - le siège ne retire pas une pièce partie chez le propriétaire : il la
--     demande. Retournée par lui, elle est rendue : il la supprime.

create or replace function public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vis      text;
  v_status   text;
  v_tenant   uuid;
  v_archivee timestamptz;
  v_version  uuid;
  v_auteur   uuid;
  v_prevenir uuid;
begin
  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;

  select p.vis::text, p.status, p.tenant_id, p.archivee_le, p.created_by
    into v_vis, v_status, v_tenant, v_archivee, v_auteur
    from capture.pieces p where p.id = p_piece;

  if v_vis is null then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  if v_tenant not in (select app.member_orgs())
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  if v_tenant in (select app.member_orgs()) then
    -- Ce qu'on ne lit pas n'existe pas pour soi.
    if not app.piece_lisible(p_piece) then
      raise exception 'piece introuvable' using errcode = 'no_data_found';
    end if;
    if v_vis = 'personnel' and v_auteur is distinct from auth.uid() then
      raise exception 'piece introuvable' using errcode = 'no_data_found';
    end if;
    if v_vis <> 'personnel' and v_auteur is distinct from auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes') then
      raise exception 'refus.suppression.pas_la_sienne' using errcode = '42501';
    end if;
    if v_vis = 'entite' and v_auteur = auth.uid()
       and not app.a_le_droit(v_tenant, 'piece.supprimer_toutes')
       and (select fait from app.dernier_fait_du_circuit(p_piece)) = 'envoyee' then
      raise exception 'refus.suppression.chez_le_proprietaire' using errcode = 'check_violation';
    end if;
    -- Le propriétaire retire la pièce d'un autre : l'auteur le saura. Sur
    -- l'accord de sa demande, la réponse le lui dit déjà.
    if v_auteur is distinct from auth.uid() and not p_par_accord then
      v_prevenir := v_auteur;
    end if;
  end if;

  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  if v_archivee is not null then
    return 'archivee';
  end if;

  if v_vis = 'partage'
     and v_status <> 'retournee'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id in (select app.versions_de_la_piece(p_piece))
                   and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from immo.assets a
              where a.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from stocks.mouvements m
                 where m.piece_id in (select app.versions_de_la_piece(p_piece)))
     or exists (select 1 from identity.fiches_fiscales f
                 where f.piece_id in (select app.versions_de_la_piece(p_piece)))
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  perform app.piece_oublie_ses_propositions(v.id)
     from app.versions_de_la_piece(p_piece) v(id);

  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.status = 'booked') then
    update capture.pieces set archivee_le = now(), updated_at = now()
     where id in (select app.versions_de_la_piece(p_piece)) and archivee_le is null;
    perform app.les_issues_suivent_l_archive(p_piece);

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.archivee', 'capture', 'pieces', p_piece,
            jsonb_build_object('vis', v_vis, 'status', v_status, 'par_accord', p_par_accord));

    if v_vis = 'partage' and not p_par_accord then
      insert into collab.notifications (tenant_id, kind, payload)
      values (v_tenant, 'piece.archivee', jsonb_build_object('piece_id', p_piece));
    end if;
    if v_prevenir is not null then
      insert into collab.notifications (tenant_id, user_id, kind, payload)
      values (v_tenant, v_prevenir, 'piece.supprimee_par_le_proprietaire',
              jsonb_build_object('piece_id', p_piece,
                                 'par', app.prenom_au_moment(auth.uid()), 'archivee', true));
    end if;
    return 'archivee';
  end if;

  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id in (select app.versions_de_la_piece(p_piece))
          and (exists (select 1 from fabrique.recette_version_exemples r where r.exemple_id = x.id)
               or exists (select 1 from fabrique.evaluation_exemples v where v.exemple_id = x.id)))
  then
    raise exception 'refus.suppression.exemple_de_recette' using errcode = 'check_violation';
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord,
                             'versions', (select jsonb_agg(v)
                                            from app.versions_de_la_piece(p_piece) v
                                           where v <> p_piece)));

  if v_vis = 'partage' and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;
  -- L'auteur apprend que sa pièce a été retirée par un propriétaire. La
  -- notification lui est adressée : elle survit à la pièce.
  if v_prevenir is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_prevenir, 'piece.supprimee_par_le_proprietaire',
            jsonb_build_object('piece_id', p_piece, 'par', app.prenom_au_moment(auth.uid())));
  end if;

  for v_version in
    with recursive suite(id, rang) as (
      select p_piece, 0
      union all
      select r.piece_id, s.rang + 1
        from capture.remplacements r join suite s on r.remplacee_par = s.id
    )
    select id from suite order by rang
  loop
    perform set_config('malica.piece_effacable', v_version::text, true);
    delete from capture.pieces where id = v_version;
  end loop;
  perform set_config('malica.piece_effacable', '', true);
  perform set_config('malica.paiements_effacables', '', true);

  return 'supprimee';
end
$$;

-- --- 13. Les demandes : le siège au propriétaire, le propriétaire au comptable --------------------

alter table collab.demandes_sur_piece
  add column if not exists etape text not null default 'cabinet';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demandes_sur_piece_etape_check') then
    alter table collab.demandes_sur_piece
      add constraint demandes_sur_piece_etape_check check (etape in ('proprietaire', 'cabinet'));
  end if;
end $$;

comment on column collab.demandes_sur_piece.etape is
  'À qui la demande est faite : au propriétaire (par un siège), ou au comptable.';

create index if not exists demandes_sur_piece_etape_idx
  on collab.demandes_sur_piece (tenant_id, piece_id, etape, objet, created_at desc);

-- La vue garde ses colonnes ; l'étape s'ajoute à la fin.
create or replace view public.demandes_sur_piece_v with (security_invoker = true) as
  select id, tenant_id, piece_id, objet, fait, note, auteur, created_at, etape
    from collab.demandes_sur_piece;

-- Le comptable ne lit que les demandes qui lui sont faites ; la société, celles
-- des pièces qu'elle lit.
drop policy if exists collab_demandes_sur_piece_sel on collab.demandes_sur_piece;
create policy collab_demandes_sur_piece_sel on collab.demandes_sur_piece
  for select to authenticated
  using ((tenant_id in (select app.member_orgs()) and app.piece_lisible(piece_id))
         or (etape = 'cabinet' and tenant_id in (select app.engaged_orgs()))
         or (select app.is_platform()));

-- Le dernier fait d'une demande, à une étape.
create or replace function app.derniere_demande(p_piece uuid, p_objet text, p_etape text)
returns table (fait text, created_at timestamptz, auteur uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.fait, d.created_at, d.auteur
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet and d.etape = p_etape
   order by d.created_at desc, d.id desc
   limit 1
$$;

revoke all on function app.derniere_demande(uuid, text, text) from public, anon;

-- L'accord du comptable : repris de `20261019120000`, sur les seules demandes
-- qui lui sont faites.
create or replace function app.accord_donne(p_piece uuid, p_objet text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.piece_lisible(p_piece)
     and (
       not exists (
         select 1
           from capture.pieces pc
           join identity.engagements e on e.pme_org_id = pc.tenant_id
          where pc.id = p_piece
            and e.status = 'actif'
            and e.starts_on <= current_date
            and (e.ends_on is null or e.ends_on >= current_date))
       or coalesce((
         select d.fait = 'accordee'
                and d.created_at >= coalesce(pc.transmise_le, '-infinity'::timestamptz)
           from collab.demandes_sur_piece d
           join capture.pieces pc on pc.id = d.piece_id
          where d.piece_id = p_piece and d.objet = p_objet and d.etape = 'cabinet'
          order by d.created_at desc
          limit 1), false))
$$;

-- Demander. Le siège demande au propriétaire — pour une pièce partie chez lui,
-- ou déjà chez le comptable ; qui transmet au comptable lui demande. Repris
-- de `20261029100000`.
create or replace function public.piece_demander(p_piece uuid, p_objet text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_auteur uuid;
  v_etape text;
  v_dernier text;
begin
  select tenant_id, vis, status, created_by into v_tenant, v_vis, v_status, v_auteur
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    v_etape := 'cabinet';
    -- Une pièce qu'on n'a pas envoyée se reprend sans demander.
    if v_vis <> 'partage'::app.vis_t then
      raise exception 'cette piece n''est pas partagee : rien a demander'
        using errcode = 'check_violation';
    end if;
  elsif app.a_le_droit(v_tenant, 'envoi.proprietaire') and v_auteur = auth.uid() then
    v_etape := 'proprietaire';
    -- Dans la société, il ne demande que ce qui est parti chez le propriétaire.
    if v_vis = 'personnel'::app.vis_t
       or (v_vis = 'entite'::app.vis_t
           and (select fait from app.dernier_fait_du_circuit(p_piece)) is distinct from 'envoyee') then
      raise exception 'cette piece n''est pas partagee : rien a demander'
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Prise en charge, elle se demande : le comptable qui accorde contre-passe.
  -- Un règlement inscrit, lui, engage un paiement réel : il s'annule d'abord.
  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and e.status = 'booked'
                and app.ecriture_vivante(e.id)) then
    raise exception '%', case when p_objet = 'rappel' then 'refus.rappel.inscrite'
                              else 'refus.suppression.inscrite' end
      using errcode = 'check_violation';
  end if;

  -- Sous la RLS de la personne : les demandes de la pièce qu'elle lit.
  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet and d.etape = v_etape
   order by d.created_at desc, d.id desc limit 1;
  if v_dernier = 'demandee' then
    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', true,
                              'etape', v_etape);
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape)
  values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), v_etape);

  if v_etape = 'cabinet' then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.demande',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
  else
    perform app.notifier_les_receveurs(v_tenant, 'piece.demande',
                                       jsonb_build_object('piece_id', p_piece, 'objet', p_objet,
                                                          'chez', 'proprietaire'));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', false,
                            'etape', v_etape);
end
$$;

-- Trancher. Le comptable tranche les demandes qui lui sont faites ; le
-- propriétaire, celles des sièges. Un accord du propriétaire sur une pièce
-- déjà chez le comptable y transmet la demande, d'elle-même. Accordée, une
-- récupération rend la pièce À LA SOCIÉTÉ — jamais à un espace privé ; une
-- suppression l'efface (ou l'archive, si une écriture a existé).
create or replace function public.piece_repondre(p_piece uuid, p_objet text, p_accorde boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_auteur  uuid;
  v_dernier record;
  v_demandeur uuid;
  v_relayee boolean := false;
  v_vivante uuid;
begin
  if not app.piece_lisible(p_piece) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  perform 1 from capture.pieces
   where id in (select app.versions_de_la_piece(p_piece)) order by id for update;
  select tenant_id, vis, created_by into v_tenant, v_vis, v_auteur
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Le propriétaire tranche la demande d'un siège. Un membre de la société
  -- ne tranche rien d'autre : la demande faite au cabinet n'est pas à lui (nul
  -- ne tranche sa propre demande).
  if v_tenant in (select app.member_orgs()) then
    select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'proprietaire');
    if v_dernier.fait is distinct from 'demandee' then
      raise exception 'seul le cabinet sous mandat tranche une demande sur une piece'
        using errcode = '42501';
    end if;
    if not app.a_le_droit(v_tenant, 'circuit.recevoir') then
      raise exception 'seul le proprietaire tranche la demande d''un siege'
        using errcode = '42501';
    end if;
    v_demandeur := v_dernier.auteur;

    insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
    values (v_tenant, p_piece, p_objet,
            case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(),
            'proprietaire');

    if p_accorde and v_vis = 'partage'::app.vis_t then
      -- Chez le comptable : la demande part d'elle-même, au nom du propriétaire.
      if (select d.fait from app.derniere_demande(p_piece, p_objet, 'cabinet') d)
         is distinct from 'demandee' then
        -- Après l'accord, dans la même transaction : l'heure de l'horloge, pas
        -- celle de la transaction, pour que la suite des faits garde son ordre.
        insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur, etape,
                                               created_at)
        values (v_tenant, p_piece, p_objet, 'demandee', auth.uid(), 'cabinet', clock_timestamp());
        insert into collab.notifications (tenant_id, kind, payload)
        values (v_tenant, 'piece.demande',
                jsonb_build_object('piece_id', p_piece, 'objet', p_objet));
      end if;
      v_relayee := true;
    elsif p_accorde and p_objet = 'rappel' then
      -- Rendue au siège, dans la société : à envoyer de nouveau.
      insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
      values (v_tenant, p_piece, 'rappelee', auth.uid(), app.prenom_au_moment(auth.uid()));
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'proprietaire'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'proprietaire') d)
             = 'demandee';
    end if;

    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_demandeur, 'piece.demande_tranchee',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note, 'chez', 'proprietaire',
                               'transmise', v_relayee));

    if p_accorde and p_objet = 'suppression' and not v_relayee then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;

    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                              'transmise', v_relayee);
  end if;

  -- Le comptable : repris de `20261029100000`, sur les demandes qui lui sont faites.
  if v_tenant not in (select app.engaged_orgs()) then
    raise exception 'seul le cabinet sous mandat tranche une demande sur une piece'
      using errcode = '42501';
  end if;

  select * into v_dernier from app.derniere_demande(p_piece, p_objet, 'cabinet');
  if v_dernier.fait is distinct from 'demandee' then
    raise exception 'aucune demande en attente sur cette piece'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid(), 'cabinet');

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                             'note', p_note));

  -- La demande venait d'un siège, par son propriétaire : il apprend la réponse.
  select d.auteur into v_demandeur
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet and d.etape = 'proprietaire'
     and d.fait = 'demandee'
     and exists (select 1 from collab.demandes_sur_piece a
                  where a.piece_id = p_piece and a.objet = p_objet and a.etape = 'proprietaire'
                    and a.fait = 'accordee' and a.created_at >= d.created_at)
   order by d.created_at desc limit 1;
  if v_demandeur is not null then
    insert into collab.notifications (tenant_id, user_id, kind, payload)
    values (v_tenant, v_demandeur, 'piece.demande_tranchee',
            jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde,
                               'note', p_note));
  end if;

  if p_accorde then
    -- Prise en charge : son écriture se contre-passe au journal du jour, puis
    -- la pièce revient ou s'archive (spec §3).
    select e.id into v_vivante
      from socle.ecritures e
     where e.piece_id in (select app.versions_de_la_piece(p_piece))
       and e.nature = 'piece'
       and app.ecriture_vivante(e.id)
     limit 1;
    if v_vivante is not null then
      perform public.socle_ecriture_contre_passer(
        v_vivante, (select m.id from ref.rejet_motifs m where m.code = 'retrait_accorde'));
      update capture.pieces
         set status = app.statut_hors_retour(p_piece), updated_at = now()
       where id = p_piece;
    end if;

    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t, true);
      -- Rendue à la société ; la pièce d'un siège lui revient « à envoyer ».
      if v_demandeur is not null then
        insert into capture.circuit (tenant_id, piece_id, fait, par, par_nom)
        values (v_tenant, p_piece, 'rappelee', auth.uid(), app.nom_au_moment(auth.uid()));
      end if;
      insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur, etape)
      select v_tenant, p_piece, 'suppression', 'retiree', null, auth.uid(), 'cabinet'
       where (select d.fait from app.derniere_demande(p_piece, 'suppression', 'cabinet') d)
             = 'demandee';
    elsif p_objet = 'suppression' then
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

-- Les demandes des sièges se tranchent sous la règle d'insertion : le
-- propriétaire est membre, pas cabinet. La porte (`security definer`) est
-- la seule à écrire `accordee`/`refusee` ; la politique garde le reste.
drop policy if exists collab_demandes_sur_piece_ins on collab.demandes_sur_piece;
create policy collab_demandes_sur_piece_ins on collab.demandes_sur_piece
  for insert to authenticated
  with check ((fait = 'demandee' and tenant_id in (select app.member_orgs()))
              or (fait in ('accordee', 'refusee') and etape = 'cabinet'
                  and tenant_id in (select app.engaged_orgs())));

-- --- 14. Les notifications suivent la pièce -------------------------------------------------------
--
-- Une notification adressée (`user_id`) ne se lit que de son destinataire ; une
-- notification de pièce, que de qui lit la pièce — ou, la pièce partie, de qui
-- voit toute la société. Sans quoi un siège lirait, par la porte de service, la
-- note d'un retour fait à un autre.

create or replace function app.notification_lisible(p_tenant uuid, p_user uuid, p_payload jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is not null then p_user = auth.uid()
    -- Le cabinet engagé, la plateforme : ce qu'ils lisaient déjà.
    when p_tenant not in (select app.member_orgs()) then true
    when p_payload ? 'piece_id' and (p_payload ->> 'piece_id') ~* '^[0-9a-f-]{36}$' then
      case when exists (select 1 from capture.pieces p where p.id = (p_payload ->> 'piece_id')::uuid)
           then app.piece_lisible((p_payload ->> 'piece_id')::uuid)
           else p_tenant in (select app.orgs_avec_droit('societe.tout_voir')) end
    else true
  end
$$;

revoke all on function app.notification_lisible(uuid, uuid, jsonb) from public, anon;
grant execute on function app.notification_lisible(uuid, uuid, jsonb) to authenticated;

drop policy if exists collab_notifications_sel on collab.notifications;
create policy collab_notifications_sel on collab.notifications
  for select to authenticated
  using (((tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
          and app.notification_lisible(tenant_id, user_id, payload))
         or (select app.is_platform()));

-- --- 15. Le départ d'un siège ---------------------------------------------------------------------
--
-- Repris de `20261019150000`. Sa place se libère TOUJOURS : ses pièces de la
-- société restent à la société (le propriétaire les voit, elles portent son
-- nom d'auteur, aucun fait n'est effacé) ; son Mon espace part avec son compte
-- — il reste lisible de lui seul, et la société ne l'a jamais lu. Ses
-- demandes en attente auprès du propriétaire restent à trancher.

create or replace function public.siege_reprendre_sa_place(p_tenant uuid, p_membre uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_privees integer;
begin
  if not app.a_le_droit(p_tenant, 'circuit.recevoir') then
    raise exception 'seul le proprietaire reprend une place' using errcode = '42501';
  end if;
  -- Un propriétaire ne se retire pas par cette porte : il n'occupe pas un siège.
  if exists (select 1 from app.receveurs_du_circuit(p_tenant) r where r = p_membre) then
    raise exception 'refus.place.proprietaire' using errcode = 'check_violation';
  end if;

  -- Compté, jamais lu : ce nombre part avec lui.
  select count(*) into v_privees
    from capture.pieces
   where tenant_id = p_tenant and created_by = p_membre and vis = 'personnel'::app.vis_t;

  delete from identity.memberships
   where tenant_id = p_tenant and user_id = p_membre;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'siege.libere', 'identity', 'memberships',
          p_membre, jsonb_build_object('membre', p_membre, 'mon_espace_parti', v_privees));

  return jsonb_build_object('libere', true, 'pieces', 0);
end
$$;

-- --- 16. Le motif d'une contre-passation accordée ---------------------------------------------------
--
-- Toute contre-passation porte son motif gouverné (`ecritures_check4`). Celle
-- d'un retrait accordé dit le sien ; il ne se choisit pas pour un retour
-- (`active = false`).

insert into ref.rejet_motifs (code, severity, requires_note, sort_order, active, valid_from,
                              geste, preuve)
select 'retrait_accorde', 'avertissement', false, 120, false, date '2026-10-28',
       'repondre', 'aucune'
 where not exists (select 1 from ref.rejet_motifs where code = 'retrait_accorde');

insert into ref.labels (ns, key, locale, value) values
  ('rejet_motif', 'retrait_accorde', 'fr', 'Pièce retirée à la demande du client'),
  ('rejet_motif', 'retrait_accorde', 'en', 'Document withdrawn at the client''s request'),
  ('rejet_motif', 'retrait_accorde', 'ar', 'وثيقة سُحبت بطلب من العميل')
on conflict (ns, key, locale) do nothing;

-- --- 17. Une écriture se lit avec sa pièce -----------------------------------------------------------
--
-- La société entière lit ses écritures par `societe.tout_voir` ; un siège,
-- celles des pièces qu'il lit. Le cabinet engagé et la plateforme : inchangés.

drop policy if exists socle_ecritures_sel on socle.ecritures;
create policy socle_ecritures_sel on socle.ecritures
  for select to authenticated
  using (tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
         or (tenant_id in (select app.member_orgs())
             and piece_id is not null and app.piece_lisible(piece_id))
         or (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))
         or app.plateforme_requise(tenant_id));

drop policy if exists socle_ecriture_lignes_sel on socle.ecriture_lignes;
create policy socle_ecriture_lignes_sel on socle.ecriture_lignes
  for select to authenticated
  using (tenant_id in (select app.orgs_avec_droit('societe.tout_voir'))
         or tenant_id in (select app.engaged_orgs())
         or app.plateforme_requise(tenant_id)
         or (tenant_id in (select app.member_orgs())
             and exists (select 1 from socle.ecritures e
                          where e.id = ecriture_id and e.piece_id is not null
                            and app.piece_lisible(e.piece_id))));

commit;
