-- Un impayé suspend la lecture, la transmission ET l'export (22 octobre 2026).
--
-- Décision de Wissem Barouni, 22 octobre 2026 : « Suspendre la lecture, la
-- transmission au cabinet et l'export. » Elle remplace la phrase du relais
-- (« transfert du dossier au cabinet »), qui n'avait jamais été codée.
--
--   lecture       déjà tenue par `lecture_verdict` (`licence_<statut>`) ;
--   transmission  tenue ici sur la table, à l'insertion comme au passage en
--                 `partage` (elle était écrite DEUX fois, mot pour mot, dans
--                 `capture_piece_set_vis` et dans le déclencheur d'insertion) ;
--   export        nouveau : un cabinet n'exporte pas le dossier d'un client
--                 dont la licence n'est pas active ; dans un export de tous
--                 les dossiers, ce client n'entre pas.
--
-- Le refus lève une CLÉ du dictionnaire (`refus.licence.transmission`,
-- `refus.licence.export`) et non une phrase : la phrase était écrite en
-- français dans le SQL, deux fois, et invitait à payer — y compris dans
-- l'application installée depuis un store, où rien ne doit inviter à payer.
-- L'écran traduit la clé en fr/en/ar.
--
-- Une société sans licence (un cabinet) n'est pas concernée : seul ce que la
-- base SAIT non actif bloque.
-- REJEU (R11) : `create or replace`, `drop trigger if exists`.

begin;

-- --- 1. La licence d'une société est-elle active ? (une seule écriture) -----
--
-- `security definer` : un cabinet doit pouvoir savoir si le dossier d'un
-- client est suspendu sans lire la licence elle-même. Rien d'autre ne sort
-- qu'un booléen.
create or replace function app.licence_active(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.statut from facturation.licence_organisations lo
       join facturation.consommation_v c on c.licence_id = lo.licence_id
      where lo.tenant_id = p_tenant),
    'active') = 'active';
$$;

revoke all on function app.licence_active(uuid) from public, anon, service_role;
grant execute on function app.licence_active(uuid) to authenticated;

-- Le refus, une fois : la clé du geste refusé.
create or replace function app.exiger_licence_active(p_tenant uuid, p_geste text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not app.licence_active(p_tenant) then
    raise exception '%', 'refus.licence.' || p_geste
      using errcode = 'check_violation', hint = 'licence.suspendue';
  end if;
end $$;

revoke all on function app.exiger_licence_active(uuid, text) from public, anon, service_role;
grant execute on function app.exiger_licence_active(uuid, text) to authenticated;

-- --- 2. La transmission : sur la table, à l'insertion et au passage ---------

create or replace function app.une_piece_transmise_exige_une_licence_active()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.vis = 'partage'::app.vis_t
     and (tg_op = 'INSERT' or old.vis is distinct from new.vis)
  then
    perform app.exiger_licence_active(new.tenant_id, 'transmission');
  end if;
  return new;
end $function$;

drop trigger if exists une_piece_transmise_exige_une_licence_active on capture.pieces;
create trigger une_piece_transmise_exige_une_licence_active
  before insert or update of vis on capture.pieces
  for each row execute function app.une_piece_transmise_exige_une_licence_active();

-- `capture_piece_set_vis` perd sa copie de la règle (corps repris de
-- 20261022360000 ; seul ce bloc s'en va, le déclencheur ci-dessus le tient).
CREATE OR REPLACE FUNCTION public.capture_piece_set_vis(p_piece uuid, p_vis app.vis_t, p_par_accord boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Quitter `partage`, c'est retirer au cabinet ce qu'il a reçu.
  if v_old = 'partage'::app.vis_t then
    if v_status in ('comptabilisee','supervisee') then
      raise exception 'une piece comptabilisee reste partagee' using errcode = 'check_violation';
    end if;
    -- L'accord se dérive de la donnée, pas d'un drapeau.
    if not app.accord_donne(p_piece, 'rappel') then
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

  update capture.pieces
     set vis = p_vis,
         -- Seul `partage` est une transmission.
         transmise_le = case when p_vis = 'partage'::app.vis_t then now() else null end,
         -- La décision de la garder est à reprendre.
         gardee_le = null,
         updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.vis_changed', 'capture', 'pieces', p_piece,
          jsonb_build_object('from', v_old, 'to', p_vis, 'status', v_status,
                             'par_accord', p_par_accord, 'auteur', v_auteur));

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
$function$;


-- --- 3. L'export : le dossier d'un client suspendu ne sort pas ---------------
--
-- Corps repris de 20260904160000 ; s'ajoutent le refus pour UN dossier
-- suspendu et l'exclusion d'un dossier suspendu dans l'export de tous.
create or replace function app.export_mandats(p_cabinet uuid, p_client uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_client is not null and not exists (
    select 1 from identity.engagements e
     where e.cabinet_org_id = p_cabinet and e.pme_org_id = p_client
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)) then
    raise exception 'dossier introuvable ou non autorise' using errcode = '42501';
  end if;
  if p_client is not null then
    perform app.exiger_licence_active(p_client, 'export');
  end if;
  return query
    select e.pme_org_id
      from identity.engagements e
     where e.cabinet_org_id = p_cabinet
       and (p_client is null or e.pme_org_id = p_client)
       and e.status = 'actif' and e.starts_on <= current_date
       and (e.ends_on is null or e.ends_on >= current_date)
       and app.licence_active(e.pme_org_id);
end $$;

commit;
