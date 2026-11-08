-- ======================================================================
--  Un document joint part avec sa pièce (planche 3, approuvée le 7 novembre 2026).
--
--  « Un BL ou un avoir lié part avec sa facture ; un BL ne consomme pas de
--  lecture. » Recette du 7 novembre : le bon de livraison joint à la facture
--  El Manar devait être LU (une lecture du forfait) pour partir, puis
--  s'affichait « À envoyer » alors qu'il accompagnait une facture déjà chez
--  le cabinet (anomalies 4 et 12).
--
--  Ce qui ACCOMPAGNE dans une paire rattachée (`rattachements_v`, fait
--  `rattache`) — la règle tient dans `app.accompagne_dans_la_paire` :
--    — un document non lu, joint à une pièce lue ;
--    — un bon de livraison ou un avoir, joint à une facture.
--  Deux factures rattachées l'une à l'autre ne s'accompagnent pas : chacune
--  part par son propre geste.
--
--  Ce qui change :
--    1. Un document joint part non lu : `une_piece_transmise_lue_d_abord` ne
--       le retient plus. Le cabinet le voit à côté de sa pièce.
--    2. Il part AVEC sa pièce : `piece_envoyer` (la seule porte de l'envoi,
--       à l'unité comme en lot) envoie aussi ses documents joints restés dans
--       la société ; `piece_rattacher` envoie aussitôt le document joint à
--       une pièce déjà chez le cabinet — le BL du retour « justificatif
--       manquant » part avec le renvoi.
--    3. La liste le dit (`PieceLue.jointe`) : jamais « à lire », jamais
--       « à envoyer » à lui seul.
--  Le reste ne change pas : un siège envoie au propriétaire, comme avant ;
--  le droit d'envoyer au cabinet est celui de la pièce.
-- ======================================================================

begin;

-- --- La règle -----------------------------------------------------------------------------

create or replace function app.accompagne_dans_la_paire(
  p_statut text, p_type text, p_statut_mere text, p_type_mere text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_statut = 'capturee' and p_statut_mere is distinct from 'capturee')
      or (p_type in ('bon_livraison', 'avoir')
          and p_type_mere in ('facture_achat', 'facture_vente'))
$$;
comment on function app.accompagne_dans_la_paire(text, text, text, text) is
  'Dans une paire rattachée, la pièce (statut, type) accompagne-t-elle la mère (statut, type) : '
  'un document non lu joint à une pièce lue, ou un BL / un avoir joint à une facture (planche 3).';

-- Les documents qui accompagnent une pièce.
create or replace function app.jointes_de(p_piece uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select j.id
    from public.rattachements_v r
    join capture.pieces mere on mere.id = p_piece
    join capture.pieces j
      on j.id = case when r.piece_id = p_piece then r.piece_liee_id else r.piece_id end
   where (r.piece_id = p_piece or r.piece_liee_id = p_piece)
     and r.fait = 'rattache'
     and app.accompagne_dans_la_paire(j.status, j.document_kind, mere.status, mere.document_kind)
$$;
revoke all on function app.jointes_de(uuid) from public, anon;
grant execute on function app.jointes_de(uuid) to authenticated;

-- La pièce accompagne-t-elle une autre pièce ?
create or replace function app.piece_jointe(p_piece uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.rattachements_v r
      join capture.pieces moi on moi.id = p_piece
      join capture.pieces mere
        on mere.id = case when r.piece_id = p_piece then r.piece_liee_id else r.piece_id end
     where (r.piece_id = p_piece or r.piece_liee_id = p_piece)
       and r.fait = 'rattache'
       and app.accompagne_dans_la_paire(moi.status, moi.document_kind, mere.status, mere.document_kind))
$$;
revoke all on function app.piece_jointe(uuid) from public, anon;
grant execute on function app.piece_jointe(uuid) to authenticated;

-- --- 1. Un document joint part non lu -----------------------------------------------------

create or replace function app.une_piece_transmise_est_lue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vis = 'partage'::app.vis_t
     and old.vis is distinct from new.vis
     and new.status = 'capturee'
     and new.source_piece_id is null
     and not app.remplacement_en_cours(new.id)
     and not app.piece_accompagne(new.id)
     -- Un document joint suit sa pièce, sans lecture (planche 3).
     and not app.piece_jointe(new.id)
     and (auth.uid() is not null or app.api_tenant() is not null)
     -- Au plafond, la pièce part non lue : le cabinet la saisit.
     and (select e.payload ->> 'motif'
            from audit.event_log e
           where e.object_table = 'pieces' and e.object_id = new.id
             and e.action = 'lecture.refusee'
           order by e.at desc
           limit 1) is distinct from 'plafond_atteint'
  then
    raise exception 'refus.envoi.pas_lue' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- --- 2. Il part avec sa pièce -------------------------------------------------------------

-- Envoyer au cabinet les documents joints restés dans la société.
create or replace function app.envoyer_les_jointes(p_piece uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_jointe uuid;
begin
  for v_jointe in
    select j from app.jointes_de(p_piece) j
     where (select x.vis from capture.pieces x where x.id = j) = 'entite'::app.vis_t
  loop
    perform public.capture_piece_set_vis(v_jointe, 'partage'::app.vis_t);
  end loop;
end
$$;
revoke all on function app.envoyer_les_jointes(uuid) from public, anon;
grant execute on function app.envoyer_les_jointes(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.piece_envoyer(p_piece uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_r      jsonb;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;

  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    if v_vis = 'partage'::app.vis_t and v_status = 'retournee' then
      v_r := public.piece_renvoyer(p_piece) || jsonb_build_object('chez', 'cabinet');
      -- Ce qui a été joint pendant le retour part avec le renvoi.
      perform app.envoyer_les_jointes(p_piece);
      return v_r;
    end if;
    v_r := public.capture_piece_set_vis(p_piece, 'partage'::app.vis_t);
    -- Ses documents joints partent avec elle (planche 3).
    perform app.envoyer_les_jointes(p_piece);
    return jsonb_build_object('piece_id', p_piece, 'le', now(),
                              'deja', not (v_r ->> 'changed')::boolean, 'chez', 'cabinet');
  end if;
  return app.envoyer_au_proprietaire(p_piece);
end
$function$;

CREATE OR REPLACE FUNCTION public.piece_rattacher(p_piece uuid, p_liee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_tenant_liee uuid;
  v_vis app.vis_t;
  v_vis_liee app.vis_t;
  v_paire record;
begin
  if p_piece = p_liee then
    raise exception 'refus.rattachement.a_elle_meme'
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
    raise exception 'refus.introuvable.piece' using errcode = '42501';
  end if;
  if v_tenant <> v_tenant_liee then
    raise exception 'refus.rattachement.autre_dossier'
      using errcode = 'check_violation';
  end if;
  if v_vis = 'personnel'::app.vis_t or v_vis_liee = 'personnel'::app.vis_t then
    raise exception
      'refus.rattachement.espace_prive'
      using errcode = 'check_violation';
  end if;

  select * into v_paire from capture.dernier_fait_de_la_paire(p_piece, p_liee);
  if found and v_paire.fait = 'rattache' then
    return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', true);
  end if;

  insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
  values (v_tenant, p_piece, p_liee, 'rattache', auth.uid());

  -- Joint à une pièce déjà chez le cabinet : il la rejoint aussitôt, si la
  -- personne a le droit d'envoyer au cabinet (planche 3).
  if app.a_le_droit(v_tenant, 'envoi.cabinet') then
    if v_vis = 'partage'::app.vis_t then
      perform app.envoyer_les_jointes(p_piece);
    end if;
    if v_vis_liee = 'partage'::app.vis_t then
      perform app.envoyer_les_jointes(p_liee);
    end if;
  end if;
  return jsonb_build_object('piece_id', p_piece, 'piece_liee_id', p_liee, 'deja', false);
end
$function$;

commit;
