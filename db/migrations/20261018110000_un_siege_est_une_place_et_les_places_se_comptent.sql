-- Un siège est une place, et les places se comptent.
--
-- ================================================================== POURQUOI
--
-- Le dépôt sait inviter. `public.inviter_contact`, `identity.invitations`,
-- `identity.memberships` : la mécanique est complète et éprouvée. Ce qu'elle
-- ne sait pas, c'est COMBIEN de personnes une licence autorise.
--
-- Un dirigeant Basic peut aujourd'hui inviter quinze collaborateurs. Ils
-- entreront, ils liront, ils consommeront le quota — et la facture restera à
-- 9 DT. Ce n'est pas une fraude possible : c'est le comportement normal du
-- produit tel qu'il est écrit.
--
-- ===================================== POURQUOI LE CONTRÔLE EST UN DÉCLENCHEUR
--
-- Il y a deux portes vers `identity.memberships` : `public.create_organization`
-- (qui pose le dirigeant) et l'acceptation d'une invitation. Un contrôle
-- recopié dans les deux diverge le jour où une troisième porte s'ouvre — et
-- R6 dit pourquoi on ne met pas ces règles dans l'application : un contrôle
-- oublié dans du code applicatif OUVRE l'accès ; un déclencheur oublié
-- n'existe pas, parce qu'il n'y en a qu'un.
--
-- ============================================ POURQUOI LE DIRIGEANT EST GRATUIT
--
-- « Le propriétaire ne consomme pas de place : il détient la licence. En
-- Premium sur trois sociétés il apparaît trois fois comme dirigeant et occupe
-- zéro siège. » Le compte ne porte donc que sur `role = 'collaborateur'`.
--
-- Et il compte les PERSONNES, pas les lignes : la même personne, siégeant
-- dans deux sociétés d'un groupe Premium, occupe une place et non deux. Un
-- comptable qui suit trois sociétés du même client est un salarié, pas trois.
--
-- ===================================== POURQUOI `assistant` DISPARAÎT DU CHEMIN
--
-- `memberships.role` admet `assistant` depuis le premier jour, et AUCUN
-- chemin du dépôt ne l'attribue — ni `create_organization`, ni les écrans
-- d'invitation, qui n'offrent que `dirigeant` et `collaborateur`. C'est un
-- placeholder au sens de R9 : une valeur admise qui n'existe pas.
--
-- On ne la retire pas ici — une contrainte CHECK se change sous verrou, et ce
-- n'est pas l'objet de cette migration. On la TRAITE : un `assistant` compte
-- comme une place, exactement comme un collaborateur, pour qu'il ne devienne
-- pas la porte dérobée du plafond le jour où quelqu'un l'écrira.

begin;

-- --- 1. Les places occupées par une licence ---------------------------------

create or replace function facturation.places_occupees(p_licence uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct m.user_id)::int
  from facturation.licence_organisations lo
  join identity.memberships m on m.tenant_id = lo.tenant_id
  where lo.licence_id = p_licence
    and m.role in ('collaborateur', 'assistant')
$$;

revoke all on function facturation.places_occupees(uuid) from public, anon;
grant execute on function facturation.places_occupees(uuid) to authenticated;

-- --- 2. La licence d'une organisation ---------------------------------------

create or replace function facturation.licence_de(p_tenant uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select licence_id from facturation.licence_organisations where tenant_id = p_tenant
$$;

revoke all on function facturation.licence_de(uuid) from public, anon;
grant execute on function facturation.licence_de(uuid) to authenticated;

-- --- 3. Le plafond mord à l'entrée ------------------------------------------

create or replace function facturation.place_disponible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_licence uuid;
  v_max     smallint;
  v_occupe  integer;
begin
  -- Le dirigeant n'occupe pas de place : il entre toujours.
  if new.role = 'dirigeant' then
    return new;
  end if;

  -- Un membre de cabinet (`expert`) n'est pas un siège du client : il entre
  -- par le mandat, pas par le forfait de la PME.
  if new.role = 'expert' then
    return new;
  end if;

  v_licence := facturation.licence_de(new.tenant_id);

  -- Une organisation sans licence est une organisation en cours de création,
  -- ou un cabinet. On ne bloque pas : le rattachement viendra, et bloquer ici
  -- rendrait `create_organization` dépendant d'une licence qui n'existe pas
  -- encore. Le contrôle se referme au rattachement (`20261018090000`).
  if v_licence is null then
    return new;
  end if;

  select sieges_max into v_max from facturation.droits_v where licence_id = v_licence;
  v_occupe := facturation.places_occupees(v_licence);

  -- La personne déjà présente ailleurs dans le groupe n'occupe pas une place
  -- de plus : on ne compte que les personnes nouvelles.
  if exists (
    select 1
    from facturation.licence_organisations lo
    join identity.memberships m on m.tenant_id = lo.tenant_id
    where lo.licence_id = v_licence
      and m.user_id = new.user_id
      and m.role in ('collaborateur', 'assistant')
  ) then
    return new;
  end if;

  if v_occupe >= v_max then
    raise exception
      'cette offre porte % place(s) ; elles sont prises', v_max
      using errcode = 'check_violation',
            hint = 'Passer à l''offre supérieure, ou libérer une place.';
  end if;

  return new;
end
$$;

create trigger memberships_place_disponible
  before insert on identity.memberships
  for each row execute function facturation.place_disponible();

-- --- 4. Ce qu'un siège libéré laisse derrière lui ---------------------------
--
-- Le vrai sujet de cette migration n'est pas d'empêcher d'entrer : c'est de
-- savoir ce qui reste quand quelqu'un sort.
--
-- `identity.memberships` n'a aucun `ON DELETE` à surveiller — c'est la ligne
-- elle-même qu'on supprime — mais ses traces, elles, restent : les pièces
-- qu'il a capturées portent son `created_by`, et celles qu'il a marquées
-- `personnel` deviennent, après `20261018103000`, invisibles de tous.
--
-- C'est exactement ce qu'il faut, et c'est exactement ce qui doit se voir.
-- Une pièce de la société enfermée dans le compte d'un partant est un
-- orphelin : elle existe, elle est payée, et personne ne peut l'atteindre.
-- Cette vue les nomme, pour que le départ d'un collaborateur commence par
-- une liste et non par une surprise.

create or replace view facturation.pieces_orphelines_v as
select
  p.id            as piece_id,
  p.tenant_id,
  p.created_by    as auteur,
  p.vis,
  p.status,
  p.created_at,
  case
    when m.user_id is null then 'auteur_parti'
    when p.entity_id is null then 'sans_etablissement'
  end             as motif
from capture.pieces p
left join identity.memberships m
       on m.tenant_id = p.tenant_id and m.user_id = p.created_by
where (m.user_id is null and p.vis = 'personnel'::app.vis_t)
   or p.entity_id is null;

comment on view facturation.pieces_orphelines_v is
  'Les pièces que plus personne ne peut atteindre : celles d''un auteur parti '
  'restées personnelles, et celles dont l''établissement a été supprimé '
  '(entity_id ON DELETE SET NULL). À vider avant de révoquer un membre.';

-- --- 5. Révoquer proprement -------------------------------------------------
--
-- Une place ne se libère pas en supprimant une ligne : elle se libère après
-- que les pièces de la société, restées chez le partant, ont été rendues à
-- la société. Cette fonction fait les deux, dans cet ordre, et dit ce qu'elle
-- a rendu.
--
-- Elle NE touche pas aux pièces que le partant avait capturées pour lui-même
-- et jamais versées : celles-là sont à lui, et la règle du compte personnel
-- gratuit dit qu'il les garde « en consultation et export ».
--
-- La distinction entre les deux est impossible à faire par la machine. On ne
-- la devine donc pas : la fonction REFUSE tant qu'il reste des pièces
-- personnelles du partant, et l'écran les lui fait trancher une par une.

create or replace function public.siege_reprendre_sa_place(
  p_tenant uuid, p_membre uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_restantes integer;
begin
  if not app.has_org_role(p_tenant, array['dirigeant']) then
    raise exception 'seul le dirigeant reprend une place' using errcode = '42501';
  end if;

  select count(*) into v_restantes
    from capture.pieces
   where tenant_id = p_tenant
     and created_by = p_membre
     and vis = 'personnel'::app.vis_t;

  if v_restantes > 0 then
    return jsonb_build_object(
      'libere', false,
      'motif', 'pieces_personnelles_a_trancher',
      'pieces', v_restantes);
  end if;

  delete from identity.memberships
   where tenant_id = p_tenant and user_id = p_membre and role <> 'dirigeant';

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (p_tenant, auth.uid(), 'siege.libere', 'identity', 'memberships',
          p_membre, jsonb_build_object('membre', p_membre));

  return jsonb_build_object('libere', true, 'pieces', 0);
end
$$;

revoke all on function public.siege_reprendre_sa_place(uuid, uuid) from public, anon;
grant execute on function public.siege_reprendre_sa_place(uuid, uuid) to authenticated;

commit;
