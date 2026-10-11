-- Une pièce partie ne revient que par accord du cabinet.
--
-- ================================================================= POURQUOI
--
-- 11 octobre 2026 : « dans la partie PME, le rappel de la pièce doit être
-- approuvé par le cabinet ».
--
-- La veille, j'avais livré un rappel UNILATÉRAL : un bouton qui remettait la
-- pièce chez le dirigeant, sans que personne au cabinet le sache. Je l'avais
-- fait pour une bonne raison — une pièce transmise par erreur était un état
-- dont on ne pouvait pas sortir — et j'ai corrigé un défaut par un autre.
--
-- Le cabinet travaille sur ce qu'il a reçu. Une pièce qui disparaît de sa
-- file pendant qu'il la supervise, sans un mot, est pire que l'état bloqué
-- qu'on voulait défaire.
--
-- ====================================== LE MÊME MÉCANISME QUE LA SUPPRESSION
--
-- Le 7 octobre : « une pièce transmise au cabinet peut être effacée par
-- accord du cabinet ». C'est la même phrase, le même geste, la même partie
-- qui tranche. En faire deux mécanismes les ferait diverger — l'un gagnerait
-- une notification que l'autre n'aurait pas, l'un garderait une trace que
-- l'autre perdrait.
--
-- Une table, deux motifs.
--
-- ======================================================================== R7
--
-- Append-only. Une demande n'est pas une ligne qu'on fait passer de « en
-- attente » à « accordée » : c'est une SUITE DE FAITS — demandée le 11,
-- accordée le 12 — et l'état courant est le dernier fait. Réécrire la ligne
-- effacerait qui a demandé, quand, et pourquoi.
--
-- ===================================================================== R11
--
-- Aucune donnée de référence ici : une table de tenant, et les horodatages
-- techniques que R11 autorise nommément.

create table if not exists collab.demandes_sur_piece (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations(id) on delete cascade,
  piece_id     uuid not null references capture.pieces(id) on delete cascade,

  -- Ce que la PME demande. Deux motifs, un mécanisme.
  objet        text not null check (objet in ('rappel', 'suppression')),

  -- Le fait inscrit. L'état courant d'une demande est son dernier fait.
  fait         text not null check (fait in ('demandee', 'accordee', 'refusee')),

  -- Pourquoi. Obligatoire sur un refus : un refus sans motif n'apprend rien
  -- à celui qui a demandé, et la question reviendra la semaine suivante.
  note         text,

  auteur       uuid,
  created_at   timestamptz not null default now(),

  constraint demandes_refus_motive
    check (fait <> 'refusee' or (note is not null and length(trim(note)) > 0))
);

-- R6 : l'index mène par `tenant_id`.
create index if not exists demandes_sur_piece_tenant_idx
  on collab.demandes_sur_piece (tenant_id, piece_id, created_at desc);

-- Pas de visibilité par pièce ici : une demande ne porte que sur une pièce
-- DÉJÀ partagée, donc déjà visible du cabinet. Lui demander en plus de
-- cocher une visibilité serait une condition qui ne distingue rien.
select app.enable_tenant_rls('collab', 'demandes_sur_piece', false, true);

create or replace view public.demandes_sur_piece_v with (security_invoker = true) as
  select id, tenant_id, piece_id, objet, fait, note, auteur, created_at
    from collab.demandes_sur_piece;
revoke all on table public.demandes_sur_piece_v from public, anon, service_role;
grant select on table public.demandes_sur_piece_v to authenticated;

-- --- La PME demande ----------------------------------------------------------------------------

create or replace function public.piece_demander(p_piece uuid, p_objet text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis app.vis_t;
  v_status text;
  v_dernier text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  -- Une pièce qu'on n'a pas envoyée se reprend sans demander : il n'y a
  -- personne à qui demander, et exiger un accord inexistant bloquerait le
  -- dirigeant chez lui.
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'cette piece n''est pas partagee : rien a demander'
      using errcode = 'check_violation';
  end if;

  -- Deux demandes identiques en attente ne valent pas mieux qu'une, et la
  -- file du cabinet se remplirait de doublons.
  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet
   order by d.created_at desc limit 1;
  if v_dernier = 'demandee' then
    return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', true);
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, auteur)
  values (v_tenant, p_piece, p_objet, 'demandee', auth.uid());

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet));

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'deja', false);
end
$$;

revoke all on function public.piece_demander(uuid, text) from public, anon;
grant execute on function public.piece_demander(uuid, text) to authenticated;

-- --- Le cabinet tranche -------------------------------------------------------------------------
--
-- Et l'accord FAIT la chose : accorder un rappel remet la pièce chez le
-- dirigeant dans la même transaction. Deux gestes séparés laisseraient une
-- demande accordée sans effet, et personne ne saurait laquelle des deux
-- vérités croire.

create or replace function public.piece_repondre(
  p_piece uuid, p_objet text, p_accorde boolean, p_note text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_dernier text;
begin
  select tenant_id into v_tenant from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  select d.fait into v_dernier
    from collab.demandes_sur_piece d
   where d.piece_id = p_piece and d.objet = p_objet
   order by d.created_at desc limit 1;
  if v_dernier is distinct from 'demandee' then
    raise exception 'aucune demande en attente sur cette piece'
      using errcode = 'check_violation';
  end if;

  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  values (v_tenant, p_piece, p_objet,
          case when p_accorde then 'accordee' else 'refusee' end, p_note, auth.uid());

  -- L'accord agit. Le refus laisse la pièce où elle est, et sa note dit
  -- pourquoi.
  if p_accorde and p_objet = 'rappel' then
    perform public.piece_definir_visibilite(p_piece, 'personnel'::app.vis_t);
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde));

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

revoke all on function public.piece_repondre(uuid, text, boolean, text) from public, anon;
grant execute on function public.piece_repondre(uuid, text, boolean, text) to authenticated;

comment on table collab.demandes_sur_piece is
  'Ce que la PME demande au cabinet sur une pièce déjà transmise : la '
  'rappeler, ou l''effacer. Une table et deux motifs plutôt que deux '
  'mécanismes, qui divergeraient. Append-only (R7) : une demande est une '
  'suite de faits — demandée, puis accordée ou refusée — et l''état courant '
  'est le dernier. Réécrire la ligne effacerait qui a demandé et quand.';
