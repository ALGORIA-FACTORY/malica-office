-- Une version précédente se lit à travers sa version courante (revue Codex
-- de #127, 29 octobre 2026).
--
-- La CAUSE des constats en série : chaque dépendant d'une pièce (règlements,
-- reçus, justificatifs, lecture, graphe des documents liés) jugeait l'accès
-- sur la version où il avait été saisi, et l'on propageait la visibilité aux
-- versions précédentes au coup par coup. Une photo de la société, remplacée,
-- dont la remplaçante part ensuite au cabinet : le cabinet ne voyait pas les
-- règlements hérités — aucune propagation ne jouait dans ce sens.
--
-- La règle, posée une fois : une version précédente n'a plus de visibilité
-- propre. `app.piece_lisible` — que les politiques des onze tables dépendantes
-- appellent — et la politique de lecture des pièces jugent la version
-- COURANTE. Les faits ne bougent pas (R7). La confidentialité tient par la
-- même règle : une version dont la courante est privée, ou jamais partagée,
-- reste invisible au cabinet.
--
-- Ce qui devient inutile et part : la propagation de la visibilité aux
-- versions précédentes dans `capture_piece_set_vis`, et l'exception du garde
-- qui la laissait passer (`malica.suit_la_version`). Ce qui reste : les reçus
-- et justificatifs de chaque version suivent la pièce hors du cabinet — ce
-- sont des pièces à part entière, avec leur propre visibilité, pas des
-- versions.

begin;

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
          or (p.vis = 'entite'::app.vis_t  and p.tenant_id in (select app.member_orgs()))
          or (p.vis = 'partage'::app.vis_t and (
                p.tenant_id in (select app.member_orgs())
                or p.tenant_id in (select app.engaged_orgs())))))
        or (p.archivee_le is not null
            and p.tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(p.id))
        -- L'exception, et elle est nommée.
        or app.plateforme_requise(p.tenant_id)
      )
  )
$$;

-- La même règle sur les pièces elles-mêmes : une pièce remplacée se lit comme
-- sa version courante ; les autres, comme avant (`20261029120000`). Le test
-- d'appartenance au registre est une sous-requête sans corrélation : évaluée
-- une fois, hachée.
drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    case when id in (select r.piece_id from capture.remplacements r)
      then app.piece_lisible(id)
      else (
           (archivee_le is null and (
                (vis = 'personnel'::app.vis_t and created_by = auth.uid())
             or (vis = 'entite'::app.vis_t  and tenant_id in (select app.member_orgs()))
             or (vis = 'partage'::app.vis_t and (
                   tenant_id in (select app.member_orgs())
                   or tenant_id in (select app.engaged_orgs())))))
        or (archivee_le is not null
            and tenant_id in (select app.engaged_orgs())
            and app.piece_connue_du_cabinet(id))
        or app.plateforme_requise(tenant_id))
    end
  );

-- Le garde d'une version précédente redevient ce qu'il était : seule son
-- archive se pose ; plus aucune visibilité à propager (`20261029120000`).
create or replace function app.une_version_precedente_ne_bouge_plus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from capture.remplacements r where r.piece_id = old.id) then
    if tg_op = 'UPDATE'
       and to_jsonb(new) - 'archivee_le' - 'updated_at'
         = to_jsonb(old) - 'archivee_le' - 'updated_at' then
      return new;
    end if;
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- `capture_piece_set_vis` : reprise de `20261029130000`, sans la propagation
-- aux versions précédentes.

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

  -- Une pièce qui justifie une écriture ne va pas en espace personnel, d'où
  -- qu'elle vienne (recette du 20 octobre 2026 : depuis `entite`, elle y
  -- allait). Comptabilisée par le statut, ou par une écriture vivante.
  if p_vis = 'personnel'::app.vis_t
     and (v_status in ('comptabilisee','supervisee')
          or exists (select 1 from socle.ecritures e
                      where e.piece_id = p_piece and e.status = 'booked'
                        and e.reverses_id is null
                        and not exists (select 1 from socle.ecritures r
                                         where r.reverses_id = e.id and r.status = 'booked')))
  then
    raise exception 'une piece comptabilisee reste dans la societe' using errcode = 'check_violation';
  end if;

  -- Défaut de paiement : la garde vit sur la table (déclencheur
  -- `une_piece_transmise_exige_une_licence_active`, à l'insertion ET au
  -- passage en `partage`) — une seule règle, écrite une fois.

  -- Quitter `partage`, c'est retirer au cabinet ce qu'il a reçu : sur son
  -- accord, ou parce qu'il l'a lui-même retournée au client — vers la SOCIÉTÉ
  -- seulement : une pièce retournée ne part jamais dans un espace privé
  -- (décision du 28 octobre 2026).
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    v_rendue := v_status = 'retournee' and p_vis = 'entite'::app.vis_t;
    -- L'accord se dérive de la donnée, pas d'un drapeau.
    if not v_rendue and not app.accord_donne(p_piece, 'rappel') then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Après la capture, sortir une pièce de la société relève du propriétaire.
  if p_vis = 'personnel'::app.vis_t
     and v_old = 'entite'::app.vis_t
     and not app.has_org_role(v_tenant, array['dirigeant'])
  then
    raise exception 'sortir une piece de la societe releve du proprietaire'
      using errcode = 'check_violation';
  end if;

  -- Le retour est clos : la pièce n'est plus chez le cabinet, ce qu'il avait
  -- proposé sur elle n'a plus d'objet.
  if v_rendue then
    perform app.piece_oublie_ses_propositions(p_piece);
  end if;

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- La décision de la garder est à reprendre.
         gardee_le = null,
         status = case when v_rendue then app.statut_hors_retour(p_piece) else status end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  -- Ce qui est issu de la pièce (reçu, justificatif) n'est jamais partagé si
  -- elle ne l'est pas : il la suit hors du cabinet. Une pièce dérivée
  -- comptabilisée, si elle existait, resterait.
  --
  -- La pièce, c'est toutes ses versions : les reçus de CHACUNE la suivent. Ses
  -- photos précédentes, elles, n'ont rien à suivre — elles se lisent à travers
  -- la photo courante (`app.piece_lisible`).
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

  -- Le client garde ce que le cabinet lui avait retourné : le cabinet le sait.
  if v_rendue and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.gardee', jsonb_build_object('piece_id', p_piece, 'vis', p_vis));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;


commit;
