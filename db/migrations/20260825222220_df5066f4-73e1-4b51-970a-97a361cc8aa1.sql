-- 012_banque_rapprochement.sql

-- ---------------------------- JOURNAL DES LETTRAGES (append-only) ----------------------------
create table if not exists banque.lettrages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  ligne_id         uuid not null references banque.releve_lignes(id) on delete cascade,
  ecriture_id      uuid not null references socle.ecritures(id) on delete cascade,
  action           text not null check (action in ('lettre','delettre')),
  seq              integer not null check (seq >= 1),
  score            smallint not null default 0 check (score between 0 and 100),
  ecart_montant    app.money_t not null default 0,
  ecart_jours      smallint not null default 0,
  reference_exacte boolean not null default false,
  motif_id         uuid references ref.rejet_motifs(id),
  note             text,
  pack_version_id  uuid not null references ref.jurisdiction_packs(id),
  decided_by       uuid,
  created_at       timestamptz not null default now(),
  unique (ligne_id, ecriture_id, seq)
);
create index if not exists banque_lettrages_tenant_idx
  on banque.lettrages (tenant_id, created_at desc);

-- Etat courant : zero doublon garanti par la base
create table if not exists banque.lettrage_etat (
  ligne_id         uuid primary key references banque.releve_lignes(id) on delete cascade,
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  ecriture_id      uuid not null references socle.ecritures(id) on delete cascade,
  active           boolean not null default true,
  score            smallint not null default 0 check (score between 0 and 100),
  ecart_montant    app.money_t not null default 0,
  ecart_jours      smallint not null default 0,
  reference_exacte boolean not null default false,
  pack_version_id  uuid not null references ref.jurisdiction_packs(id),
  updated_at       timestamptz not null default now()
);
create unique index if not exists banque_lettrage_etat_ecriture_uniq
  on banque.lettrage_etat (tenant_id, ecriture_id) where active;

select app.enable_tenant_rls('banque', 'lettrages', false, true);
select app.enable_tenant_rls('banque', 'lettrage_etat', false, false);

create trigger banque_lettrage_etat_touch before update on banque.lettrage_etat
  for each row execute function app.touch_updated_at();

create policy banque_lettrages_ins_cabinet on banque.lettrages for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy banque_lettrage_etat_ins_cabinet on banque.lettrage_etat for insert to authenticated
  with check (tenant_id in (select app.engaged_orgs()));
create policy banque_lettrage_etat_upd_cabinet on banque.lettrage_etat for update to authenticated
  using (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()))
  with check (tenant_id in (select app.member_orgs()) or tenant_id in (select app.engaged_orgs()));

-- ---------------------------- VUES ----------------------------
create or replace view public.banque_lettrages_v with (security_invoker = true) as
  select id, tenant_id, ligne_id, ecriture_id, action, seq, score, ecart_montant,
         ecart_jours, reference_exacte, motif_id, note, pack_version_id,
         decided_by, created_at
    from banque.lettrages;

create or replace view public.banque_lettrage_etat_v with (security_invoker = true) as
  select ligne_id, tenant_id, ecriture_id, active, score, ecart_montant, ecart_jours,
         reference_exacte, pack_version_id, updated_at
    from banque.lettrage_etat;

do $$
declare v text;
begin
  foreach v in array array['banque_lettrages_v','banque_lettrage_etat_v'] loop
    execute format('revoke all on public.%I from public, anon, service_role', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------- ECRITURES CANDIDATES ----------------------------
create or replace function public.banque_book_lignes(
  p_tenant uuid,
  p_prefix text,
  p_from date,
  p_to date
) returns table(
  ecriture_id uuid,
  piece_id uuid,
  date_ecriture date,
  journal text,
  libelle text,
  montant numeric,
  reference text,
  lettree boolean
)
language sql
stable
set search_path to ''
as $$
  select e.id, e.piece_id, e.date_ecriture, e.journal, e.libelle,
         sum(l.debit - l.credit) as montant,
         max(l.tax_code) as reference,
         exists (select 1 from banque.lettrage_etat t
                  where t.ecriture_id = e.id and t.active) as lettree
    from socle.ecritures e
    join socle.ecriture_lignes l on l.ecriture_id = e.id
   where e.tenant_id = p_tenant
     and e.status = 'booked'
     and e.date_ecriture between p_from and p_to
     and l.account_code like p_prefix || '%'
   group by e.id, e.piece_id, e.date_ecriture, e.journal, e.libelle
   order by e.date_ecriture, e.id
$$;

-- ---------------------------- GESTES INDIVISIBLES ----------------------------
-- Apparier : consigner la decision du Socle, marquer la ligne, journaliser.
create or replace function public.banque_lettrer(
  p_ligne uuid,
  p_ecriture uuid,
  p_score smallint,
  p_ecart_montant numeric,
  p_ecart_jours smallint,
  p_reference_exacte boolean,
  p_pack_version uuid
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_seq integer;
  v_id uuid;
begin
  select tenant_id into v_tenant from banque.releve_lignes where id = p_ligne for update;
  if v_tenant is null then
    raise exception 'ligne de releve introuvable ou non autorisee' using errcode = '42501';
  end if;
  if not exists (select 1 from socle.ecritures e
                  where e.id = p_ecriture and e.tenant_id = v_tenant
                    and e.status = 'booked') then
    raise exception 'ecriture introuvable, non comptabilisee ou hors tenant'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from banque.lettrage_etat t where t.ligne_id = p_ligne and t.active) then
    raise exception 'ligne deja lettree' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from banque.lettrage_etat t
              where t.tenant_id = v_tenant and t.ecriture_id = p_ecriture and t.active) then
    raise exception 'ecriture deja lettree a une autre ligne' using errcode = 'unique_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from banque.lettrages where ligne_id = p_ligne and ecriture_id = p_ecriture;

  insert into banque.lettrages (tenant_id, ligne_id, ecriture_id, action, seq, score,
                                ecart_montant, ecart_jours, reference_exacte,
                                pack_version_id, decided_by)
  values (v_tenant, p_ligne, p_ecriture, 'lettre', v_seq, coalesce(p_score, 0),
          coalesce(p_ecart_montant, 0), coalesce(p_ecart_jours, 0),
          coalesce(p_reference_exacte, false), p_pack_version, auth.uid())
  returning id into v_id;

  insert into banque.lettrage_etat (ligne_id, tenant_id, ecriture_id, active, score,
                                    ecart_montant, ecart_jours, reference_exacte,
                                    pack_version_id)
  values (p_ligne, v_tenant, p_ecriture, true, coalesce(p_score, 0),
          coalesce(p_ecart_montant, 0), coalesce(p_ecart_jours, 0),
          coalesce(p_reference_exacte, false), p_pack_version)
  on conflict (ligne_id) do update
    set ecriture_id = excluded.ecriture_id,
        active = true,
        score = excluded.score,
        ecart_montant = excluded.ecart_montant,
        ecart_jours = excluded.ecart_jours,
        reference_exacte = excluded.reference_exacte,
        pack_version_id = excluded.pack_version_id,
        updated_at = now();

  update banque.releve_lignes
     set status = 'rapprochee', updated_at = now()
   where id = p_ligne;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'banque.lettre', 'banque', 'lettrages', v_id,
          p_pack_version,
          jsonb_build_object('ligne_id', p_ligne, 'ecriture_id', p_ecriture,
                             'score', p_score, 'ecart_montant', p_ecart_montant,
                             'ecart_jours', p_ecart_jours, 'seq', v_seq));

  return jsonb_build_object('lettrage_id', v_id, 'seq', v_seq);
end $$;

-- Annuler un appariement : motif gouverne obligatoire, historique conserve.
create or replace function public.banque_delettrer(
  p_ligne uuid,
  p_motif uuid,
  p_note text default null
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_ecriture uuid;
  v_pack uuid;
  v_seq integer;
  v_id uuid;
  v_requires_note boolean;
begin
  select tenant_id, ecriture_id, pack_version_id
    into v_tenant, v_ecriture, v_pack
    from banque.lettrage_etat where ligne_id = p_ligne and active for update;
  if v_tenant is null then
    raise exception 'aucun lettrage actif sur cette ligne' using errcode = 'check_violation';
  end if;
  if p_motif is null then
    raise exception 'un delettrage exige un motif gouverne' using errcode = 'check_violation';
  end if;
  select requires_note into v_requires_note from ref.rejet_motifs where id = p_motif;
  if v_requires_note is null then
    raise exception 'motif inconnu' using errcode = 'check_violation';
  end if;
  if v_requires_note and coalesce(btrim(p_note), '') = '' then
    raise exception 'ce motif exige une note' using errcode = 'check_violation';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from banque.lettrages where ligne_id = p_ligne and ecriture_id = v_ecriture;

  insert into banque.lettrages (tenant_id, ligne_id, ecriture_id, action, seq,
                                motif_id, note, pack_version_id, decided_by)
  values (v_tenant, p_ligne, v_ecriture, 'delettre', v_seq, p_motif, p_note,
          v_pack, auth.uid())
  returning id into v_id;

  update banque.lettrage_etat
     set active = false, updated_at = now()
   where ligne_id = p_ligne;

  update banque.releve_lignes
     set status = 'ouverte', updated_at = now()
   where id = p_ligne;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, motif_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'banque.delettre', 'banque', 'lettrages', v_id,
          p_motif, v_pack,
          jsonb_build_object('ligne_id', p_ligne, 'ecriture_id', v_ecriture,
                             'note', p_note, 'seq', v_seq));

  return jsonb_build_object('lettrage_id', v_id, 'seq', v_seq);
end $$;

revoke all on function public.banque_book_lignes(uuid, text, date, date) from public, anon;
revoke all on function public.banque_lettrer(uuid, uuid, smallint, numeric, smallint, boolean, uuid) from public, anon;
revoke all on function public.banque_delettrer(uuid, uuid, text) from public, anon;
grant execute on function public.banque_book_lignes(uuid, text, date, date) to authenticated;
grant execute on function public.banque_lettrer(uuid, uuid, smallint, numeric, smallint, boolean, uuid) to authenticated;
grant execute on function public.banque_delettrer(uuid, uuid, text) to authenticated;