-- Une pièce ne s'inscrit qu'une fois ; un règlement non plus (21 octobre 2026).
--
-- Campagne de validation du 21 octobre, ANO-004, ANO-006, ANO-009.
--
-- ANO-004 — deux écritures comptabilisées pour une même facture.
--   `socle_ecriture_propose` supprimait les propositions de la pièce puis en
--   créait une, sans regarder si la pièce était déjà inscrite ; et sous la RLS
--   du cabinet, la suppression ne touchait rien (la politique `delete` ne
--   s'ouvrait qu'aux membres) : chaque clic ajoutait une proposition, et
--   chacune pouvait être comptabilisée.
-- ANO-006 — le règlement partageait la pièce de la facture : proposer l'un
--   effaçait la proposition de l'autre, et rien ne l'empêchait de se répéter.
--   Quatre clics, quatre écritures BQ.
-- ANO-009 — la visibilité d'une écriture était figée à sa proposition : une
--   pièce confirmée PUIS transmise laissait son écriture invisible au cabinet.
--
-- Ce qui change :
--   1. `socle.ecritures` porte sa NATURE (`piece` ou `reglement`) et, pour un
--      règlement, le paiement qu'il inscrit. Les contre-passations héritent
--      de la nature de ce qu'elles annulent.
--   2. Une écriture VIVANTE (comptabilisée, ni contre-passation, ni annulée
--      par une contre-passation comptabilisée) se lit par `app.ecriture_vivante`.
--   3. Proposer verrouille la pièce, refuse une pièce déjà inscrite (il faut
--      contre-passer d'abord), et ne remplace que la proposition de même
--      nature. Un règlement déjà inscrit rend son écriture : la demande est
--      idempotente.
--   4. Comptabiliser refuse une seconde écriture vivante de même nature ; un
--      règlement ne fait plus repasser la facture en « comptabilisée ».
--   5. Un index n'admet qu'une proposition par pièce, nature et paiement ;
--      une écriture n'a qu'une contre-passation.
--   6. Une proposition se retire par l'expert engagé ; une écriture
--      comptabilisée ne se supprime plus (R7), même par un membre.
--   7. Transmettre une pièce transmet ses écritures et ses paiements.
--
-- REJEU (R11) : `if not exists`, `create or replace`, `drop ... if exists`.

begin;

-- 1. La nature, et le paiement d'un règlement -----------------------------

alter table socle.ecritures
  add column if not exists nature text not null default 'piece',
  add column if not exists paiement_id uuid references capture.paiements(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ecritures_nature_connue') then
    alter table socle.ecritures
      add constraint ecritures_nature_connue check (nature in ('piece', 'reglement'));
  end if;
  -- Un règlement nouveau nomme toujours son paiement : `socle_ecriture_propose`
  -- les pose ensemble. Pas de contrainte : les règlements inscrits avant
  -- aujourd'hui ne le portaient pas, et la base ne l'invente pas quand il
  -- n'est pas univoque (voir plus bas).
end $$;

-- Les écritures déjà passées : un journal de trésorerie est celui d'un moyen
-- de paiement du pack, et c'est là, seulement, qu'un règlement s'inscrit.
update socle.ecritures e
   set nature = 'reglement'
 where e.nature = 'piece'
   and e.reverses_id is null
   and e.journal in (select m.journal_code from public.ref_payment_means_v m
                      where m.pack_version_id = e.pack_version_id
                        and m.journal_code is not null);
-- Le paiement d'un règlement passé, quand un seul paiement de la pièce, à la
-- date de l'écriture, par un moyen de ce journal, peut l'avoir produit.
update socle.ecritures e
   set paiement_id = (select x.id from capture.paiements x
                        join public.ref_payment_means_v m
                          on m.pack_version_id = x.pack_version_id and m.code = x.moyen_code
                       where x.piece_id = e.piece_id and x.paye_le = e.date_ecriture
                         and m.journal_code = e.journal and x.annule_paiement_id is null)
 where e.nature = 'reglement' and e.paiement_id is null and e.reverses_id is null
   and (select count(*) from capture.paiements x
          join public.ref_payment_means_v m
            on m.pack_version_id = x.pack_version_id and m.code = x.moyen_code
         where x.piece_id = e.piece_id and x.paye_le = e.date_ecriture
           and m.journal_code = e.journal and x.annule_paiement_id is null) = 1;
update socle.ecritures r
   set nature = o.nature, paiement_id = o.paiement_id
  from socle.ecritures o
 where r.reverses_id = o.id and r.nature <> o.nature;

create index if not exists ecritures_par_paiement on socle.ecritures (paiement_id)
  where paiement_id is not null;

-- La vue des écritures les montre ; les colonnes s'ajoutent EN FIN de liste,
-- ce que `create or replace view` permet sans toucher aux lecteurs existants.
create or replace view public.ecritures_v with (security_invoker = true) as
  select id, tenant_id, entity_id, piece_id, vis, journal, date_ecriture, devise,
         libelle, pack_version_id, status, booked_by, booked_at, booked_autonome,
         reviewed_by, reviewed_at, review_outcome, review_motif_id, review_note,
         reverses_id, reversal_reason_id, created_by, created_at, updated_at,
         nature, paiement_id
    from socle.ecritures;

-- 2. Ce qu'est une écriture vivante ---------------------------------------
-- Une seule définition, que la proposition, la comptabilisation et les
-- agrégats lisent. `security invoker` : chacun ne juge que ce qu'il voit.

create or replace function app.ecriture_vivante(p_ecriture uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from socle.ecritures e
     where e.id = p_ecriture
       and e.status = 'booked'
       and e.reverses_id is null
       and not exists (select 1 from socle.ecritures r
                        where r.reverses_id = e.id and r.status = 'booked'))
$$;

-- 5. Une proposition par pièce, nature et paiement ; une contre-passation par
-- écriture. Les doublons déjà en base sont des PROPOSITIONS (une écriture
-- comptabilisée ne se supprime pas) : on garde la plus récente.

delete from socle.ecriture_lignes l
 using socle.ecritures e
 where l.ecriture_id = e.id
   and e.status = 'proposee'
   and e.reverses_id is null
   and exists (select 1 from socle.ecritures n
                where n.piece_id = e.piece_id and n.nature = e.nature
                  and n.paiement_id is not distinct from e.paiement_id
                  and n.status = 'proposee' and n.reverses_id is null
                  and (n.created_at, n.id) > (e.created_at, e.id));
delete from socle.ecritures e
 where e.status = 'proposee'
   and e.reverses_id is null
   and exists (select 1 from socle.ecritures n
                where n.piece_id = e.piece_id and n.nature = e.nature
                  and n.paiement_id is not distinct from e.paiement_id
                  and n.status = 'proposee' and n.reverses_id is null
                  and (n.created_at, n.id) > (e.created_at, e.id));

create unique index if not exists ecritures_une_proposition
  on socle.ecritures (piece_id, nature,
                      coalesce(paiement_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'proposee' and reverses_id is null;

-- Une écriture déjà contre-passée pouvait être retournée une seconde fois.
-- L'index ne se pose que sur une base saine ; sinon, la migration le dit et
-- passe : une écriture comptabilisée ne se supprime pas pour faire place.
do $$
begin
  if exists (select 1 from socle.ecritures where reverses_id is not null
              group by reverses_id having count(*) > 1) then
    raise warning 'ecritures_une_contre_passation non posé : une écriture porte deux contre-passations';
  else
    create unique index if not exists ecritures_une_contre_passation
      on socle.ecritures (reverses_id) where reverses_id is not null;
  end if;
end $$;

-- 6. Qui retire une proposition ; personne ne retire une écriture inscrite.

drop policy if exists socle_ecritures_del on socle.ecritures;
create policy socle_ecritures_del on socle.ecritures
  for delete to authenticated
  using (status = 'proposee' and tenant_id in (select app.member_orgs()));

drop policy if exists ecritures_del_expert on socle.ecritures;
create policy ecritures_del_expert on socle.ecritures
  for delete to authenticated
  using (status = 'proposee' and vis = 'partage'::app.vis_t
         and tenant_id in (select app.engaged_orgs_as_expert()));

-- 3. Proposer -------------------------------------------------------------
-- Le paiement s'ajoute en dernier argument : `drop` puis `create`, sans quoi
-- deux versions coexisteraient et un appel à sept arguments serait ambigu.

drop function if exists public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text);

create or replace function public.socle_ecriture_propose(
  p_piece uuid, p_journal text, p_date date, p_libelle text, p_pack_version uuid,
  p_lignes jsonb, p_devise text default 'TND', p_paiement uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis    app.vis_t;
  v_nature text := case when p_paiement is null then 'piece' else 'reglement' end;
  v_ecr    uuid;
  v_inscrite uuid;
  v_l      jsonb;
  v_i      smallint := 0;
begin
  -- Le verrou de la pièce sérialise deux clics, deux onglets, deux personnes.
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = p_piece for update;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;
  if p_paiement is not null
     and not exists (select 1 from capture.paiements
                      where id = p_paiement and piece_id = p_piece) then
    raise exception 'ce reglement n''appartient pas a cette piece' using errcode = '22023';
  end if;

  select e.id into v_inscrite
    from socle.ecritures e
   where e.piece_id = p_piece and e.nature = v_nature
     and e.paiement_id is not distinct from p_paiement
     and app.ecriture_vivante(e.id)
   limit 1;
  if v_inscrite is not null then
    -- Un règlement inscrit l'est une fois : redemander rend la même écriture.
    if v_nature = 'reglement' then
      return v_inscrite;
    end if;
    raise exception 'Cette pièce est déjà inscrite. Pour la réimputer, retournez d''abord son écriture : elle sera contre-passée.'
      using errcode = 'check_violation', hint = 'piece.deja_inscrite';
  end if;

  delete from socle.ecritures
   where piece_id = p_piece and status = 'proposee' and reverses_id is null
     and nature = v_nature and paiement_id is not distinct from p_paiement;

  insert into socle.ecritures (tenant_id, entity_id, piece_id, vis, journal,
                               date_ecriture, devise, libelle, pack_version_id,
                               nature, paiement_id)
  values (v_tenant, v_entity, p_piece, v_vis, p_journal, p_date, p_devise,
          p_libelle, p_pack_version, v_nature, p_paiement)
  returning id into v_ecr;

  for v_l in select * from jsonb_array_elements(p_lignes)
  loop
    v_i := v_i + 1;
    insert into socle.ecriture_lignes (tenant_id, ecriture_id, ordinal, account_code,
                                       libelle, debit, credit, tax_code)
    values (v_tenant, v_ecr, v_i, v_l->>'account_code', v_l->>'libelle',
            coalesce((v_l->>'debit')::numeric, 0),
            coalesce((v_l->>'credit')::numeric, 0),
            nullif(v_l->>'tax_code',''));
  end loop;

  -- Seule l'écriture de la facture fait avancer la pièce.
  if v_nature = 'piece' then
    update capture.pieces
       set status = case when status in ('capturee','lue','retournee') then 'proposee' else status end,
           updated_at = now()
     where id = p_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.proposed', 'socle', 'ecritures', v_ecr,
          jsonb_build_object('piece_id', p_piece, 'pack_version_id', p_pack_version,
                             'nature', v_nature, 'paiement_id', p_paiement,
                             'lignes', jsonb_array_length(p_lignes)));

  return v_ecr;
end $function$;

revoke all on function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.socle_ecriture_propose(uuid, text, date, text, uuid, jsonb, text, uuid) to authenticated;

-- 4. Comptabiliser --------------------------------------------------------

create or replace function public.socle_ecriture_book(p_ecriture uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_tenant  uuid;
  v_piece   uuid;
  v_nature  text;
  v_paiement uuid;
begin
  select piece_id into v_piece from socle.ecritures where id = p_ecriture;
  if v_piece is not null then
    perform 1 from capture.pieces where id = v_piece for update;
  end if;

  select e.nature, e.paiement_id into v_nature, v_paiement
    from socle.ecritures e where e.id = p_ecriture and e.status = 'proposee';
  if v_nature is not null and v_piece is not null and exists (
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
  -- « comptabilisée » : seule l'écriture de la facture fait le statut.
  if v_nature = 'piece' then
    update capture.pieces
       set status = 'comptabilisee', updated_at = now()
     where id = v_piece;
  end if;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                              object_id, payload)
  values (v_tenant, auth.uid(), 'ecriture.booked', 'socle', 'ecritures', p_ecriture,
          jsonb_build_object('piece_id', v_piece, 'nature', v_nature,
                             'paiement_id', v_paiement));
end $function$;

-- 7. Transmettre une pièce transmet ce qu'elle porte (ANO-009) ---------------
-- Un déclencheur plutôt qu'un bloc de plus dans `capture_piece_set_vis` : la
-- visibilité change par cette porte aujourd'hui, et la règle doit tenir pour
-- toute porte future. Vers `partage`, tout suit ; hors de `partage` (retour
-- par accord), seules les propositions et les paiements suivent — une
-- écriture inscrite par le cabinet reste sous ses yeux.
-- `security definer` : la fonction ne fait que recopier la visibilité de la
-- pièce, qu'un appelant vient de changer sous sa propre RLS.

create or replace function app.la_piece_transmet_ce_qu_elle_porte()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.vis is distinct from old.vis then
    update socle.ecritures
       set vis = new.vis, updated_at = now()
     where piece_id = new.id
       and reverses_id is null
       and vis is distinct from new.vis
       and (new.vis = 'partage'::app.vis_t or status = 'proposee');
  end if;
  return new;
end $function$;

revoke all on function app.la_piece_transmet_ce_qu_elle_porte() from public, anon, authenticated;

drop trigger if exists la_piece_transmet_ce_qu_elle_porte on capture.pieces;
create trigger la_piece_transmet_ce_qu_elle_porte
  after update of vis on capture.pieces
  for each row execute function app.la_piece_transmet_ce_qu_elle_porte();

-- Ce qui a été transmis avant aujourd'hui, et dont l'écriture est restée en
-- arrière : on le rattrape une fois.
update socle.ecritures e
   set vis = 'partage', updated_at = now()
  from capture.pieces p
 where p.id = e.piece_id and p.vis = 'partage' and e.vis <> 'partage'
   and e.reverses_id is null;

-- 8. Ce qui est inscrit reste ce qu'il est -----------------------------------
-- La nature et le paiement rejoignent les colonnes figées d'une écriture
-- comptabilisée (R7). La visibilité, non : elle suit la pièce (§ 7).

create or replace function socle.freeze_booked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'booked' then
    if new.tenant_id     is distinct from old.tenant_id
    or new.entity_id     is distinct from old.entity_id
    or new.piece_id      is distinct from old.piece_id
    or new.journal       is distinct from old.journal
    or new.date_ecriture is distinct from old.date_ecriture
    or new.devise        is distinct from old.devise
    or new.libelle       is distinct from old.libelle
    or new.pack_version_id is distinct from old.pack_version_id
    or new.status        is distinct from old.status
    or new.booked_by     is distinct from old.booked_by
    or new.booked_at     is distinct from old.booked_at
    or new.reverses_id   is distinct from old.reverses_id
    or new.nature        is distinct from old.nature
    or new.paiement_id   is distinct from old.paiement_id
    then
      raise exception 'R7 : ecriture comptabilisee immuable — une correction est une contre-passation'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end
$function$;

-- 9. On ne supervise qu'une écriture vivante ---------------------------------
-- Une écriture déjà contre-passée se retournait une seconde fois : deux
-- contre-passations pour une facture. Valider une écriture annulée n'a pas
-- de sens non plus.

create or replace function app.supervision_sur_ecriture_vivante()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.review_outcome is not null
     and new.reviewed_at is distinct from old.reviewed_at
     and old.reverses_id is null
     and exists (select 1 from socle.ecritures r
                  where r.reverses_id = old.id and r.status = 'booked') then
    raise exception 'Cette écriture est déjà contre-passée : elle ne se supervise plus.'
      using errcode = 'check_violation', hint = 'ecriture.contre_passee';
  end if;
  return new;
end $function$;

drop trigger if exists supervision_sur_ecriture_vivante on socle.ecritures;
create trigger supervision_sur_ecriture_vivante
  before update of reviewed_at on socle.ecritures
  for each row execute function app.supervision_sur_ecriture_vivante();

commit;
