-- Une version précédente ne bouge plus, et une archive privée reste privée
-- (relecture indépendante du lot « Malica sans blocage », 28 octobre 2026).
--
-- Ce que la relecture a reproduit, et ce que ce fichier corrige :
--   1. une photo PRIVÉE devenait lisible par le cabinet dès qu'elle était
--      archivée (la règle de lecture de l'archive ignorait `vis`). L'archive
--      n'est ouverte au cabinet que pour une pièce qu'il a connue : partagée,
--      ou justifiant une écriture inscrite ; une version jamais connue de lui
--      n'est pas archivée, elle reste au client ;
--   2. une version précédente pouvait être effacée, gardée, demandée : un
--      garde sur la pièce et sur les faits qui la visent l'interdit — seule
--      son archive est permise ;
--   3. « Garder » une pièce retournée la laisse dans la SOCIÉTÉ, « Gardée »
--      (décision du dirigeant) — jamais un espace privé ;
--   4. une version précédente ne compte plus : tableau du cabinet, pièces
--      qui entrent dans les déclarations ;
--   5. reprendre la photo d'une pièce déjà envoyée n'est pas une nouvelle
--      transmission : un impayé ne l'empêche pas ;
--   6. le registre des remplacements se lit comme les pièces (opérateur sur
--      le cas nommé, `plateforme_requise`).

begin;

-- --- 1. Une pièce que le cabinet a connue -------------------------------------------------------

create or replace function app.piece_connue_du_cabinet(p_piece uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from capture.pieces p
     where p.id = p_piece
       and (p.vis = 'partage'::app.vis_t
            or p.transmise_le is not null
            or exists (select 1 from socle.ecritures e
                        where e.piece_id = p.id and e.status = 'booked')))
$$;

revoke all on function app.piece_connue_du_cabinet(uuid) from public, anon;
grant execute on function app.piece_connue_du_cabinet(uuid) to authenticated;

drop policy if exists capture_pieces_sel on capture.pieces;
create policy capture_pieces_sel on capture.pieces
  for select to authenticated
  using (
    (archivee_le is null and (
         (vis = 'personnel'::app.vis_t and created_by = auth.uid())
      or (vis = 'entite'::app.vis_t  and tenant_id in (select app.member_orgs()))
      or (vis = 'partage'::app.vis_t and (
            tenant_id in (select app.member_orgs())
            or tenant_id in (select app.engaged_orgs())))))
    or (archivee_le is not null
        and tenant_id in (select app.engaged_orgs())
        and app.piece_connue_du_cabinet(id))
    or app.plateforme_requise(tenant_id)
  );

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

-- --- 2. Une version précédente ne bouge plus ----------------------------------------------------
--
-- Sur la pièce : ni effacée, ni modifiée — sauf son archive. Sur les faits
-- qui la visent : ni précision, ni rattachement, ni demande, ni retour ; une
-- demande qu'on CLÔT (« retiree ») reste possible, c'est `piece_remplacer`
-- qui l'inscrit. Ses règlements, eux, restent vivants : ils se lisent sur la
-- photo courante, et s'y annulent.

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

revoke all on function app.une_version_precedente_ne_bouge_plus() from public, anon;

drop trigger if exists une_version_precedente_ne_bouge_plus on capture.pieces;
create trigger une_version_precedente_ne_bouge_plus
  before update or delete on capture.pieces
  for each row execute function app.une_version_precedente_ne_bouge_plus();

create or replace function app.pas_de_geste_sur_une_version_precedente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ligne jsonb := to_jsonb(new);
begin
  if tg_table_name = 'demandes_sur_piece' and v_ligne ->> 'fait' = 'retiree' then
    return new;
  end if;
  if exists (select 1 from capture.remplacements r
              where r.piece_id::text in (v_ligne ->> 'piece_id', v_ligne ->> 'piece_liee_id')) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.pas_de_geste_sur_une_version_precedente() from public, anon;

drop trigger if exists pas_de_geste_sur_une_version_precedente on capture.precisions;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.precisions
  for each row execute function app.pas_de_geste_sur_une_version_precedente();
drop trigger if exists pas_de_geste_sur_une_version_precedente on capture.rattachements;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.rattachements
  for each row execute function app.pas_de_geste_sur_une_version_precedente();
drop trigger if exists pas_de_geste_sur_une_version_precedente on capture.conformite;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.conformite
  for each row execute function app.pas_de_geste_sur_une_version_precedente();
drop trigger if exists pas_de_geste_sur_une_version_precedente on collab.demandes_sur_piece;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on collab.demandes_sur_piece
  for each row execute function app.pas_de_geste_sur_une_version_precedente();

-- --- 5. La reprise hérite du partage sans être une transmission ---------------------------------
--
-- Repris de `20261023100000` à l'identique, sauf l'exception nommée : la photo
-- que `piece_remplacer` met à la place d'une pièce déjà envoyée.

create or replace function app.une_piece_transmise_exige_une_licence_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vis = 'partage'::app.vis_t
     and (tg_op = 'INSERT' or old.vis is distinct from new.vis)
     and coalesce(current_setting('malica.remplacement', true), '') <> new.id::text
  then
    perform app.exiger_licence_active(new.tenant_id, 'transmission');
  end if;
  return new;
end $$;

-- --- 6. Le registre des remplacements se lit comme les pièces -----------------------------------

drop policy if exists capture_remplacements_sel on capture.remplacements;
create policy capture_remplacements_sel on capture.remplacements
  for select to authenticated
  using (
    tenant_id in (select app.member_orgs())
    or tenant_id in (select app.engaged_orgs())
    or app.plateforme_requise(tenant_id)
  );

-- --- 4. Une version précédente ne compte plus ---------------------------------------------------

create or replace view public.cabinet_stats_v with (security_invoker = true) as
  select tenant_id,
         count(*) as pieces,
         count(*) filter (where status = 'capturee') as capturees,
         count(*) filter (where status = 'lue') as lues,
         count(*) filter (where status = 'proposee') as proposees,
         count(*) filter (where status = 'comptabilisee') as comptabilisees,
         count(*) filter (where status = 'supervisee') as supervisees,
         count(*) filter (where status = 'retournee') as retournees,
         coalesce(avg(extract(epoch from (updated_at - created_at)) / 3600.0)
                    filter (where status in ('comptabilisee', 'supervisee')), 0::numeric)
           as heures_moyennes,
         max(created_at) as derniere_piece
    from capture.pieces p
   -- Une photo reprise est UNE pièce ; une pièce que le client a retirée n'en
   -- est plus une.
   where not exists (select 1 from capture.remplacements r where r.piece_id = p.id)
     and p.archivee_le is null
   group by tenant_id;

create or replace view public.pieces_qui_comptent_v with (security_invoker = true) as
  select p.id, p.tenant_id, p.vis, p.status, p.document_kind, p.transmise_le, p.created_at
    from capture.pieces p
    join ref.document_types t on t.code = p.document_kind
   where t.porte_ecriture
     and p.vis <> 'personnel'::app.vis_t
     and p.doublon_de is null
     and p.status in ('proposee', 'confirmee', 'comptabilisee', 'supervisee')
     -- Une version précédente n'entre dans aucune déclaration : c'est la
     -- photo qui l'a remplacée qui compte.
     and not exists (select 1 from capture.remplacements r where r.piece_id = p.id);

-- --- 3, 1, 5. Les portes reprises ---------------------------------------------------------------
--
-- `piece_remplacer`, `capture_piece_supprimer`, `capture_piece_set_vis`,
-- `capture_piece_garder` : reprises de `20261029100000`, avec ce qui précède.

create or replace function public.piece_remplacer(p_ancienne uuid, p_nouvelle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  n record;
  v_liee record;
begin
  -- Les deux lignes, dans un ordre fixe : deux remplacements croisés ne
  -- s'attendent pas l'un l'autre.
  perform 1 from capture.pieces where id in (p_ancienne, p_nouvelle) order by id for update;
  select * into a from capture.pieces where id = p_ancienne;
  select * into n from capture.pieces where id = p_nouvelle;

  -- `security definer` court-circuite la RLS : le contrôle est refait ici.
  if a.id is null or n.id is null or p_ancienne = p_nouvelle
     or a.tenant_id <> n.tenant_id
     or a.tenant_id not in (select app.member_orgs())
     or not app.piece_lisible(p_ancienne) then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  if exists (select 1 from capture.remplacements r
              where r.piece_id = p_ancienne and r.remplacee_par = p_nouvelle) then
    return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', true);
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_ancienne) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Un reçu, un justificatif : ils ont leur propre reprise (`justificatif_remplacer`).
  if a.source_piece_id is not null or app.piece_accompagne(p_ancienne) then
    raise exception 'refus.remplacement.accompagne' using errcode = 'check_violation';
  end if;

  -- Une pièce prise en charge porte une écriture : le cabinet la retourne
  -- d'abord (contre-passation), puis la photo se reprend.
  if a.status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id = p_ancienne and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception 'refus.remplacement.inscrite' using errcode = 'check_violation';
  end if;

  -- La nouvelle est une photo qui vient d'être prise, par celui qui remplace,
  -- et rien d'autre : jamais une pièce lue, issue d'une autre, ou déjà liée.
  if n.status <> 'capturee'
     or n.created_by is distinct from auth.uid()
     or n.source_piece_id is not null
     or exists (select 1 from capture.extractions x where x.piece_id = p_nouvelle)
     or exists (select 1 from capture.remplacements r
                 where r.remplacee_par = p_nouvelle or r.piece_id = p_nouvelle) then
    raise exception 'refus.remplacement.nouvelle_photo' using errcode = 'check_violation';
  end if;

  insert into capture.remplacements (tenant_id, piece_id, remplacee_par, auteur)
  values (a.tenant_id, p_ancienne, p_nouvelle, auth.uid());

  -- La nouvelle hérite du partage de l'ancienne : ce n'est pas une nouvelle
  -- transmission, et un impayé ne doit pas empêcher de corriger une pièce
  -- déjà envoyée (`une_piece_transmise_exige_une_licence_active` le lit).
  perform set_config('malica.remplacement', p_nouvelle::text, true);
  update capture.pieces
     set vis = a.vis,
         entity_id = coalesce(n.entity_id, a.entity_id),
         transmise_le = a.transmise_le,
         gardee_le = a.gardee_le,
         -- Le retour en cours suit la photo ; sinon, elle part en lecture.
         status = case when a.status = 'retournee' then 'retournee' else 'capturee' end,
         -- Le type déclaré suit, à confirmer : la lecture aura le dernier mot.
         document_kind = coalesce(n.document_kind, a.document_kind),
         document_kind_statut = case
           when n.document_kind is not null then n.document_kind_statut
           when a.document_kind is not null then 'a_confirmer'
           else n.document_kind_statut end,
         updated_at = now()
   where id = p_nouvelle;
  perform set_config('malica.remplacement', '', true);

  -- Les documents rattachés à l'ancienne le sont à la nouvelle : un fait
  -- nouveau par paire (R7) ; ceux de l'ancienne restent au registre.
  for v_liee in
    select case when r.piece_id = p_ancienne then r.piece_liee_id else r.piece_id end as autre
      from public.rattachements_v r
     where (r.piece_id = p_ancienne or r.piece_liee_id = p_ancienne)
       and r.fait = 'rattache'
  loop
    -- Une version précédente ne se rattache plus : c'est la photo qui l'a
    -- remplacée qui porte le lien.
    if v_liee.autre <> p_nouvelle
       and not exists (select 1 from capture.remplacements r where r.piece_id = v_liee.autre)
       and coalesce((select f.fait from capture.dernier_fait_de_la_paire(p_nouvelle, v_liee.autre) f),
                    'detache') <> 'rattache' then
      insert into capture.rattachements (tenant_id, piece_id, piece_liee_id, fait, auteur)
      values (a.tenant_id, p_nouvelle, v_liee.autre, 'rattache', auth.uid());
    end if;
  end loop;

  -- Une demande en attente sur l'ancienne n'a plus d'objet : on inscrit le
  -- fait qui la clôt — la ligne « demandee » reste, R7.
  insert into collab.demandes_sur_piece (tenant_id, piece_id, objet, fait, note, auteur)
  select a.tenant_id, p_ancienne, d.objet, 'retiree', null, auth.uid()
    from (select distinct on (x.objet) x.objet, x.fait
            from collab.demandes_sur_piece x
           where x.piece_id = p_ancienne
           order by x.objet, x.created_at desc) d
   where d.fait = 'demandee';

  perform app.piece_oublie_ses_propositions(p_ancienne);

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (a.tenant_id, auth.uid(), 'piece.remplacee', 'capture', 'pieces', p_nouvelle,
          jsonb_build_object('remplace', p_ancienne, 'vis', a.vis, 'status', a.status));

  if a.vis = 'partage'::app.vis_t then
    insert into collab.notifications (tenant_id, kind, payload)
    values (a.tenant_id, 'piece.remplacee',
            jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne));
  end if;

  return jsonb_build_object('piece_id', p_nouvelle, 'remplace', p_ancienne, 'deja', false);
end
$$;

create or replace function public.capture_piece_supprimer(p_piece uuid, p_par_accord boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vis      text;
  v_status   text;
  v_tenant   uuid;
  v_archivee timestamptz;
begin
  select p.vis::text, p.status, p.tenant_id, p.archivee_le
    into v_vis, v_status, v_tenant, v_archivee
    from capture.pieces p where p.id = p_piece for update;

  if v_vis is null then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- `security definer` court-circuite la RLS : on refait ICI le contrôle de
  -- la politique `capture_pieces_del`.
  -- Le cabinet sous mandat n'est pas membre du dossier : il n'entre que pour
  -- exécuter un accord que la donnée établit (section 17), jamais autrement.
  if v_tenant not in (select app.member_orgs())
     and not (p_par_accord
              and v_tenant in (select app.engaged_orgs())
              and app.accord_donne(p_piece, 'suppression')) then
    raise exception 'piece introuvable' using errcode = 'no_data_found';
  end if;

  -- Une version précédente ne se retire pas seule : c'est la photo qui l'a
  -- remplacée qui se supprime, et elle l'emporte aux archives si elle le doit.
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  -- Déjà retirée : le geste rejoué ne refait rien.
  if v_archivee is not null then
    return 'archivee';
  end if;

  -- Libre tant que personne ne l'a reçue. `personnel` et `entite` sont tous
  -- deux « chez le client ». `partage` a franchi la frontière du cabinet :
  -- son accord, ou son retour — une pièce retournée est rendue au client.
  if v_vis = 'partage'
     and v_status <> 'retournee'
     and not app.accord_donne(p_piece, 'suppression') then
    raise exception
      'Cette pièce a été transmise à votre cabinet : sa suppression demande son accord.'
      using errcode = 'check_violation';
  end if;

  if v_status in ('comptabilisee', 'supervisee')
     or exists (select 1 from socle.ecritures e
                 where e.piece_id = p_piece and e.status = 'booked'
                   and app.ecriture_vivante(e.id)) then
    raise exception
      'Cette pièce est engagée dans votre comptabilité : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from immo.assets a where a.piece_id = p_piece)
     or exists (select 1 from stocks.mouvements m where m.piece_id = p_piece)
     or exists (select 1 from identity.fiches_fiscales f where f.piece_id = p_piece)
  then
    raise exception
      'Cette pièce sert de justificatif : elle ne peut plus être supprimée.'
      using errcode = 'check_violation';
  end if;

  -- Les versions précédentes ne s'effacent jamais. Celles que le cabinet a
  -- connues (partagées, ou justifiant une écriture inscrite) s'archivent,
  -- chez lui ; les autres restent au client, et redeviennent sa pièce quand
  -- la photo qui les remplaçait part.
  with recursive versions(id) as (
    select r.piece_id from capture.remplacements r where r.remplacee_par = p_piece
    union
    select r.piece_id from capture.remplacements r join versions v on r.remplacee_par = v.id
  )
  update capture.pieces
     set archivee_le = now(), updated_at = now()
   where id in (select id from versions) and archivee_le is null
     and app.piece_connue_du_cabinet(id);

  -- Une proposition jamais inscrite part avec la pièce.
  perform app.piece_oublie_ses_propositions(p_piece);

  -- Une écriture a existé — contre-passée, puisqu'aucune n'est vivante : la
  -- pièce la justifie au journal. Archivée : le client ne la voit plus, le
  -- cabinet la garde.
  if exists (select 1 from socle.ecritures e
              where e.piece_id = p_piece and e.status = 'booked') then
    update capture.pieces set archivee_le = now(), updated_at = now() where id = p_piece;

    insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                 object_id, payload)
    values (v_tenant, auth.uid(), 'piece.archivee', 'capture', 'pieces', p_piece,
            jsonb_build_object('vis', v_vis, 'status', v_status, 'par_accord', p_par_accord));

    if v_vis = 'partage' and not p_par_accord then
      insert into collab.notifications (tenant_id, kind, payload)
      values (v_tenant, 'piece.archivee', jsonb_build_object('piece_id', p_piece));
    end if;
    return 'archivee';
  end if;

  -- Une pièce qui nourrit une recette de lecture publiée ou évaluée en garde
  -- la provenance : elle ne s'efface pas. Le dire ici, en clair, plutôt que
  -- laisser la cascade buter sur R7 (audit du 27 octobre 2026).
  if exists (
       select 1 from fabrique.exemples x
        where x.piece_id = p_piece
          and (exists (select 1 from fabrique.recette_version_exemples r where r.exemple_id = x.id)
               or exists (select 1 from fabrique.evaluation_exemples v where v.exemple_id = x.id)))
  then
    raise exception 'refus.suppression.exemple_de_recette' using errcode = 'check_violation';
  end if;

  -- La trace survit à la pièce. `audit.event_log` porte `object_id` sans clé
  -- étrangère : ce qui a existé reste dit, même quand l'objet n'est plus là.
  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.supprimee', 'capture', 'pieces', p_piece,
          jsonb_build_object('vis', v_vis, 'status', v_status,
                             'par_accord', p_par_accord));

  -- Le cabinet avait reçu la pièce : il apprend que le client l'a retirée.
  if v_vis = 'partage' and not p_par_accord then
    insert into collab.notifications (tenant_id, kind, payload)
    values (v_tenant, 'piece.supprimee', jsonb_build_object('piece_id', p_piece));
  end if;

  perform set_config('malica.piece_effacable', p_piece::text, true);
  delete from capture.pieces where id = p_piece;
  perform set_config('malica.piece_effacable', '', true);
  perform set_config('malica.paiements_effacables', '', true);

  return 'supprimee';
end;$fn$;

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
  if v_old = 'partage'::app.vis_t then
    for v_derive in
      update capture.pieces
         set vis = p_vis,
             transmise_le = null,
             gardee_le = null,
             updated_at = now()
       where tenant_id = v_tenant
         and source_piece_id = p_piece
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

  if v_vis = 'partage'::app.vis_t then
    -- Retournée : elle reste dans la SOCIÉTÉ, « Gardée » — jamais un espace
    -- privé, d'où le justificatif d'une écriture contre-passée sortirait, et
    -- où la pièce d'un siège quitterait le dirigeant qui la garde. La porte
    -- de la visibilité clôt le retour et prévient le cabinet.
    if v_status = 'retournee' then
      perform public.capture_piece_set_vis(p_piece, 'entite'::app.vis_t);
      update capture.pieces set gardee_le = now(), updated_at = now() where id = p_piece;
      insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                                   object_id, payload)
      values (v_tenant, auth.uid(), 'piece.gardee', 'capture', 'pieces', p_piece,
              jsonb_build_object('vis', 'entite', 'retour', true));
      return jsonb_build_object('piece_id', p_piece, 'changed', true);
    end if;
    -- Le chemin du retour existe, et il passe par l'accord du cabinet. Sans ce
    -- refus, un bouton « garder » contournerait la seule règle qui en exige un.
    raise exception 'une piece transmise ne revient que par accord du cabinet'
      using errcode = 'check_violation';
  end if;

  -- Le doigt ripe, l'écran revient : la date de la décision est celle du jour
  -- où elle a été prise, pas celle du dernier tap.
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


commit;
