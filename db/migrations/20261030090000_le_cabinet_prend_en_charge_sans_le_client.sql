-- Le cabinet prend en charge sans le client (« Malica sans blocage », lot 5).
--
-- Décision du dirigeant, maquette validée le 28 octobre 2026 : la PME ne voit
-- aucune écriture et ne confirme rien. Elle voit Envoyée · Vue · Retour ·
-- Prise en charge ; le comptable voit Reçue · Vue · Retournée · Corrigée ·
-- Validée · Forcée. Rien ne bloque : le comptable valide la proposition du
-- Socle, ou la force (la modifie, ou la saisit quand le Socle ne propose
-- rien), ou retourne la pièce à toute étape.
--
-- Relevé sur staging le 29 octobre, pièce au montant illisible : le cabinet
-- lisait « Lue — le client n'a pas confirmé », un bouton « Inscrire »
-- ÉTEINT (rien de proposé), et « Demander au client de confirmer ». Il ne
-- pouvait rien faire de la pièce.
--
-- Ce que ce fichier pose :
--   1. `capture.vues` : ouvrir une pièce est un FAIT (qui, quand), idempotent
--      par envoi ; `piece_voir` est sa seule porte.
--   2. `app.suivi_de_la_piece` : les faits dont les deux rives dérivent leur
--      statut — envoyée, vue (par quel cabinet), corrigée, prise en charge
--      (validée ou forcée). Le mot et la couleur se dérivent au Socle
--      (`statut-d-envoi.ts`), une fois pour les deux rives.
--   3. Le verrou R2 garde son OBJET — un type de pièce établi par une
--      personne avant toute écriture — mais c'est le cabinet qui l'établit :
--      `piece_type_etabli_par_le_cabinet` remplace `piece_confirmer_le_type_lu`
--      et accepte un type choisi quand la lecture n'en a reconnu aucun.
--   4. Une écriture inscrite par le cabinet EST sa prise en charge : la pièce
--      passe « supervisee » (elle ne repasse plus « comptabilisee », qui
--      voulait dire « inscrite par le client, à superviser »).
--   5. `socle_ecriture_contre_passer` : la contre-passation, une fois écrite.
--      La revue (retour) l'emploie ; le forçage aussi — sans retourner la
--      pièce ni prévenir le client, parce que forcer est l'acte du cabinet.
--   6. Le double regard du mode mandat porte sur la VALIDATION : celui qui a
--      inscrit ne valide pas lui-même, mais il peut toujours défaire (un
--      retour contre-passe, il n'approuve rien).
--   7. `piece_retourner` retourne à toute étape : une pièce prise en charge
--      se retourne avec la contre-passation de son écriture.
--   8. Dans un dossier en mandat suivi par un cabinet engagé
--      (`app.livres_tenus_par_le_cabinet`), seul le cabinet inscrit
--      l'écriture d'une pièce, la revoit ou contre-passe une écriture ; le
--      dossier autonome et le dossier sans cabinet gardent la main. Le
--      collaborateur n'agit que sur les dossiers qui lui sont affectés.
--   9. La relance « confirmez » disparaît : `piece_demander_confirmation`
--      n'a plus d'objet. Les notifications déjà posées restent (R7).

begin;

-- --- 0. Qui supervise ce dossier ------------------------------------------------------------------
--
-- La règle était recopiée dans trois fonctions : l'expert ou le collaborateur
-- d'un cabinet engagé. Elle s'écrit une fois — et le collaborateur n'agit que
-- sur les dossiers qui lui sont AFFECTÉS, la règle que la file applique déjà
-- (`app.mandats_visibles`) : ce qu'il ne voit pas, il ne le valide pas.

create or replace function app.supervise_le_dossier(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from identity.engagements e
      join identity.memberships m on m.tenant_id = e.cabinet_org_id
     where e.pme_org_id = p_tenant and e.status = 'actif'
       and m.user_id = auth.uid()
       and (m.role = 'expert'
            or (m.role = 'collaborateur'
                and exists (select 1 from collab.assignments a
                             where a.cabinet_tenant_id = e.cabinet_org_id
                               and a.client_tenant_id = p_tenant
                               and a.collaborator_id = auth.uid()
                               and a.active))))
$$;

revoke all on function app.supervise_le_dossier(uuid) from public, anon;
grant execute on function app.supervise_le_dossier(uuid) to authenticated;

-- Les livres de ce dossier sont-ils tenus par un cabinet ? En mandat, avec un
-- engagement actif : l'écriture d'une pièce, sa revue et toute
-- contre-passation sont alors l'acte du cabinet, jamais de la PME — sinon le
-- journal du jour et l'export du cabinet ne disent plus ce qui est inscrit.
create or replace function app.livres_tenus_par_le_cabinet(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from identity.organizations o
                  where o.id = p_tenant and o.validation_mode = 'mandate')
     and exists (select 1 from identity.engagements g
                  where g.pme_org_id = p_tenant and g.status = 'actif')
$$;

revoke all on function app.livres_tenus_par_le_cabinet(uuid) from public, anon;
grant execute on function app.livres_tenus_par_le_cabinet(uuid) to authenticated;

-- Le geste de supervision sur ce dossier est-il permis ? Le cabinet qui le
-- tient, toujours ; la société elle-même seulement quand elle tient ses livres.
create or replace function app.peut_superviser(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.supervise_le_dossier(p_tenant)
      or (not app.livres_tenus_par_le_cabinet(p_tenant)
          and p_tenant in (select app.member_orgs()))
$$;

revoke all on function app.peut_superviser(uuid) from public, anon;
grant execute on function app.peut_superviser(uuid) to authenticated;

-- --- 1. Une pièce ouverte par le cabinet est « Vue » ----------------------------------------------

create table if not exists capture.vues (
  id             uuid primary key default gen_random_uuid(),
  -- Le dossier de la PME : la pièce est la sienne, le fait aussi.
  tenant_id      uuid not null references identity.organizations(id) on delete cascade,
  piece_id       uuid not null references capture.pieces(id) on delete cascade,
  cabinet_org_id uuid not null references identity.organizations(id) on delete cascade,
  par            uuid not null,
  -- Le nom au moment de l'ouverture : un compte renommé ne réécrit pas l'histoire.
  par_nom        text,
  -- L'envoi (ou la correction du client) que cette ouverture a vu : une
  -- « Vue » par envoi et par cabinet, la première. Deux ouvertures
  -- simultanées n'en écrivent qu'une (index unique, `on conflict do nothing`).
  depuis         timestamptz not null,
  vue_le         timestamptz not null default now()
);

create unique index if not exists vues_une_par_envoi_idx
  on capture.vues (tenant_id, piece_id, cabinet_org_id, depuis);

create index if not exists vues_tenant_piece_idx on capture.vues (tenant_id, piece_id, vue_le desc);
create index if not exists vues_piece_idx on capture.vues (piece_id, vue_le desc);
create index if not exists vues_cabinet_org_id_fk_idx on capture.vues (cabinet_org_id);

select app.enable_tenant_rls('capture', 'vues', false, true);

-- Personne n'écrit ce registre à la main : `piece_voir` est sa seule porte.
revoke insert, update, delete on table capture.vues from authenticated;

-- Il se lit au cabinet. Le client lit « Vue par {cabinet} » dans
-- `app.suivi_de_la_piece` — le nom du cabinet, jamais celui du comptable.
drop policy if exists capture_vues_sel on capture.vues;
create policy capture_vues_sel on capture.vues
  for select to authenticated
  using (cabinet_org_id in (select app.member_orgs()) or (select app.is_platform()));

-- Un fait ne se modifie pas (R7) ; il part seulement avec sa pièce, quand
-- `capture_piece_supprimer` l'efface (le premier passage du garde).
drop trigger if exists capture_vues_no_upd on capture.vues;
create trigger capture_vues_no_upd
  before update or delete on capture.vues
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

comment on table capture.vues is
  'Une pièce ouverte par le cabinet : qui, quand. Le client y lit « Vue par {cabinet} » (Malica sans blocage, 30 octobre 2026).';

-- Le dernier envoi au cabinet : la transmission, ou le dernier renvoi après
-- un retour. Toutes les versions de la pièce : une photo reprise hérite de
-- l'envoi de l'ancienne (`piece_remplacer`).
create or replace function app.dernier_envoi(p_piece uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    -- Une pièce transmise avant le 11 octobre 2026 n'a pas de date d'envoi :
    -- la file du cabinet la range à sa date de dépôt, le suivi aussi.
    (select coalesce(p.transmise_le, p.created_at) from capture.pieces p
      where p.id = app.version_courante(p_piece)),
    (select max(a.at) from audit.event_log a
      where a.object_table = 'pieces' and a.action = 'piece.renvoyee'
        and a.object_id in (select app.versions_de_la_piece(p_piece))))
$$;

revoke all on function app.dernier_envoi(uuid) from public, anon;

-- La dernière correction du CLIENT après l'envoi : une précision posée par un
-- membre de la société, ou une photo reprise. Celle que le cabinet pose en
-- établissant le type n'en est pas une.
create or replace function app.corrigee_par_le_client(p_piece uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with p as (
    select tenant_id, coalesce(transmise_le, created_at) as envoyee_le
      from capture.pieces where id = app.version_courante(p_piece)
  ),
  c as (
    select pr.decided_at as le
      from capture.precisions pr, p
     where pr.piece_id in (select app.versions_de_la_piece(p_piece))
       and exists (select 1 from identity.memberships m
                    where m.tenant_id = p.tenant_id and m.user_id = pr.decided_by)
    union all
    select r.created_at
      from capture.remplacements r
     where r.remplacee_par in (select app.versions_de_la_piece(p_piece))
  )
  select max(c.le) from c, p where c.le > p.envoyee_le
$$;

revoke all on function app.corrigee_par_le_client(uuid) from public, anon;

-- --- 2. Ce que les deux rives lisent ----------------------------------------------------------------

create or replace function app.suivi_de_la_piece(p_piece uuid)
returns table (
  envoyee_le  timestamptz,
  vue_le      timestamptz,
  vue_par     text,
  corrigee_le timestamptz,
  prise_le    timestamptz,
  prise       text,
  prise_par   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_client boolean;
  v_ecriture uuid;
  v_cabinet  uuid;
begin
  -- La même règle de lecture que la pièce elle-même (R6), et la SEULE :
  -- `app.piece_lisible` juge par la version courante (une version précédente
  -- n'a pas de visibilité propre ; une courante retirée ferme l'accès du
  -- cabinet) et par l'auteur d'une pièce personnelle. Le suivi ne se lit à
  -- travers les versions qu'une fois ce contrôle passé.
  if not app.piece_lisible(p_piece) then
    return;
  end if;
  select tenant_id, vis into v_tenant, v_vis
    from capture.pieces where id = app.version_courante(p_piece);
  v_client := v_tenant in (select app.member_orgs());

  if v_vis = 'partage'::app.vis_t then
    envoyee_le := app.dernier_envoi(p_piece);
  end if;

  select v.vue_le, o.name into vue_le, vue_par
    from capture.vues v
    join identity.organizations o on o.id = v.cabinet_org_id
   where v.piece_id in (select app.versions_de_la_piece(p_piece))
   order by v.vue_le desc
   limit 1;

  corrigee_le := app.corrigee_par_le_client(p_piece);

  -- L'écriture VIVANTE de la pièce, et sa prise en charge par un cabinet.
  select e.id, pc.tenant_id, pc.prise_le, pc.par_nom
    into v_ecriture, v_cabinet, prise_le, prise_par
    from socle.ecritures e
    join socle.prises_en_charge pc on pc.ecriture_id = e.id
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   order by pc.prise_le desc
   limit 1;
  if v_ecriture is not null then
    select x.origine into prise from app.ecriture_prise_en_charge(v_cabinet, v_ecriture) x;
  end if;
  -- Le client lit « Prise en charge » ; le nom du comptable reste au cabinet.
  if v_client then
    prise_par := null;
  end if;

  return next;
end
$$;

revoke all on function app.suivi_de_la_piece(uuid) from public, anon;
grant execute on function app.suivi_de_la_piece(uuid) to authenticated;

-- --- 3. Ouvrir, c'est voir ----------------------------------------------------------------------

create or replace function public.piece_voir(p_piece uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_vis     app.vis_t;
  v_cabinet uuid;
  v_archivee timestamptz;
  v_depuis  timestamptz;
  v_le      timestamptz;
begin
  select tenant_id, vis, archivee_le into v_tenant, v_vis, v_archivee
    from capture.pieces where id = p_piece;
  if v_tenant is null or v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Tout membre du cabinet engagé à qui le dossier est visible (l'assistant
  -- qui ouvre la pièce l'a vue ; le collaborateur, sur ses dossiers affectés).
  select e.cabinet_org_id into v_cabinet
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id
   where e.pme_org_id = v_tenant and e.status = 'actif' and m.user_id = auth.uid()
     and v_tenant in (select app.mandats_visibles(e.cabinet_org_id))
   order by e.starts_on desc nulls last
   limit 1;
  if v_cabinet is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Une version précédente se lit, elle ne se « voit » pas : la nouvelle
  -- photo n'a pas été ouverte. Une pièce retirée par le client non plus :
  -- elle n'attend plus rien.
  if v_archivee is not null
     or exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', null, 'deja', false);
  end if;

  -- Idempotent par envoi : une seule « Vue » depuis le dernier envoi ou la
  -- dernière correction du client — la première. Rouvrir n'écrit rien, deux
  -- ouvertures simultanées non plus (l'index unique tranche).
  v_depuis := coalesce(greatest(app.dernier_envoi(p_piece), app.corrigee_par_le_client(p_piece)),
                       '-infinity'::timestamptz);
  insert into capture.vues (tenant_id, piece_id, cabinet_org_id, par, par_nom, depuis)
  values (v_tenant, p_piece, v_cabinet, auth.uid(), app.nom_au_moment(auth.uid()), v_depuis)
  on conflict (tenant_id, piece_id, cabinet_org_id, depuis) do nothing
  returning vue_le into v_le;
  if v_le is not null then
    return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', false);
  end if;

  select v.vue_le into v_le
    from capture.vues v
   where v.tenant_id = v_tenant and v.piece_id = p_piece
     and v.cabinet_org_id = v_cabinet and v.depuis = v_depuis;
  return jsonb_build_object('piece_id', p_piece, 'vue_le', v_le, 'deja', true);
end
$$;

revoke all on function public.piece_voir(uuid) from public, anon;
grant execute on function public.piece_voir(uuid) to authenticated;

-- --- 4. Le pack d'une pièce ---------------------------------------------------------------------
--
-- Celui de sa dernière analyse ; à défaut, le pack en vigueur de la
-- juridiction du dossier. Écrit une fois : le retour et le forçage le lisent.

create or replace function app.pack_de_la_piece(p_piece uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Rien pour qui ne lit pas la pièce : la fonction voit sous la RLS, pas à côté.
  select case when app.piece_lisible(p_piece) then coalesce(
    (select a.pack_version_id from capture.analyses a
      where a.piece_id = p_piece order by a.created_at desc limit 1),
    (select jp.id
       from ref.jurisdiction_packs jp
       join identity.organizations o on o.jurisdiction = jp.jurisdiction
       join capture.pieces p on p.tenant_id = o.id
      where p.id = p_piece and jp.effective_from <= current_date
      order by jp.effective_from desc limit 1)) end
$$;

revoke all on function app.pack_de_la_piece(uuid) from public, anon;
grant execute on function app.pack_de_la_piece(uuid) to authenticated;

-- --- 5. Le type, établi par le cabinet (R2) -----------------------------------------------------
--
-- Le verrou R2 (`socle.assert_bookable`) n'inscrit rien sur un type qui n'a
-- été que lu : une personne doit l'avoir établi. Ce n'est plus le client —
-- il ne confirme rien —, c'est le cabinet, au moment où il valide ou force.
-- Sans type donné, il retient le type lu ; avec un type, il le choisit (la
-- lecture n'en a reconnu aucun, ou un autre). Tracé à son nom (R7).

drop function if exists public.piece_confirmer_le_type_lu(uuid);

create or replace function public.piece_type_etabli_par_le_cabinet(p_piece uuid, p_type text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_type   text;
  v_statut text;
  v_retenu text;
  v_id     uuid;
begin
  select tenant_id, vis, document_kind, document_kind_statut
    into v_tenant, v_vis, v_type, v_statut
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not app.supervise_le_dossier(v_tenant) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;

  v_retenu := coalesce(nullif(btrim(p_type), ''), v_type);
  if v_retenu is null then
    raise exception 'refus.inscription.type_inconnu' using errcode = 'check_violation';
  end if;
  if v_statut = 'confirme' and v_retenu = v_type then
    return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', true);
  end if;
  -- Un type qui ne porte pas d'écriture ne s'établit pas pour en inscrire une.
  if not exists (select 1 from ref.document_types d
                  where d.code = v_retenu and d.porte_ecriture) then
    raise exception 'refus.inscription.type_sans_ecriture' using errcode = 'check_violation';
  end if;

  insert into capture.precisions (tenant_id, piece_id, champ, valeur)
  values (v_tenant, p_piece, 'document_kind', v_retenu)
  returning id into v_id;

  update capture.pieces
     set document_kind = v_retenu, document_kind_statut = 'confirme', updated_at = now()
   where id = p_piece;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, payload)
  values (v_tenant, auth.uid(), 'piece.precisee', 'capture', 'precisions', v_id,
          jsonb_build_object('piece_id', p_piece, 'champ', 'document_kind', 'valeur', v_retenu,
                             'avant', v_type, 'par_le_cabinet', true));

  return jsonb_build_object('piece_id', p_piece, 'type', v_retenu, 'deja', false);
end
$$;

revoke all on function public.piece_type_etabli_par_le_cabinet(uuid, text) from public, anon;
grant execute on function public.piece_type_etabli_par_le_cabinet(uuid, text) to authenticated;

-- --- 6. Inscrire : la prise en charge du cabinet fait « supervisee » ------------------------------
--
-- Repris À L'IDENTIQUE de `20261022450000`, sauf le statut posé : une
-- écriture de pièce que le cabinet inscrit est prise en charge dans la même
-- instruction (`ecritures_prise_en_charge`) — la pièce est donc supervisée,
-- et non « comptabilisée, à superviser ». Et, en mandat, seul le cabinet
-- inscrit l'écriture d'une pièce (point 8 de l'en-tête).

create or replace function public.socle_ecriture_book(p_ecriture uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_nature  text;
  v_paiement uuid;
  v_reverses uuid;
  v_dossier uuid;
begin
  select piece_id into v_piece from socle.ecritures where id = p_ecriture;
  -- La pièce de l'écriture ET sa version courante — celle que le contrôle R2
  -- juge —, dans l'ordre des identifiants : une reprise ou une suppression de
  -- la courante attend cette inscription, puis la voit.
  if v_piece is not null then
    perform 1 from capture.pieces
     where id in (v_piece, app.version_courante(v_piece)) order by id for update;
  end if;

  select e.nature, e.paiement_id, e.reverses_id, e.tenant_id
    into v_nature, v_paiement, v_reverses, v_dossier
    from socle.ecritures e where e.id = p_ecriture and e.status = 'proposee';

  -- L'annulation d'un règlement, dans un dossier confié à une comptabilité,
  -- est inscrite par l'expert mandaté, et par lui seul (revue du 24 octobre
  -- 2026) : la PME ne touche pas au grand livre qu'elle a confié.
  if v_nature = 'reglement' and v_reverses is not null
     and exists (select 1 from identity.engagements g
                  where g.pme_org_id = v_dossier and g.status = 'actif')
     and v_dossier not in (select app.engaged_orgs_as_expert()) then
    raise exception 'L''annulation d''un règlement est inscrite par l''expert mandaté.'
      using errcode = '42501', hint = 'reglement.annulation_expert';
  end if;
  -- L'écriture d'une pièce, dans un dossier EN MANDAT confié à un cabinet
  -- engagé, est l'acte du cabinet (« Malica sans blocage ») : le client ne
  -- voit ni ne confirme d'écriture, il n'en inscrit donc pas non plus. Le
  -- dossier AUTONOME tient lui-même ses livres (`booked_autonome`), et un
  -- dossier sans cabinet n'a personne d'autre pour les tenir : ces deux cas
  -- restent ouverts. Le règlement, lui, reste un geste de la PME (`pme.regler`).
  if v_nature = 'piece'
     and app.livres_tenus_par_le_cabinet(v_dossier)
     and not app.supervise_le_dossier(v_dossier) then
    raise exception 'refus.inscription.reservee_au_cabinet'
      using errcode = '42501', hint = 'inscription.cabinet';
  end if;
  -- Une contre-passation éteint l'écriture vivante : elle ne la double pas.
  if v_nature is not null and v_piece is not null and v_reverses is null and exists (
       select 1 from socle.ecritures o
        where o.piece_id = v_piece and o.id <> p_ecriture
          and o.nature = v_nature and o.paiement_id is not distinct from v_paiement
          and app.ecriture_vivante(o.id)) then
    raise exception 'Cette pièce porte déjà une écriture inscrite : une seconde la compterait deux fois.'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  update socle.ecritures
     set status = 'booked',
         booked_by = auth.uid(),
         booked_at = now(),
         updated_at = now()
   where id = p_ecriture and status = 'proposee'
  returning tenant_id into v_tenant;

  if v_tenant is null then
    raise exception 'ecriture introuvable, deja comptabilisee ou non autorisee'
      using errcode = '42501';
  end if;

  -- Un règlement inscrit ne fait pas repasser une facture supervisée en
  -- « comptabilisée » : seule l'écriture de la facture fait le statut. Celle
  -- que le cabinet inscrit est prise en charge (le déclencheur vient de le
  -- poser) : la pièce est supervisée.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when exists (select 1 from socle.prises_en_charge x
                                       where x.ecriture_id = p_ecriture)
                         then 'supervisee' else 'comptabilisee' end,
           updated_at = now()
     where id = v_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece, 'nature', v_nature,
                             'paiement_id', v_paiement));
end
$$;

-- --- 7. La contre-passation, écrite une fois ------------------------------------------------------
--
-- Toute contre-passation porte son motif gouverné (`ecritures_check4`). Celle
-- d'un forçage dit le sien : le cabinet a corrigé l'écriture lui-même. Le
-- motif n'est pas proposé pour un retour (`active = false`) : il ne demande
-- rien au client, il ne lui est jamais montré.

insert into ref.rejet_motifs (code, severity, requires_note, sort_order, active, valid_from,
                              geste, preuve)
select 'ecriture_forcee', 'avertissement', false, 110, false, date '2026-10-30',
       'repondre', 'aucune'
 where not exists (select 1 from ref.rejet_motifs where code = 'ecriture_forcee');

insert into ref.labels (ns, key, locale, value) values
  ('rejet_motif', 'ecriture_forcee', 'fr', 'Écriture forcée par le cabinet'),
  ('rejet_motif', 'ecriture_forcee', 'en', 'Entry forced by the accountant'),
  ('rejet_motif', 'ecriture_forcee', 'ar', 'قيد فرضه المحاسب')
on conflict (ns, key, locale) do nothing;

create or replace function public.socle_ecriture_contre_passer(p_ecriture uuid, p_motif uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_entity  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_journal text;
  v_libelle text;
  v_devise  text;
  v_date    date;
  v_rev     uuid;
  v_i       smallint := 0;
  v_l       record;
begin
  select tenant_id, entity_id, piece_id, pack_version_id, journal, libelle, devise, date_ecriture
    into v_tenant, v_entity, v_piece, v_pack, v_journal, v_libelle, v_devise, v_date
    from socle.ecritures where id = p_ecriture;
  if v_tenant is null then
    raise exception 'ecriture introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Défaire une écriture d'un dossier tenu par un cabinet est l'acte du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if not app.ecriture_vivante(p_ecriture) then
    raise exception 'Cette écriture est déjà contre-passée : elle ne se supervise plus.'
      using errcode = 'check_violation', hint = 'ecriture.contre_passee';
  end if;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               status, reverses_id, reversal_reason_id)
  values (v_tenant, v_entity, v_piece, 'partage', v_journal,
          app.date_de_contre_passation(v_tenant, v_date), v_devise,
          'Contre-passation — ' || v_libelle, v_pack,
          'proposee', p_ecriture, p_motif)
  returning id into v_rev;

  for v_l in
    select ordinal, account_code, libelle, debit, credit, tax_code
      from socle.ecriture_lignes where ecriture_id = p_ecriture order by ordinal
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code)
    values (v_tenant, v_rev, v_i, v_l.account_code,
            'Contre-passation — ' || v_l.libelle,
            v_l.credit, v_l.debit, v_l.tax_code);
  end loop;

  update socle.ecritures
     set status = 'booked', booked_by = auth.uid(), booked_at = now(), updated_at = now()
   where id = v_rev;

  return v_rev;
end
$$;

revoke all on function public.socle_ecriture_contre_passer(uuid, uuid) from public, anon;
grant execute on function public.socle_ecriture_contre_passer(uuid, uuid) to authenticated;

-- La revue, reprise de `20261029190000` : la contre-passation passe par la
-- fonction ci-dessus, le reste est inchangé.
create or replace function public.socle_ecriture_review(
  p_ecriture uuid, p_outcome app.review_outcome_t, p_motif uuid default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_pack    uuid;
  v_status  text;
  v_rev     uuid;
  v_requires_note boolean;
  v_courante uuid;
begin
  select tenant_id, piece_id, pack_version_id, status
    into v_tenant, v_piece, v_pack, v_status
    from socle.ecritures where id = p_ecriture;
  -- Le verdict porte sur la pièce, donc sur sa version courante ; la
  -- contre-passation, elle, garde la pièce de l'écriture qu'elle annule.
  v_courante := app.version_courante(v_piece);

  if v_tenant is null then
    raise exception 'ecriture introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- La supervision est le second regard : elle revient à l'expert ou au
  -- collaborateur du cabinet engagé, jamais à l'assistant (ANO-CAB-006). Un
  -- membre de la société la garde seulement quand elle tient ses livres
  -- (dossier autonome, ou sans cabinet) : en mandat, elle ne valide ni ne
  -- contre-passe l'écriture du cabinet.
  if not app.peut_superviser(v_tenant) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_status <> 'booked' then
    raise exception 'seule une ecriture comptabilisee est supervisable'
      using errcode = 'check_violation';
  end if;

  if p_outcome = 'retourne' then
    if p_motif is null then
      raise exception 'un retour exige un motif gouverne' using errcode = 'check_violation';
    end if;
    select requires_note into v_requires_note from ref.rejet_motifs where id = p_motif;
    if v_requires_note is null then
      raise exception 'motif inconnu' using errcode = 'check_violation';
    end if;
    if v_requires_note and coalesce(btrim(p_note), '') = '' then
      raise exception 'ce motif exige une note' using errcode = 'check_violation';
    end if;
  end if;

  update socle.ecritures
     set reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_outcome = p_outcome,
         review_motif_id = p_motif,
         review_note = p_note,
         updated_at = now()
   where id = p_ecriture;

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, v_courante,
          case when p_outcome = 'valide' then 'conforme'::app.verdict_t
               else 'a_corriger'::app.verdict_t end,
          p_motif, p_note, v_pack, auth.uid());

  if p_outcome = 'valide' then
    update capture.pieces set status = 'supervisee', updated_at = now()
     where id = v_courante;
  else
    v_rev := public.socle_ecriture_contre_passer(p_ecriture, p_motif);
    update capture.pieces set status = 'retournee', updated_at = now()
     where id = v_courante;
  end if;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant,
          case when p_outcome = 'valide' then 'piece.validee' else 'piece.retournee' end,
          jsonb_build_object('piece_id', v_courante, 'ecriture_id', p_ecriture,
                             'motif_id', p_motif, 'note', p_note));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(),
          case when p_outcome = 'valide' then 'ecriture.validee' else 'ecriture.retournee' end,
          'socle', 'ecritures', p_ecriture, p_motif, v_pack,
          jsonb_build_object('piece_id', v_piece, 'reversal_id', v_rev, 'note', p_note));

  return v_rev;
end $$;

-- --- 8. Le double regard porte sur la validation --------------------------------------------------
--
-- Repris À L'IDENTIQUE de sa dernière version, sauf la dernière garde : en
-- mode mandat, celui qui a inscrit l'écriture ne la VALIDE pas lui-même. Un
-- retour, lui, contre-passe : il n'approuve rien, et le cabinet qui a pris la
-- pièce en charge doit toujours pouvoir la rendre au client (spec §4).

create or replace function socle.assert_bookable()
returns trigger
language plpgsql
security definer
set search_path = socle, identity, capture, ref, app, pg_catalog
as $$
declare
  v_debit  numeric(38,3);
  v_credit numeric(38,3);
  v_count  integer;
  v_mode   app.validation_mode_t;
  v_kind   text;
  v_statut text;
  v_porte  boolean;
begin
  if new.status = 'booked' and (old.status is distinct from 'booked') then
    select count(*), coalesce(sum(l.debit),0), coalesce(sum(l.credit),0)
      into v_count, v_debit, v_credit
      from socle.ecriture_lignes l where l.ecriture_id = new.id;

    if v_count = 0 then
      raise exception 'R5 : une ecriture sans ligne ne peut pas etre comptabilisee'
        using errcode = 'check_violation';
    end if;
    if v_debit <> v_credit then
      raise exception 'R5 : desequilibre debit=% credit=%', v_debit, v_credit
        using errcode = 'check_violation';
    end if;

    /*
     * Ce qui a été photographié doit être un document qui porte écriture, et
     * son type doit être ÉTABLI — par le cabinet qui valide ou force
     * (`piece_type_etabli_par_le_cabinet`), ou par la personne qui l'a
     * précisé (`capture_precision_persist`).
     *
     * Une écriture sans pièce reste possible — une écriture d'à-nouveaux, une
     * régularisation. C'est le rattachement à une pièce qui est contrôlé, pas
     * son existence.
     *
     * Une photo reprise : c'est la version courante qui dit le type (un
     * règlement saisi sur l'ancienne garde son écriture sur l'ancienne).
     */
    if new.piece_id is not null then
      select p.document_kind, p.document_kind_statut
        into v_kind, v_statut
        from capture.pieces p where p.id = app.version_courante(new.piece_id);

      if v_statut is distinct from 'confirme' then
        raise exception 'R2 : le type de la piece n''est pas confirme (%), aucune ecriture ne peut en decouler',
          coalesce(v_statut, 'inconnu')
          using errcode = 'check_violation';
      end if;

      select t.porte_ecriture into v_porte
        from ref.document_types t where t.code = v_kind;

      if coalesce(v_porte, false) = false then
        raise exception 'R2 : un document de type % ne porte pas d''ecriture comptable',
          coalesce(v_kind, 'inconnu')
          using errcode = 'check_violation';
      end if;
    end if;

    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    new.booked_autonome := (v_mode = 'autonome');
  end if;

  if new.review_outcome = 'valide' and new.reviewed_by is not null then
    select o.validation_mode into v_mode
      from identity.organizations o where o.id = new.tenant_id;
    if v_mode = 'mandate' and new.reviewed_by = new.booked_by then
      raise exception 'chk_ecr_4eyes : en mode mandat, le superviseur ne peut pas etre celui qui a comptabilise'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

-- --- 9. Retourner au client, à toute étape -----------------------------------------------------

create or replace function public.piece_retourner(p_piece uuid, p_motif uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_vis    app.vis_t;
  v_status text;
  v_pack   uuid;
  v_note_requise boolean;
  v_vivante uuid;
  v_rev    uuid;
begin
  select tenant_id, vis, status into v_tenant, v_vis, v_status
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  -- Le second regard revient à l'expert ou au collaborateur du cabinet engagé.
  if not app.supervise_le_dossier(v_tenant) then
    raise exception 'La supervision revient à l''expert ou au collaborateur du cabinet.'
      using errcode = '42501', hint = 'supervision.role';
  end if;
  if v_vis <> 'partage'::app.vis_t then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if exists (select 1 from capture.remplacements r where r.piece_id = p_piece) then
    raise exception 'refus.piece.remplacee' using errcode = 'check_violation';
  end if;
  if v_status = 'retournee' then
    raise exception 'refus.retour.deja' using errcode = 'check_violation';
  end if;

  -- Un motif retiré du référentiel ne se choisit plus.
  select requires_note into v_note_requise
    from ref.rejet_motifs where id = p_motif and active;
  if v_note_requise is null then
    raise exception 'motif inconnu' using errcode = 'check_violation';
  end if;
  if v_note_requise and coalesce(btrim(p_note), '') = '' then
    raise exception 'ce motif exige une note' using errcode = 'check_violation';
  end if;

  -- Un règlement inscrit engage la pièce (lot 1, #127) : il s'annule d'abord,
  -- la pièce se retourne ensuite. Retourner ne défait pas un paiement réel —
  -- et cela vaut AVANT la prise en charge comme après : le contrôle précède
  -- la contre-passation de l'écriture de la facture.
  if exists (select 1 from socle.ecritures e
              where e.piece_id in (select app.versions_de_la_piece(p_piece))
                and e.nature <> 'piece'
                and app.ecriture_vivante(e.id)) then
    raise exception 'refus.retour.inscrite' using errcode = 'check_violation';
  end if;

  -- Prise en charge : son écriture se contre-passe au journal du jour, puis
  -- la même carte de retour (spec §3). La revue fait les deux.
  select e.id into v_vivante
    from socle.ecritures e
   where e.piece_id in (select app.versions_de_la_piece(p_piece))
     and e.nature = 'piece'
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_vivante is not null then
    v_rev := public.socle_ecriture_review(v_vivante, 'retourne', p_motif, p_note);
    return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                              'contre_passation', v_rev);
  end if;

  v_pack := app.pack_de_la_piece(p_piece);

  insert into capture.conformite (tenant_id, piece_id, verdict, motif_id, note,
                                  pack_version_id, decided_by)
  values (v_tenant, p_piece, 'a_corriger'::app.verdict_t, p_motif, nullif(btrim(p_note), ''),
          v_pack, auth.uid());

  update capture.pieces set status = 'retournee', updated_at = now() where id = p_piece;

  insert into collab.notifications (tenant_id, kind, payload)
  values (v_tenant, 'piece.retournee',
          jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif,
                             'note', nullif(btrim(p_note), '')));

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.retournee', 'capture', 'pieces', p_piece, p_motif, v_pack,
          jsonb_build_object('note', nullif(btrim(p_note), ''), 'sans_ecriture', true));

  return jsonb_build_object('piece_id', p_piece, 'motif_id', p_motif, 'contre_passation', null);
end
$$;

revoke all on function public.piece_retourner(uuid, uuid, text) from public, anon;
grant execute on function public.piece_retourner(uuid, uuid, text) to authenticated;

-- --- 10. La relance « confirmez » n'a plus d'objet --------------------------------------------------
--
-- Le client ne confirme rien : on cesse de poser ce fait. Les notifications
-- `piece.confirmation_demandee` et les traces `piece.confirmation_demandee`
-- déjà inscrites restent (R7).

drop function if exists public.piece_demander_confirmation(uuid);

-- --- 11. Le pilotage compte les prises en charge ---------------------------------------------------
--
-- « Supervisées du mois » comptait les revues `valide`. La prise en charge
-- (valider ou forcer) n'écrit plus de revue : c'est son registre qui compte,
-- lu par le cabinet sous sa RLS (`tenant_id` = le cabinet).

create or replace view public.prises_en_charge_v with (security_invoker = true) as
  select tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le
    from socle.prises_en_charge;

grant select on public.prises_en_charge_v to authenticated;

-- --- 12. Toute contre-passation d'une écriture du journal y entre -------------------------------
--
-- Repris de `20261029230000`, plus un cas : la contre-passation d'une écriture
-- qu'un cabinet a prise en charge entre à SON journal, quel que soit l'auteur
-- (un dossier autonome qui défait l'écriture de son cabinet, une reprise).
-- Sans elle, le journal du jour et l'export montreraient l'écriture et non
-- son annulation.

create or replace function app.geler_la_prise_en_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_par uuid;
  v_le  timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'booked' then return null; end if;
    v_par := new.booked_by;
    v_le := new.booked_at;
  elsif new.status = 'booked' and old.status is distinct from 'booked' then
    v_par := new.booked_by;
    v_le := new.booked_at;
  elsif new.review_outcome = 'valide' and new.reviewed_at is distinct from old.reviewed_at then
    v_par := new.reviewed_by;
    v_le := new.reviewed_at;
  else
    return null;
  end if;

  insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
  select e.cabinet_org_id, new.id, new.tenant_id, v_par, app.nom_au_moment(v_par), v_le
    from identity.engagements e
    join identity.memberships m on m.tenant_id = e.cabinet_org_id and m.user_id = v_par
   where e.pme_org_id = new.tenant_id and e.status = 'actif'
  on conflict (tenant_id, ecriture_id) do nothing;

  if new.reverses_id is not null and new.status = 'booked' then
    insert into socle.prises_en_charge (tenant_id, ecriture_id, client_tenant_id, par, par_nom, prise_le)
    select o.tenant_id, new.id, new.tenant_id, v_par, app.nom_au_moment(v_par), v_le
      from socle.prises_en_charge o
     where o.ecriture_id = new.reverses_id
    on conflict (tenant_id, ecriture_id) do nothing;
  end if;
  return null;
end $$;
revoke all on function app.geler_la_prise_en_charge() from public, anon, authenticated;

commit;
