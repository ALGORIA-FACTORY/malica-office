-- Une charge se classe à la main.
--
-- ================================================================== POURQUOI
--
-- Pilote, 22 novembre 2026 : « Non classée — y a-t-il un crayon qui écrit dans la base,
-- avec une liste de propositions (Tunisie) ? » Une facture lue sans articles, ou dont
-- aucune règle ne reconnaît la désignation, tombe dans la famille de repli du pack
-- (« Non classée ») et y reste : rien ne permettait de la ranger.
--
-- ================================================================== CE QUI SE FAIT
--
--   1. `capture.familles_choisies` : la famille qu'une personne a choisie pour une ligne
--      de charge (la pièce, l'ordinal de l'article ; 0 pour une pièce sans articles).
--      Écrite une fois ; la dernière fait foi, comme les précisions de lecture.
--   2. `public.charge_classer(pièce, ordinal, famille)` : la porte. La famille doit être
--      une famille du pack de la pièce, en vigueur à sa date — la liste proposée est
--      celle du référentiel (R4), jamais une liste écrite à l'écran. Seule une société
--      qui tient ses livres classe ses charges : quand le cabinet les tient, ses écritures
--      font foi.
--   3. `piece_articles_v` : la famille choisie passe devant la famille projetée et devant
--      celle des règles ; sa source est « personne ».

begin;

-- --- 1. Le choix -------------------------------------------------------------

create table capture.familles_choisies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references identity.organizations (id) on delete cascade,
  piece_id     uuid not null references capture.pieces (id) on delete cascade,
  ordinal      smallint not null check (ordinal >= 0),
  famille_code text not null check (length(btrim(famille_code)) > 0),
  decided_by   uuid not null default auth.uid(),
  decided_at   timestamptz not null default clock_timestamp()
);
create index familles_choisies_piece_idx
  on capture.familles_choisies (piece_id, ordinal, decided_at desc);
create index familles_choisies_tenant_idx on capture.familles_choisies (tenant_id, piece_id);

alter table capture.familles_choisies enable row level security;
alter table capture.familles_choisies force row level security;

create policy familles_choisies_sel on capture.familles_choisies for select to authenticated
  using ((tenant_id in (select app.member_orgs())
          or tenant_id in (select app.engaged_orgs())
          or app.plateforme_requise(tenant_id))
         and app.piece_lisible(piece_id));
create policy familles_choisies_ins on capture.familles_choisies for insert to authenticated
  with check (tenant_id in (select app.member_orgs())
              and tenant_id = (select p.tenant_id from capture.pieces p where p.id = piece_id));

-- Le relecteur de nuit n'en a pas besoin : il ne la lit ni ne l'écrit (20261118100000).
create policy service_hors_perimetre on capture.familles_choisies as restrictive
  for select to authenticated using ((select app.service()) is null);

create trigger familles_choisies_no_upd
  before update or delete on capture.familles_choisies
  for each row execute function app.deny_mutation_hors_effacement_de_piece();
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.familles_choisies
  for each row execute function app.pas_de_geste_sur_une_version_precedente();
create trigger service_hors_perimetre
  before insert or update or delete on capture.familles_choisies
  for each statement execute function app.service_hors_perimetre();

revoke all on capture.familles_choisies from public, anon, authenticated;
grant select on capture.familles_choisies to authenticated;

-- --- 2. La porte -------------------------------------------------------------

create or replace function public.charge_classer(p_piece uuid, p_ordinal integer, p_famille text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_jour   date;
  v_id     uuid;
begin
  select p.tenant_id into v_tenant from capture.pieces p where p.id = p_piece;
  if v_tenant is null
     or v_tenant not in (select app.member_orgs())
     or not app.piece_lisible(p_piece) then
    raise exception 'refus.introuvable.piece' using errcode = 'insufficient_privilege';
  end if;
  if app.livres_tenus_par_le_cabinet(v_tenant) then
    raise exception 'refus.charge.classee_par_le_cabinet' using errcode = 'insufficient_privilege';
  end if;
  if p_ordinal is null or p_ordinal < 0 then
    raise exception 'refus.charge.ligne_inconnue' using errcode = 'check_violation';
  end if;

  -- La date de la pièce : celle de sa facture, à défaut le jour où elle est arrivée.
  select coalesce(case when x.payload ->> 'document_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                       then (x.payload ->> 'document_date')::date end,
                  v.recue_le)
    into v_jour
    from public.pieces_v v
    left join lateral (select z.payload from public.extractions_v z
                        where z.piece_id = v.id order by z.created_at desc limit 1) x on true
   where v.id = p_piece;

  if not exists (
       select 1 from public.ref_charge_familles_v f
        where f.pack_version_id = app.pack_de_la_piece(p_piece)
          and f.code = p_famille
          and f.valid_from <= v_jour and (f.valid_to is null or f.valid_to > v_jour)) then
    raise exception '%', app.refus_avec_valeurs('refus.charge.famille_inconnue', 'famille', p_famille)
      using errcode = 'check_violation';
  end if;

  insert into capture.familles_choisies (tenant_id, piece_id, ordinal, famille_code)
  values (v_tenant, p_piece, p_ordinal, p_famille)
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.charge_classer(uuid, integer, text) from public, anon;
grant execute on function public.charge_classer(uuid, integer, text) to authenticated;

-- --- 3. La famille choisie passe devant --------------------------------------

create or replace view public.piece_articles_v with (security_invoker = true) as
 SELECT a.id,
    a.tenant_id,
    a.piece_id,
    a.ordinal,
    a.designation,
    a.quantity,
    a.unit_price_ht,
    a.unit_price_ttc,
    a.total_ht,
    COALESCE(c.famille_code, r.famille_code, a.famille_code) AS famille_code,
    CASE WHEN c.famille_code IS NOT NULL THEN 'personne'
         ELSE COALESCE(r.famille_source, a.famille_source) END AS famille_source,
    a.famille_code AS famille_code_projete,
    a.famille_source AS famille_source_projete,
    a.period,
    a.document_date,
    a.citation_field,
    a.citation_quantity,
    a.citation_unit_price_ht,
    a.citation_unit_price_ttc,
    a.citation_total_ht,
    a.pack_version_id,
    a.vis,
    a.created_at
   FROM capture.piece_articles a
     LEFT JOIN capture.pieces p ON p.id = a.piece_id
     LEFT JOIN LATERAL ( SELECT mm.main_account
           FROM ref_account_mappings_v mm
          WHERE mm.pack_version_id = a.pack_version_id AND mm.document_kind = p.document_kind
          ORDER BY mm.main_account
         LIMIT 1) m ON true
     LEFT JOIN LATERAL charge_famille_resolve(a.pack_version_id, m.main_account, a.designation,
                         COALESCE(a.document_date, p.created_at::date)) r(famille_code, famille_source) ON true
     LEFT JOIN LATERAL ( SELECT fc.famille_code
           FROM capture.familles_choisies fc
          WHERE fc.piece_id = a.piece_id AND fc.ordinal = a.ordinal
          ORDER BY fc.decided_at DESC
         LIMIT 1) c ON true;

commit;
