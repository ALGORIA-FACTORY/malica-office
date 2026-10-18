-- La suppression libre l'est vraiment.
--
-- ============================================================= LE DÉFAUT RÉEL
--
-- `capture_piece_supprimer` vérifie quatre choses, dans l'ordre : le tenant,
-- la visibilité, le statut, et l'absence de justificatif. Une pièce
-- `personnel` / `capturee` les passe toutes. Puis elle lève :
--
--     R7 : DELETE interdit sur capture.paiements
--          — une correction est une ecriture nouvelle
--
-- Le `delete from capture.pieces` cascade vers `capture.paiements`,
-- `capture.paiement_justificatifs` et `collab.demandes_sur_piece`, et ces
-- trois tables portent le garde STRICT `app.deny_mutation()`, qui ne connaît
-- pas le drapeau `malica.piece_effacable`.
--
-- Il n'y a pas de mystère : le garde permissif a été écrit le 3 septembre
-- pour les cinq tables qui existaient alors. Les trois autres sont nées les
-- 11 et 12 octobre, par le helper, et le helper pose le garde strict. Personne
-- n'a relu la liste.
--
-- ======================================================== CE QUE ÇA PRODUIT
--
-- Toute pièce sur laquelle un paiement a été inscrit est INSUPPRIMABLE, et
-- l'erreur rendue est un `restrict_violation` technique, pas un refus métier.
-- Or saisir le règlement est précisément ce que le produit demande de faire
-- juste après la lecture : le chemin le plus fréquent de l'application est
-- aussi celui qui condamne la pièce.
--
-- La promesse « avant transmission, vous supprimez librement » est donc
-- fausse pour la majorité des pièces, et fausse d'une façon qui ne se voit
-- qu'au moment où quelqu'un essaie.
--
-- ============================================= POURQUOI UN QUATRIÈME PASSAGE
--
-- `capture.paiements.justificatif_piece_id` est en SET NULL vers
-- `capture.pieces`. Supprimer un reçu déclenche donc un UPDATE sur le
-- paiement de la facture — une autre pièce, dont le `piece_id` ne vaut pas le
-- drapeau. Le garde permissif, qui ne tolère que `tg_op = 'DELETE'`, lève.
--
-- On lui apprend ce second cas, et strictement lui : un UPDATE qui ne touche
-- QUE `justificatif_piece_id`, QUE vers NULL, et QUE depuis la pièce en cours
-- d'effacement. Tout le reste continue de lever.

begin;

-- --- 1. Le garde permissif apprend le détachement d'un justificatif --------

create or replace function app.deny_mutation_hors_effacement_de_piece()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_effacable text := coalesce(current_setting('malica.piece_effacable', true), '');
begin
  -- Premier passage, inchangé depuis le 3 septembre : la cascade d'une
  -- suppression de pièce que `capture_piece_supprimer` a validée, et pour
  -- CETTE pièce précisément.
  if tg_op = 'DELETE' and v_effacable = old.piece_id::text then
    return old;
  end if;

  -- Second passage, 18 octobre : le SET NULL d'un justificatif qui disparaît.
  -- Trois conditions cumulées, pour qu'il ne serve à rien d'autre : la pièce
  -- effacée est bien celle que le paiement citait, la colonne part vers NULL,
  -- et AUCUNE autre colonne ne bouge.
  if tg_op = 'UPDATE'
     and tg_table_schema = 'capture'
     and tg_table_name = 'paiements'
     and old.justificatif_piece_id is not null
     and v_effacable = old.justificatif_piece_id::text
     and new.justificatif_piece_id is null
     and to_jsonb(new) - 'justificatif_piece_id'
       = to_jsonb(old) - 'justificatif_piece_id'
  then
    return new;
  end if;

  raise exception
    'R7 : % interdit sur %.% — une correction est une ecriture nouvelle',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on function app.deny_mutation_hors_effacement_de_piece() is
  'Immuabilité R7, levée pour la cascade d''une pièce non engagée et pour le '
  'détachement du justificatif qu''elle emporte. Rien d''autre.';

-- --- 2. Les trois tables oubliées rejoignent le garde permissif ------------
--
-- Elles ne deviennent pas mutables : le garde permissif refuse exactement ce
-- que refusait le strict, à un passage nommé près. C'est la même immuabilité,
-- avec la porte que `capture_piece_supprimer` a le droit d'ouvrir.

drop trigger if exists capture_paiements_no_upd on capture.paiements;
create trigger capture_paiements_no_upd
  before delete or update on capture.paiements
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists capture_paiement_justificatifs_no_upd
  on capture.paiement_justificatifs;
create trigger capture_paiement_justificatifs_no_upd
  before delete or update on capture.paiement_justificatifs
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

drop trigger if exists collab_demandes_sur_piece_no_upd on collab.demandes_sur_piece;
create trigger collab_demandes_sur_piece_no_upd
  before delete or update on collab.demandes_sur_piece
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- --- 3. La suppression d'une pièce transmise, par accord -------------------
--
-- `collab.demandes_sur_piece.objet` admet `'suppression'` depuis le 11
-- octobre. Rien ne l'a jamais produit, et `piece_repondre` ne consomme que
-- `'rappel'` : la moitié de la règle « après transmission, sur accord » n'a
-- jamais existé ailleurs que dans une contrainte CHECK.
--
-- On lui donne son chemin, sur le modèle exact de `capture_piece_set_vis` :
-- un paramètre `p_par_accord` que SEUL `piece_repondre` passe, jamais un
-- écran. La fonction garde ses quatre contrôles — une pièce comptabilisée
-- reste insupprimable, accord compris, parce qu'une écriture s'appuie dessus.

create or replace function public.capture_piece_supprimer(
  p_piece uuid,
  p_par_accord boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vis    text;
  v_status text;
  v_tenant uuid;
begin
  select p.vis::text, p.status, p.tenant_id
    into v_vis, v_status, v_tenant
    from capture.pieces p where p.id = p_piece;

  if v_vis is null then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- `security definer` court-circuite la RLS : on refait ICI le contrôle de
  -- la politique `capture_pieces_del`.
  if v_tenant not in (select app.member_orgs()) then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- Libre tant que personne ne l'a reçue. `personnel` et `entite` sont tous
  -- deux « chez le client » : la seconde a seulement quitté le compte de son
  -- auteur pour la société, et la société a le droit de défaire ce qu'elle a
  -- fait. Seule `partage` a franchi la frontière du cabinet.
  if v_vis = 'partage' and not p_par_accord then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status not in ('capturee', 'lue') then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from socle.ecritures e where e.piece_id = p_piece)
     or exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- La trace survit à la pièce. `audit.event_log` porte `object_id` sans clé
  -- étrangère : ce qui a existé reste dit, même quand l'objet n'est plus là.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord));

  perform set_config('malica.piece_effacable', p_piece::text, true);
  delete from capture.pieces where id = p_piece;
  perform set_config('malica.piece_effacable', '', true);

  return true;
end;
$$;

-- L'ancienne signature à un argument disparaît, pour la raison qui a fait
-- disparaître celle de `capture_piece_set_vis` : deux surcharges, et la garde
-- se contourne en choisissant la plus permissive.
drop function if exists public.capture_piece_supprimer(uuid);

revoke all on function public.capture_piece_supprimer(uuid, boolean) from public, anon;
grant execute on function public.capture_piece_supprimer(uuid, boolean) to authenticated;

-- --- 4. `piece_repondre` tranche enfin les deux objets ---------------------

create or replace function public.piece_repondre(
  p_piece uuid, p_objet text, p_accorde boolean, p_note text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant  uuid;
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

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.demande_tranchee',
          jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde));

  if p_accorde then
    if p_objet = 'rappel' then
      perform public.capture_piece_set_vis(p_piece, 'personnel'::app.vis_t, true);
    elsif p_objet = 'suppression' then
      -- `collab.demandes_sur_piece` cascade depuis la pièce : la réponse
      -- qu'on vient d'inscrire disparaîtra avec elle, et c'est cohérent —
      -- une demande sur un objet qui n'existe plus n'a plus d'objet.
      --
      -- Ce qui SURVIT, et qui doit survivre : la ligne `piece.supprimee` de
      -- `audit.event_log` (dont `object_id` n'a pas de clé étrangère) et la
      -- notification ci-dessus (dont la pièce n'est qu'une donnée du
      -- `payload`). Le cabinet garde donc trace de ce qu'il a accordé, même
      -- quand la pièce n'est plus là pour en témoigner.
      perform public.capture_piece_supprimer(p_piece, true);
    end if;
  end if;

  return jsonb_build_object('piece_id', p_piece, 'objet', p_objet, 'accorde', p_accorde);
end
$$;

revoke all on function public.piece_repondre(uuid, text, boolean, text) from public, anon;
grant execute on function public.piece_repondre(uuid, text, boolean, text) to authenticated;

comment on function public.capture_piece_supprimer(uuid, boolean) is
  'LA SEULE porte par laquelle une pièce disparaît. Libre tant que le cabinet '
  'ne l''a pas reçue ; sur accord inscrit ensuite, que seul `piece_repondre` '
  'passe. Jamais sur une pièce comptabilisée, accord compris.';

commit;
