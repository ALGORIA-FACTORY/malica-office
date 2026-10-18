-- « Personnel » veut dire à moi, pas à la société.
--
-- ============================================================= LE DÉFAUT RÉEL
--
-- L'écran de l'espace privé promet, mot pour mot : « Invisible pour votre
-- cabinet, vos sièges et la vue consolidée ». Les deux derniers tiers de
-- cette phrase sont faux, et le dépôt le dit sans ambiguïté.
--
-- `app.enable_tenant_rls(..., p_visibility => true)` produit ceci :
--
--   (tenant_id in (select app.member_orgs())
--    or (vis = 'partage' and tenant_id in (select app.engaged_orgs()))
--    or app.is_platform())
--
-- La première ligne ne regarde pas `vis`. Un membre de l'organisation voit
-- TOUTES les lignes de l'organisation, personnelles comprises. `vis` ne
-- cache qu'au cabinet. Et sur les 94 politiques du dépôt, AUCUNE ne filtre
-- par `auth.uid()` ou par `created_by` : il n'existe aujourd'hui aucune
-- dimension personnelle dans l'isolation.
--
-- Conséquence concrète, en Team : le dirigeant ouvre la bibliothèque et voit
-- l'ordonnance que son comptable a photographiée. Personne n'a écrit ce
-- comportement ; il est le défaut d'une règle écrite pour un seul membre.
--
-- ======================================================= POURQUOI C'EST GRAVE
--
-- Ce n'est pas une fuite entre clients — R6 tient, les tenants sont étanches.
-- C'est une promesse d'écran que la base ne tient pas, sur la seule
-- fonctionnalité du produit dont l'argument est la confidentialité. Un
-- collaborateur qui découvre que son patron voit son espace « privé » ne
-- redéposera jamais rien, et aura raison.
--
-- ============================================================ CE QU'ON ÉCRIT
--
-- Trois lieux, trois lecteurs :
--
--   personnel → son auteur, et lui seul ;
--   entite    → les membres de l'organisation, pas le cabinet ;
--   partage   → les membres, ET le cabinet sous mandat actif.
--
-- Le dirigeant n'est pas une exception : son espace personnel est aussi privé
-- que celui de son comptable. Une hiérarchie qui s'arrête à la porte du chef
-- n'est pas une règle de confidentialité, c'est un privilège.
--
-- ================================================= CE QUE CELA NE CHANGE PAS
--
-- L'écriture reste réservée aux membres du tenant, et `capture_piece_set_vis`
-- demeure la seule porte. La conservation ne bouge pas : une pièce
-- personnelle existe, elle est seulement invisible — le propriétaire de
-- l'entité peut toujours la réclamer par `collab.demandes_sur_piece`, qui est
-- précisément l'objet de cette table.
--
-- ========================================= CE QUE LE CABINET PEUT ENCORE ÉCRIRE
--
-- `pieces_upd_cabinet` (`20260825211034`) autorise le cabinet à écrire sur une
-- pièce `partage`. On n'y touche pas : elle nomme déjà `partage`, donc ni le
-- personnel ni l'entité ne lui sont ouverts, et la règle « le cabinet ne
-- travaille que sur ce qu'il a reçu » tient sans modification.
--
-- ===================================================== LA MIGRATION DES LIGNES
--
-- `visibilite-a-la-capture.ts` renvoie `personnel` pour TOUTE capture depuis
-- le 7 octobre. L'essentiel du stock est donc `personnel` sans que personne
-- ne l'ait voulu personnel : ce sont des pièces en attente de décision, pas
-- des papiers privés. Les basculer en `entite` reviendrait à les exposer ;
-- les laisser en `personnel` les enferme chez leur auteur.
--
-- On les laisse, et c'est le bon choix : leur auteur est, dans la quasi-
-- totalité des cas, le dirigeant lui-même, et une pièce qu'il a photographiée
-- lui reste visible. Le cas résiduel — un collaborateur ayant capturé avant
-- cette migration — se traite par `collab.demandes_sur_piece`, pas par un
-- UPDATE de masse qui déciderait à la place des gens.

begin;

-- --- 1. La politique de lecture de `capture.pieces` -------------------------
--
-- `app.is_platform()` s'écrit `(select app.is_platform())`, comme partout
-- depuis `20260830140000` : enveloppé, le planificateur en fait un InitPlan
-- évalué une fois par requête au lieu d'un appel par ligne. La raison est
-- mesurée dans l'en-tête de cette migration-là ; on ne la redécouvre pas.

drop policy if exists capture_pieces_sel on capture.pieces;

create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    (select app.is_platform())
    or (vis = 'personnel'::app.vis_t and created_by = auth.uid())
    or (vis = 'entite'::app.vis_t   and tenant_id in (select app.member_orgs()))
    or (vis = 'partage'::app.vis_t  and (
          tenant_id in (select app.member_orgs())
          or tenant_id in (select app.engaged_orgs())))
  );

-- --- 2. Les tables qui pendent à une pièce ----------------------------------
--
-- `capture.extractions`, `analyses`, `citations`, `token_plan`, `precisions`,
-- `conformite`, `piece_versions`, `paiements`, `paiement_justificatifs` et
-- `piece_articles` portent un `tenant_id` et sont donc visibles de tout membre
-- — y compris quand la pièce dont elles dépendent est personnelle. Laisser
-- ces tables en l'état rendrait la pièce invisible et sa LECTURE lisible :
-- le montant, le fournisseur et les lignes d'une ordonnance resteraient
-- consultables par le dirigeant. La fuite passerait par la porte de service.
--
-- On les aligne sur la pièce, par une fonction unique plutôt que par dix
-- politiques recopiées.

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
        (select app.is_platform())
        or (p.vis = 'personnel'::app.vis_t and p.created_by = auth.uid())
        or (p.vis = 'entite'::app.vis_t   and p.tenant_id in (select app.member_orgs()))
        or (p.vis = 'partage'::app.vis_t  and (
              p.tenant_id in (select app.member_orgs())
              or p.tenant_id in (select app.engaged_orgs())))
      )
  )
$$;

revoke all on function app.piece_lisible(uuid) from public, anon;
grant execute on function app.piece_lisible(uuid) to authenticated;

comment on function app.piece_lisible(uuid) is
  'La lecture d''une pièce suit la pièce. Une seule définition, pour que les '
  'dix tables qui en dépendent ne puissent pas diverger.';

do $$
declare
  t text;
  tables text[] := array[
    'extractions', 'analyses', 'citations', 'token_plan', 'precisions',
    'conformite', 'piece_versions', 'paiements', 'piece_articles'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on capture.%I', 'capture_' || t || '_sel', t);
    execute format(
      'create policy %I on capture.%I for select to authenticated '
      || 'using (app.piece_lisible(piece_id))',
      'capture_' || t || '_sel', t);
  end loop;
end
$$;

-- `capture.paiement_justificatifs` ne porte pas `piece_id` mais `paiement_id` :
-- elle remonte d'un cran.
drop policy if exists capture_paiement_justificatifs_sel on capture.paiement_justificatifs;
create policy capture_paiement_justificatifs_sel on capture.paiement_justificatifs
  for select to authenticated
  using (exists (
    select 1 from capture.paiements p
    where p.id = paiement_id and app.piece_lisible(p.piece_id)
  ));

-- --- 3. La porte apprend le troisième lieu ----------------------------------
--
-- ATTENTION — la signature est à TROIS arguments depuis `20261011220000`, et
-- la version à deux a été DROPPÉE le même jour, délibérément : « la laisser
-- vivre à côté rendrait la garde contournable par le simple choix de la
-- surcharge ». On remplace donc la fonction à trois arguments, et on n'en
-- recrée surtout pas une à deux.
--
-- Ce qui change, et rien d'autre :
--
--   — `entite` devient une destination permise ;
--   — `transmise_le` ne se pose QUE sur `partage`. Avec trois lieux, le
--     raccourci « tout ce qui n'est pas personnel est transmis » devient faux,
--     et dater une pièce restée dans la société la ferait entrer dans une
--     déclaration qu'elle n'a pas rejointe ;
--   — B7 : un siège ne sort pas une pièce de la société, même vers lui-même ;
--   — `entite` notifie le dirigeant, qui a quelque chose à valider.
--
-- Ce qui ne change pas : la garde `partage → personnel` par accord seulement,
-- et le refus absolu sur une pièce comptabilisée.

create or replace function public.capture_piece_set_vis(
  p_piece uuid,
  p_vis app.vis_t,
  p_par_accord boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_old    app.vis_t;
  v_status text;
  v_auteur uuid;
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

  -- Quitter `partage` — vers l'entité comme vers le personnel — c'est retirer
  -- au cabinet ce qu'il a reçu. La garde de `20261011220000` s'étend donc au
  -- troisième lieu : elle portait sur la destination, elle porte désormais
  -- sur l'ORIGINE, qui est ce qui compte.
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    if not p_par_accord then
      raise exception 'une piece transmise ne revient que par accord du cabinet'
        using errcode = 'check_violation';
    end if;
  end if;

  -- B7 resserré, 17 octobre : « un siège ne peut marquer personnel qu'au
  -- moment de la capture ». Après, sortir une pièce de la société relève du
  -- propriétaire — sinon la facture qu'un collaborateur glisse dans son
  -- espace privé quitte l'entreprise avec lui, et la règle 1 tombe.
  if p_vis = 'personnel'::app.vis_t
     and v_old = 'entite'::app.vis_t
     and not app.has_org_role(v_tenant, array['dirigeant'])
  then
    raise exception 'sortir une piece de la societe releve du proprietaire'
      using errcode = 'check_violation';
  end if;

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission. `entite` ne l'est pas.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

  -- Deux destinataires, deux notifications : `entite` prévient le dirigeant
  -- qu'il a quelque chose à valider, `partage` prévient le cabinet qu'il a
  -- quelque chose à comptabiliser.
  if p_vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.partagee', jsonb_build_object('piece_id', p_piece));
  elsif p_vis = 'entite'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.a_valider',
            jsonb_build_object('piece_id', p_piece, 'auteur', v_auteur));
  end if;

  return jsonb_build_object('piece_id', p_piece, 'vis', p_vis, 'changed', true);
end
$$;

revoke all on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) from public, anon;
grant execute on function public.capture_piece_set_vis(uuid, app.vis_t, boolean) to authenticated;

-- --- 4. Ce que le cabinet voit n'a pas bougé --------------------------------
--
-- Une relecture de la politique posée plus haut, pour qu'elle soit dite :
-- `engaged_orgs()` n'apparaît que sur la branche `partage`. Le cabinet ne
-- voit donc ni le personnel ni l'entité — « le cabinet ne lit jamais ce qui
-- ne lui a pas été transmis » reste vrai, et l'est maintenant d'un cran plus
-- tôt dans le parcours.

commit;
