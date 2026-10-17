-- La plateforme ne lit pas les papiers de ses clients.
--
-- ============================================================= LE DÉFAUT RÉEL
--
-- `app.is_platform()` figure dans 58 politiques, sur toutes les tables de
-- tenant sans distinction. Un opérateur d'ALGORIA peut donc aujourd'hui lire
-- les factures d'une PME, ses écritures, ses conversations avec Malica — et,
-- depuis `20261018103000`, l'espace privé de n'importe quel collaborateur.
--
-- Personne n'a écrit ce comportement. Il est le défaut d'un `or` posé pour
-- l'exploitation — voir une table pour diagnostiquer un incident — et étendu
-- à tout parce que le helper est unique.
--
-- ======================================================== POURQUOI C'EST GRAVE
--
-- Le produit se vend sur une phrase : « le cabinet ne lit jamais ce qui ne lui
-- a pas été transmis », et son espace privé est présenté comme invisible de
-- tous. Si l'éditeur, lui, lit tout, la phrase est fausse — et elle est fausse
-- de la pire façon, celle qui ne se voit pas.
--
-- C'est aussi une exposition juridique. Une PME tunisienne conserve dix ans de
-- pièces chez un tiers ; ce tiers doit pouvoir démontrer qu'il n'y accède pas.
-- Une tour de contrôle qui lit les papiers n'est pas une tour de contrôle,
-- c'est un risque.
--
-- ======================================================= CE QU'ON ÉCRIT À LA PLACE
--
-- Deux niveaux, et un seul chemin entre les deux :
--
--   `app.is_platform()`        l'exploitation ordinaire. Reste sur les
--                              COMPTEURS et les MÉTADONNÉES : qui est client,
--                              quelle offre, combien de lectures, quelles
--                              échéances, quel incident. Jamais un contenu.
--
--   `app.plateforme_requise()` l'exception. Vraie seulement si une réquisition
--                              OUVERTE et APPROUVÉE existe sur ce tenant,
--                              dans sa fenêtre de validité. Rien d'autre ne
--                              l'ouvre, et elle se referme toute seule.
--
-- La tour peut donc facturer, suspendre, reprendre, mesurer et répondre à une
-- autorité — sans lire une pièce. C'est exactement ce qu'on veut pouvoir
-- écrire dans un contrat.
--
-- ===================================================== CE QUI EST UN « CONTENU »
--
-- Tout ce qui porte le travail du client : la pièce et tout ce qui en dépend,
-- l'écriture comptable, le coffre, la conversation avec Malica. Et rien
-- d'autre : une échéance, un membre, une licence, une facture d'ALGORIA sont
-- des métadonnées, et la tour les lit.

begin;

-- --- 1. Les réquisitions, d'abord : la porte avant le mur ------------------
--
-- Elle est créée ici, et pas dans la migration des autorités, parce que
-- `app.plateforme_requise()` la lit et qu'une fonction ne s'écrit pas avant
-- sa table.

create schema if not exists plateforme;

create table if not exists plateforme.requisitions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete restrict,

  -- Qui demande. Pas un texte libre : on veut pouvoir compter, et distinguer
  -- une recette des finances d'une commission rogatoire.
  autorite      text not null check (autorite in (
                  'recette_des_finances', 'controle_fiscal', 'justice',
                  'cnil_inpdp', 'client_lui_meme')),
  reference     text not null check (length(btrim(reference)) > 0),

  -- Ce qui est demandé. `pieces` est le seul niveau qui ouvre le contenu.
  portee        text not null check (portee in ('metadonnees', 'archive', 'pieces')),
  motif         text not null,

  -- La fenêtre. Une réquisition sans fin est une porte ouverte : la date de
  -- clôture est obligatoire, et la fonction la vérifie à chaque lecture.
  ouverte_le    timestamptz not null default now(),
  close_le      timestamptz not null check (close_le > ouverte_le),

  -- Deux signatures. Un opérateur dépose, un second approuve : personne chez
  -- ALGORIA n'ouvre seul le dossier d'un client.
  depose_par    uuid not null default auth.uid(),
  approuve_par  uuid,
  approuve_le   timestamptz,

  -- Le client est prévenu, sauf interdiction écrite de l'autorité. Le défaut
  -- est de prévenir : le silence doit être une décision, pas un oubli.
  client_informe_le timestamptz,
  secret_impose  boolean not null default false,

  created_at    timestamptz not null default now(),

  constraint requisitions_approbation_complete
    check ((approuve_par is null) = (approuve_le is null)),
  constraint requisitions_deux_paires_d_yeux
    check (approuve_par is null or approuve_par <> depose_par)
);

create index requisitions_tenant_idx on plateforme.requisitions (tenant_id, close_le desc);

comment on table plateforme.requisitions is
  'La seule porte par laquelle un opérateur d''ALGORIA peut lire le contenu '
  'd''un client. Deux signatures, une portée, une fenêtre, et une trace.';

-- --- 2. La fonction qui ouvre, et elle seule --------------------------------

create or replace function app.plateforme_requise(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from plateforme.requisitions r
    join app.platform_operators po on po.user_id = auth.uid()
    where r.tenant_id = p_tenant
      and r.portee = 'pieces'
      and r.approuve_par is not null
      and now() between r.ouverte_le and r.close_le
  )
$$;

revoke all on function app.plateforme_requise(uuid) from public, anon;
grant execute on function app.plateforme_requise(uuid) to authenticated;

comment on function app.plateforme_requise(uuid) is
  'Vraie uniquement sous réquisition ouverte, approuvée et dans sa fenêtre. '
  'Se referme seule : aucune action n''est nécessaire pour que l''accès cesse.';

-- --- 3. Le mur : les tables de contenu perdent `is_platform` ---------------
--
-- Onze tables, nommées une par une plutôt qu'en boucle sur un `like` : la
-- liste de ce que l'éditeur ne lit pas est une décision, et une décision
-- se lit, elle ne se devine pas d'un motif.

create or replace function app.piece_lisible(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from capture.pieces p
    where p.id = p_piece
      and (
        (p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
        or (p.vis = 'entite'::app.vis_t  and p.tenant_id in (select app.member_orgs()))
        or (p.vis = 'partage'::app.vis_t and (
              p.tenant_id in (select app.member_orgs())
              or p.tenant_id in (select app.engaged_orgs())))
        -- L'exception, et elle est nommée.
        or app.plateforme_requise(p.tenant_id)
      )
  )
$$;

drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    (vis = 'personnel'::app.vis_t and created_by = auth.uid())
    or (vis = 'entite'::app.vis_t  and tenant_id in (select app.member_orgs()))
    or (vis = 'partage'::app.vis_t and (
          tenant_id in (select app.member_orgs())
          or tenant_id in (select app.engaged_orgs())))
    or app.plateforme_requise(tenant_id)
  );

-- Les écritures comptables : le travail du cabinet, pas celui de l'éditeur.
drop policy if exists socle_ecritures_sel on socle.ecritures;
create policy socle_ecritures_sel on socle.ecritures
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or (vis = 'partage'::app.vis_t and tenant_id in (select app.engaged_orgs()))
    or app.plateforme_requise(tenant_id)
  );

drop policy if exists socle_ecriture_lignes_sel on socle.ecriture_lignes;
create policy socle_ecriture_lignes_sel on socle.ecriture_lignes
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or tenant_id in (select app.engaged_orgs())
    or app.plateforme_requise(tenant_id)
  );

-- Le coffre : les octets eux-mêmes.
drop policy if exists coffre_objects_sel on coffre.objects;
create policy coffre_objects_sel on coffre.objects
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or tenant_id in (select app.engaged_orgs())
    or app.plateforme_requise(tenant_id)
  );

-- Les conversations avec Malica : RIEN À FAIRE, et c'est un bon exemple.
-- `conversations_sel` (`20260901160000`) est déjà écrite autrement que les
-- autres :
--
--   (created_by = auth.uid())
--   and (tenant_id in member_orgs() or tenant_id in engaged_orgs())
--
-- Pas de `is_platform` du tout, et un filtre par personne. Ce que ce fil
-- porte — les questions qu'un dirigeant pose sur ses propres affaires — a
-- visiblement été jugé assez intime pour mériter sa propre règle, et cette
-- règle est la bonne. `conversation_messages_sel` s'y adosse par EXISTS.
--
-- On la laisse exactement comme elle est. L'exception de réquisition ne s'y
-- applique pas non plus : une autorité qui veut les échanges d'un dirigeant
-- avec son assistant demande les PIÈCES, et une conversation n'est pas une
-- pièce comptable.

-- --- 4. Ce que la tour garde ------------------------------------------------
--
-- `app.is_platform()` ne change pas, et reste sur tout le reste : licences,
-- lectures, membres, échéances, notifications, journal d'audit, tarifs.
-- C'est la matière de la tour, et elle suffit — une facture se calcule sur
-- un COMPTE de lectures, jamais sur leur contenu.
--
-- `audit.event_log` en particulier reste ouvert à la plateforme : c'est lui
-- qui permet de répondre « cette pièce a été transmise le 15, rappelée le 17,
-- par cet utilisateur » sans jamais l'ouvrir.

comment on function app.is_platform() is
  'L''exploitation ordinaire : compteurs, métadonnées, journal. JAMAIS un '
  'contenu — voir `app.plateforme_requise` et `20261019090000`.';

commit;
