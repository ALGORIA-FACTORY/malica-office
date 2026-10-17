-- Corrigée après coup, une pièce revient « à revalider ».
--
-- ================================================================== POURQUOI
--
-- La règle du retour, posée le 17 octobre, a trois états. Le troisième dit :
-- « une correction sur une pièce transmise la renvoie en *à revalider* chez
-- le cabinet — il refait son travail, et c'est normal ».
--
-- Cet état n'existait pas. `capture.pieces.status` admet sept valeurs, et
-- aucune ne le dit :
--
--   capturee · lue · proposee · confirmee · comptabilisee · supervisee · retournee
--
-- `retournee` en est proche, et c'est le piège : elle veut dire « le CABINET
-- l'a rendue », pas « le CLIENT l'a corrigée ». Les confondre, c'est perdre
-- qui a bougé — et donc, dans la file de Mondher, perdre la différence entre
-- un rejet qu'il a prononcé et une reprise qu'il doit faire. Deux travaux
-- différents, deux piles différentes.
--
-- Décision du 18 octobre : une huitième valeur, et les deux sens restent
-- distincts dans le journal.
--
-- ============================================== POURQUOI UNE CONTRAINTE, PAS UN ENUM
--
-- `status` est un `text` sous CHECK depuis l'origine. On ne change pas de
-- mécanisme pour une valeur : une contrainte se remplace dans la même
-- transaction que le reste, un type énuméré non (voir `20261018100000`).

begin;

-- --- 1. La huitième valeur --------------------------------------------------

alter table capture.pieces drop constraint if exists pieces_status_check;

alter table capture.pieces add constraint pieces_status_check
  check (status in (
    'capturee',       -- photographiée, pas encore lue
    'lue',            -- Malica l'a lue
    'proposee',       -- une écriture est proposée
    'confirmee',      -- admise depuis l'origine, jamais posée (voir R9)
    'comptabilisee',  -- une écriture s'appuie dessus
    'supervisee',     -- le cabinet a revu
    'retournee',      -- LE CABINET la rend au client
    'a_revalider'     -- LE CLIENT l'a corrigée après transmission
  ));

-- --- 2. La correction d'une pièce partie ------------------------------------
--
-- Une seule porte, comme pour la visibilité et la suppression. Elle ne
-- corrige rien elle-même : la correction est une `capture.precisions`, un
-- ajout daté (R7). Elle fait ce que l'écriture d'une précision ne peut pas
-- faire seule — rendre la pièce au cabinet, et le lui dire.

create or replace function public.piece_corriger_apres_transmission(
  p_piece uuid, p_champ text, p_valeur text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if v_vis <> 'partage'::app.vis_t then
    raise exception 'cette piece n''est pas partie : corrigez-la directement'
      using errcode = 'check_violation';
  end if;

  -- Une écriture s'appuie dessus. Le cabinet doit la contrepasser lui-même ;
  -- une correction silencieuse rendrait son grand livre faux sans qu'il le
  -- sache. La demande existe pour ça (`collab.demandes_sur_piece`).
  if v_status in ('comptabilisee', 'supervisee') then
    raise exception
      'Cette pièce est déjà comptabilisée : demandez son retour à votre cabinet.'
      using errcode = 'check_violation';
  end if;

  -- La correction elle-même : un ajout, jamais une réécriture.
  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, p_champ, p_valeur);

  update capture.pieces
     set status = 'a_revalider', updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.corrigee_apres_transmission',
          'capture', 'pieces', p_piece,
          jsonb_build_object('champ', p_champ, 'statut_avant', v_status));

  -- Sans cette ligne, le cabinet ne saurait pas qu'il a du travail : la pièce
  -- changerait d'état dans une file qu'il ne regarde pas en permanence.
  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.a_revalider',
          jsonb_build_object('piece_id', p_piece, 'champ', p_champ));

  return jsonb_build_object(
    'piece_id', p_piece, 'status', 'a_revalider', 'champ', p_champ);
end
$$;

revoke all on function public.piece_corriger_apres_transmission(uuid, text, text)
  from public, anon;
grant execute on function public.piece_corriger_apres_transmission(uuid, text, text)
  to authenticated;

comment on function public.piece_corriger_apres_transmission(uuid, text, text) is
  'Corriger une pièce transmise : la précision s''ajoute, la pièce revient '
  '« à revalider », et le cabinet est prévenu. Jamais sur une pièce '
  'comptabilisée — là, c''est une demande de retour.';

-- --- 3. Une pièce à revalider se relit sans rien coûter ---------------------
--
-- `facturation.lectures` porte un unique sur `piece_id` : la relecture est
-- déjà gratuite, pour cette raison exactement. On le redit ici parce que
-- c'est ce qui rend cette migration acceptable commercialement — corriger
-- après transmission ne débite rien, sinon le client apprendrait à ne pas
-- corriger, et c'est le cabinet qui paierait l'erreur.

commit;
