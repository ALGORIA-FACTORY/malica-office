-- Un document se rattache à une pièce, après la lecture, et se détache.
--
-- ============================================================== POURQUOI
--
-- 23 octobre 2026, Wissem : « est-ce que je peux rattacher après la lecture
-- de la pièce ? » Non : seule une pièce NÉE d'une autre (le reçu, le talon,
-- `source_piece_id`) lui était liée, et ce lien se pose à la capture. Un bon
-- de livraison, un avoir, un devis déjà photographiés restaient sans lien avec
-- leur facture. Option validée le 24 octobre (« A ») : rattacher, détacher,
-- voir la chaîne — d'abord pour la PME.
--
-- ============================================================ CE QUI EST TENU
--
-- * Un REGISTRE, pas un état (R7) : rattacher, puis détacher, sont deux faits
--   datés et signés ; l'état courant est le dernier fait de la paire. Réécrire
--   une ligne effacerait qui a lié quoi, et quand.
-- * La paire n'a pas de sens : A↔B. Le premier fait fixe son ordre, et les
--   suivants le reprennent — sinon B→A rattacherait une seconde fois.
-- * Un détachement dit pourquoi : la base refuse un motif vide.
-- * Seules les pièces DE LA SOCIÉTÉ se rattachent (entité ou transmise) : une
--   pièce de l'espace privé n'est pas à la société, et son existence ne doit
--   pas apparaître dans le registre que le cabinet lit.
-- * Seuls les membres écrivent (politique d'insertion du helper) ; le cabinet
--   lit, comme pour les demandes sur une pièce.
-- * Une pièce non engagée reste effaçable : le garde permissif de
--   `20261018120000` apprend la seconde colonne (`piece_liee_id`).

begin;

create table if not exists capture.rattachements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  piece_id      uuid not null references capture.pieces(id) on delete cascade,
  piece_liee_id uuid not null references capture.pieces(id) on delete cascade,
  fait          text not null check (fait in ('rattache', 'detache')),
  motif         text,
  auteur        uuid,
  created_at    timestamptz not null default now(),
  -- Deux faits du même instant se départagent sans hasard (leçon de
  -- `20261023180000`) : le rang inscrit après est le dernier.
  rang          bigint generated always as identity,
  constraint rattachements_deux_pieces check (piece_id <> piece_liee_id),
  constraint rattachements_detachement_motive
    check (fait <> 'detache' or (motif is not null and length(trim(motif)) > 0))
);

create index if not exists rattachements_tenant_piece_idx
  on capture.rattachements (tenant_id, piece_id, created_at desc);
create index if not exists rattachements_tenant_liee_idx
  on capture.rattachements (tenant_id, piece_liee_id, created_at desc);

select app.enable_tenant_rls('capture', 'rattachements', false, true);

-- Ni modification ni suppression pour personne : le helper les accorde, le
-- garde d'effacement exige qu'aucun droit ne les ouvre (`schema.test.ts`).
revoke update, delete on table capture.rattachements from authenticated;

-- Le garde permissif connaît désormais les deux bouts d'un rattachement.
--
-- Repris À L'IDENTIQUE de sa dernière version (`20261019150000`, trois
-- passages : la pièce effacée, le SET NULL du justificatif, la preuve d'un
-- paiement qui part) ; seul le quatrième passage est nouveau. Recopier une
-- version plus ancienne aurait défait les deux suivants — c'est ce que la
-- suite de l'API a montré sur un premier jet.
create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effacable text := coalesce(current_setting('malica.piece_effacable', true), '');
  v_paiements text;
begin
  -- Premier passage : la cascade d'une suppression de pièce que
  -- `capture_piece_supprimer` a validée, et pour CETTE pièce précisément.
  if tg_op = 'DELETE' and v_effacable = old.piece_id::text then
    -- Un paiement qui part avec la pièce note son identifiant : ses
    -- justificatifs, supprimés ensuite par cascade, s'y reconnaîtront.
    if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
      perform set_config(
        'malica.paiements_effacables',
        coalesce(current_setting('malica.paiements_effacables', true), '')
          || ',' || old.id::text,
        true);
    end if;
    return old;
  end if;

  if tg_table_schema = 'capture' and tg_table_name = 'paiements' then
    -- Second passage : le SET NULL d'un justificatif qui disparaît. La pièce
    -- effacée est celle que le paiement citait, la colonne part vers NULL, et
    -- AUCUNE autre colonne ne bouge.
    if tg_op = 'UPDATE'
       and old.justificatif_piece_id is not null
       and v_effacable = old.justificatif_piece_id::text
       and new.justificatif_piece_id is null
       and to_jsonb(new) - 'justificatif_piece_id'
         = to_jsonb(old) - 'justificatif_piece_id'
    then
      return new;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'paiement_justificatifs' then
    -- Troisième passage : la ligne de preuve d'un paiement qui part avec sa
    -- facture. Son `piece_id` est le talon, pas la pièce effacée.
    v_paiements := coalesce(current_setting('malica.paiements_effacables', true), '');
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and (',' || v_paiements || ',') like ('%,' || old.paiement_id::text || ',%')
    then
      return old;
    end if;
  elsif tg_table_schema = 'capture' and tg_table_name = 'rattachements' then
    -- Quatrième passage : le registre des rattachements a DEUX bouts. La pièce
    -- effacée peut être la pièce liée ; le premier passage n'a lu que l'autre.
    if tg_op = 'DELETE'
       and v_effacable <> ''
       and v_effacable = old.piece_liee_id::text
    then
      return old;
    end if;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists capture_rattachements_no_upd on capture.rattachements;
create trigger capture_rattachements_no_upd
  before delete or update on capture.rattachements
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- L'état courant de chaque paire : son dernier fait.
create or replace view public.rattachements_v with (security_invoker = true) as
  select distinct on (r.piece_id, r.piece_liee_id)
         r.id, r.tenant_id, r.piece_id, r.piece_liee_id, r.fait, r.motif,
         r.auteur, r.created_at
    from capture.rattachements r
   order by r.piece_id, r.piece_liee_id, r.created_at desc, r.rang desc;

revoke all on table public.rattachements_v from public, anon, service_role;
grant select on table public.rattachements_v to authenticated;

-- Le dernier fait d'une paire, dans un sens ou dans l'autre.
create or replace function capture.dernier_fait_de_la_paire(p_a uuid, p_b uuid)
returns table (piece_id uuid, piece_liee_id uuid, fait text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.piece_id, r.piece_liee_id, r.fait
    from capture.rattachements r
   where (r.piece_id = p_a and r.piece_liee_id = p_b)
      or (r.piece_id = p_b and r.piece_liee_id = p_a)
   order by r.created_at desc, r.rang desc
   limit 1
$$;
revoke all on function capture.dernier_fait_de_la_paire(uuid, uuid) from public, anon;
grant execute on function capture.dernier_fait_de_la_paire(uuid, uuid) to authenticated;

create or replace function public.piece_rattacher(p_piece uuid, p_liee uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tenant_liee uuid;
  v_vis app.vis_t;
  v_vis_liee app.vis_t;
  v_paire record;
begin
  if p_piece = p_liee then
    raise exception 'Une pièce ne se rattache pas à elle-même.'
      using errcode = 'check_violation';
  end if;
  -- Les deux lignes sont verrouillées dans un ordre fixe : deux rattachements
  -- croisés (A→B et B→A au même instant) ne s'attendent pas l'un l'autre.
  perform 1 from capture.pieces
   where id in (p_piece, p_liee) order by id for update;
  select tenant_id, vis into v_tenant, v_vis from capture.pieces where id = p_piece;
  select tenant_id, vis into v_tenant_liee, v_vis_liee from capture.pieces where id = p_liee;
  if v_tenant is null or v_tenant_liee is null
     or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if v_tenant <> v_tenant_liee then
    raise exception 'Les deux pièces ne sont pas dans le même dossier.'
      using errcode = 'check_violation';
  end if;
  if v_vis = 'personnel'::app.vis_t or v_vis_liee = 'personnel'::app.vis_t then
    raise exception
      'Une pièce de votre espace privé ne se rattache pas : elle n''est pas à la société.'
      using errcode = 'check_violation';
  end if;

  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if found and v_paire.fait = 'rattache' then
    return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', true);
  end if;

  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
  values (v_tenant,
          coalesce(v_paire.piece_id, p_piece),
          coalesce(v_paire.piece_liee_id, p_liee),
          'rattache', auth.uid());
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', false);
end
$$;
revoke all on function public.piece_rattacher(uuid, uuid) from public, anon;
grant execute on function public.piece_rattacher(uuid, uuid) to authenticated;

create or replace function public.piece_detacher(p_piece uuid, p_liee uuid, p_motif text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_paire record;
begin
  perform 1 from capture.pieces
   where id in (p_piece, p_liee) order by id for update;
  select tenant_id into v_tenant from capture.pieces where id = p_piece;
  if v_tenant is null or v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if p_motif is null or length(trim(p_motif)) = 0 then
    raise exception 'Dites pourquoi vous détachez ce document.'
      using errcode = 'check_violation';
  end if;
  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if not found or v_paire.fait <> 'rattache' then
    raise exception 'Ce document n''est pas rattaché à cette pièce.'
      using errcode = 'check_violation';
  end if;
  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, motif, auteur)
  values (v_tenant, v_paire.piece_id, v_paire.piece_liee_id, 'detache', trim(p_motif), auth.uid());
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee);
end
$$;
revoke all on function public.piece_detacher(uuid, uuid, text) from public, anon;
grant execute on function public.piece_detacher(uuid, uuid, text) to authenticated;

comment on table capture.rattachements is
  'Les documents rattachés à une pièce après la lecture (bon de livraison, '
  'avoir, devis…), et leurs détachements motivés. Append-only (R7) : l''état '
  'courant d''une paire est son dernier fait (vue public.rattachements_v). '
  'Les pièces nées d''une autre (reçu, talon) restent liées par source_piece_id.';

commit;
