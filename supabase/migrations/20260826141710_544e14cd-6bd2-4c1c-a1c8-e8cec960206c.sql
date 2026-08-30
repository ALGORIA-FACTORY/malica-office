-- 019 — Familles de charges gouvernées par le pack + projection interrogeable des articles lus.

create table if not exists ref.charge_familles (
  id               uuid primary key default gen_random_uuid(),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code             text not null,
  label            text not null,
  ordinal          smallint not null default 100,
  is_fallback      boolean not null default false,
  valid_from       date not null default current_date,
  valid_to         date,
  unique (pack_version_id, code, valid_from)
);

create table if not exists ref.charge_famille_rules (
  id               uuid primary key default gen_random_uuid(),
  pack_version_id  uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  famille_code     text not null,
  match_kind       text not null check (match_kind in ('account_prefix','designation_pattern')),
  pattern          text not null,
  priority         smallint not null default 100,
  valid_from       date not null default current_date,
  valid_to         date,
  unique (pack_version_id, match_kind, pattern, valid_from)
);

create table if not exists ref.anomaly_thresholds (
  id                uuid primary key default gen_random_uuid(),
  pack_version_id   uuid not null references ref.jurisdiction_packs(id) on delete cascade,
  code              text not null,
  min_periods       smallint not null default 2,
  deviation_ratio   numeric(10,4) not null default 0.5000,
  min_amount        app.money_t not null default 0,
  valid_from        date not null default current_date,
  valid_to          date,
  unique (pack_version_id, code, valid_from)
);

-- Projection interrogeable des articles lus : chaque valeur reste citée par la lecture.
create table if not exists capture.piece_articles (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  entity_id        uuid references identity.entities(id) on delete set null,
  vis              app.vis_t not null default 'partage',
  piece_id         uuid not null references capture.pieces(id) on delete cascade,
  ordinal          smallint not null,
  designation      text not null,
  quantity         numeric(38,3),
  unit_price_ht    app.money_t,
  unit_price_ttc   app.money_t,
  total_ht         app.money_t,
  famille_code     text not null,
  famille_source   text not null check (famille_source in ('account_prefix','designation_pattern','fallback')),
  period           text not null,
  document_date    date,
  citation_field   text,
  pack_version_id  uuid references ref.jurisdiction_packs(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (piece_id, ordinal)
);

create index if not exists piece_articles_tenant_period_idx
  on capture.piece_articles (tenant_id, period, famille_code);

select app.enable_tenant_rls('capture', 'piece_articles', true, false);

-- Questions Regalica sur un écart de consommation : append-only, la réponse est un fait.
create table if not exists collab.charge_questions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.organizations(id) on delete cascade,
  vis              app.vis_t not null default 'partage',
  period           text not null,
  famille_code     text not null,
  observed         app.money_t not null,
  baseline         app.money_t not null,
  deviation_ratio  numeric(10,4) not null,
  threshold_code   text not null,
  pack_version_id  uuid references ref.jurisdiction_packs(id),
  answer           text check (answer in ('exceptionnel','a_verifier')),
  answered_by      uuid,
  answered_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, period, famille_code)
);

select app.enable_tenant_rls('collab', 'charge_questions', true, false);

-- Résolution déterministe de la famille : règles du pack, priorité croissante, repli explicite.
create or replace function public.charge_famille_resolve(
  p_pack uuid,
  p_account text,
  p_designation text,
  p_at date default current_date
)
returns table(famille_code text, famille_source text)
language sql
stable
set search_path = ''
as $$
  with rules as (
    select r.famille_code, r.match_kind, r.pattern, r.priority
      from ref.charge_famille_rules r
     where r.pack_version_id = p_pack
       and r.valid_from <= p_at
       and (r.valid_to is null or r.valid_to >= p_at)
  ),
  hit as (
    select famille_code, match_kind as famille_source, priority
      from rules
     where (match_kind = 'account_prefix'
            and p_account is not null
            and p_account like pattern || '%')
        or (match_kind = 'designation_pattern'
            and p_designation is not null
            and p_designation ~* pattern)
     order by priority, match_kind
     limit 1
  )
  select famille_code, famille_source from hit
  union all
  select f.code, 'fallback'
    from ref.charge_familles f
   where f.pack_version_id = p_pack and f.is_fallback
     and f.valid_from <= p_at and (f.valid_to is null or f.valid_to >= p_at)
     and not exists (select 1 from hit)
   limit 1
$$;

revoke all on function public.charge_famille_resolve(uuid, text, text, date) from public, anon;
grant execute on function public.charge_famille_resolve(uuid, text, text, date) to authenticated, service_role;

-- Enregistre les articles lus d'une pièce (remplacement de la projection de cette pièce).
create or replace function public.capture_articles_persist(
  p_piece uuid,
  p_pack uuid,
  p_document_date date,
  p_account text,
  p_articles jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_vis app.vis_t;
  v_a jsonb;
  v_i smallint := 0;
  v_fam text;
  v_src text;
  v_period text := to_char(coalesce(p_document_date, current_date), 'YYYY-MM');
begin
  select tenant_id, entity_id, vis into v_tenant, v_entity, v_vis
    from capture.pieces where id = p_piece;
  if v_tenant is null then
    raise exception 'piece introuvable ou non autorisee' using errcode = '42501';
  end if;

  delete from capture.piece_articles where piece_id = p_piece;

  for v_a in select * from jsonb_array_elements(coalesce(p_articles, '[]'::jsonb))
  loop
    if coalesce(btrim(v_a->>'designation'), '') = '' then
      continue;
    end if;
    v_i := v_i + 1;
    select r.famille_code, r.famille_source into v_fam, v_src
      from public.charge_famille_resolve(p_pack, p_account, v_a->>'designation',
                                         coalesce(p_document_date, current_date)) r;
    if v_fam is null then
      raise exception 'aucune famille au pack pour « % » — referentiel incomplet',
        v_a->>'designation' using errcode = 'check_violation';
    end if;

    insert into capture.piece_articles (tenant_id, entity_id, vis, piece_id, ordinal,
      designation, quantity, unit_price_ht, unit_price_ttc, total_ht,
      famille_code, famille_source, period, document_date, citation_field, pack_version_id)
    values (v_tenant, v_entity, v_vis, p_piece, v_i,
      v_a->>'designation',
      nullif(v_a->>'quantity','')::numeric,
      nullif(v_a->>'unit_price_ht','')::numeric,
      nullif(v_a->>'unit_price_ttc','')::numeric,
      nullif(v_a->>'total_ht','')::numeric,
      v_fam, v_src, v_period, p_document_date,
      'articles[' || (v_i - 1)::text || '].designation', p_pack);
  end loop;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (v_tenant, auth.uid(), 'piece.articles_projected', 'capture', 'piece_articles',
          p_piece, p_pack,
          jsonb_build_object('articles', v_i, 'period', v_period, 'account', p_account));

  return jsonb_build_object('piece_id', p_piece, 'articles', v_i, 'period', v_period);
end $$;

revoke all on function public.capture_articles_persist(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.capture_articles_persist(uuid, uuid, date, text, jsonb) to authenticated, service_role;

-- Réponse de la PME à une question de charges : le fait est journalisé, jamais effacé.
create or replace function public.charge_question_answer(
  p_tenant uuid,
  p_period text,
  p_famille text,
  p_observed numeric,
  p_baseline numeric,
  p_ratio numeric,
  p_threshold text,
  p_pack uuid,
  p_answer text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_tenant not in (select app.member_orgs()) then
    raise exception 'organisation non autorisee' using errcode = '42501';
  end if;
  if p_answer not in ('exceptionnel','a_verifier') then
    raise exception 'reponse invalide' using errcode = '22023';
  end if;

  insert into collab.charge_questions (tenant_id, period, famille_code, observed, baseline,
    deviation_ratio, threshold_code, pack_version_id, answer, answered_by, answered_at)
  values (p_tenant, p_period, p_famille, p_observed, p_baseline, p_ratio, p_threshold,
          p_pack, p_answer, auth.uid(), now())
  on conflict (tenant_id, period, famille_code) do update
    set answer = excluded.answer,
        answered_by = excluded.answered_by,
        answered_at = excluded.answered_at,
        observed = excluded.observed,
        baseline = excluded.baseline,
        deviation_ratio = excluded.deviation_ratio,
        updated_at = now()
  returning id into v_id;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_tenant, auth.uid(), 'charge.question_answered', 'collab', 'charge_questions',
          v_id, p_pack,
          jsonb_build_object('period', p_period, 'famille_code', p_famille,
                             'answer', p_answer, 'observed', p_observed,
                             'baseline', p_baseline, 'deviation_ratio', p_ratio));

  return v_id;
end $$;

revoke all on function public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text) from public, anon;
grant execute on function public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text) to authenticated, service_role;

-- Vues publiques (security invoker : la RLS des tables sous-jacentes s'applique).
create or replace view public.ref_charge_familles_v with (security_invoker = true) as
  select id, pack_version_id, code, label, ordinal, is_fallback, valid_from, valid_to
    from ref.charge_familles;
revoke all on table public.ref_charge_familles_v from public, anon, service_role;
grant select on table public.ref_charge_familles_v to authenticated;

create or replace view public.ref_charge_famille_rules_v with (security_invoker = true) as
  select id, pack_version_id, famille_code, match_kind, pattern, priority, valid_from, valid_to
    from ref.charge_famille_rules;
revoke all on table public.ref_charge_famille_rules_v from public, anon, service_role;
grant select on table public.ref_charge_famille_rules_v to authenticated;

create or replace view public.ref_anomaly_thresholds_v with (security_invoker = true) as
  select id, pack_version_id, code, min_periods, deviation_ratio, min_amount, valid_from, valid_to
    from ref.anomaly_thresholds;
revoke all on table public.ref_anomaly_thresholds_v from public, anon, service_role;
grant select on table public.ref_anomaly_thresholds_v to authenticated;

create or replace view public.piece_articles_v with (security_invoker = true) as
  select id, tenant_id, piece_id, ordinal, designation, quantity, unit_price_ht,
         unit_price_ttc, total_ht, famille_code, famille_source, period, document_date,
         citation_field, pack_version_id, vis, created_at
    from capture.piece_articles;
revoke all on table public.piece_articles_v from public, anon, service_role;
grant select on table public.piece_articles_v to authenticated;

create or replace view public.charge_questions_v with (security_invoker = true) as
  select id, tenant_id, period, famille_code, observed, baseline, deviation_ratio,
         threshold_code, pack_version_id, answer, answered_at, vis, created_at
    from collab.charge_questions;
revoke all on table public.charge_questions_v from public, anon, service_role;
grant select on table public.charge_questions_v to authenticated;

-- Seeds Tunisie 2026.1 : familles, règles de compte, seuil d'écart, libellés.
insert into ref.charge_familles (pack_version_id, code, label, ordinal, is_fallback, valid_from)
select p.id, f.code, f.label, f.ord, f.fb, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('MARCHANDISES',       'Marchandises',        10, false),
    ('FOURNITURES',        'Fournitures',         20, false),
    ('LOYER',              'Loyer',               30, false),
    ('TRANSPORT',          'Transport',           40, false),
    ('TELECOM',            'Télécoms',            50, false),
    ('SERVICES_BANCAIRES', 'Services bancaires',  60, false),
    ('HONORAIRES',         'Honoraires',          70, false),
    ('IMPOTS_DROITS',      'Impôts et droits',    80, false),
    ('NON_CLASSE',         'Non classée',        999, true)
  ) as f(code, label, ord, fb)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;

insert into ref.charge_famille_rules (pack_version_id, famille_code, match_kind, pattern, priority, valid_from)
select p.id, r.fam, 'account_prefix', r.pat, r.prio, date '2026-01-01'
from ref.jurisdiction_packs p,
  (values
    ('IMPOTS_DROITS',      '6654', 10),
    ('IMPOTS_DROITS',      '4367', 10),
    ('IMPOTS_DROITS',      '4368', 10),
    ('MARCHANDISES',       '601',  20),
    ('FOURNITURES',        '606',  20),
    ('LOYER',              '613',  20),
    ('TRANSPORT',          '624',  20),
    ('TELECOM',            '626',  20),
    ('SERVICES_BANCAIRES', '627',  20),
    ('HONORAIRES',         '665',  30)
  ) as r(fam, pat, prio)
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, match_kind, pattern, valid_from) do nothing;

insert into ref.anomaly_thresholds (pack_version_id, code, min_periods, deviation_ratio, min_amount, valid_from)
select p.id, 'FAMILLE_CONSO', 2, 0.5000, 50.000, date '2026-01-01'
from ref.jurisdiction_packs p
where p.jurisdiction = 'TN' and p.version = '2026.1'
on conflict (pack_version_id, code, valid_from) do nothing;

insert into ref.labels (ns, key, locale, value) values
  ('charge_famille','MARCHANDISES','fr','Marchandises'),
  ('charge_famille','MARCHANDISES','en','Goods'),
  ('charge_famille','MARCHANDISES','ar','سلع'),
  ('charge_famille','FOURNITURES','fr','Fournitures'),
  ('charge_famille','FOURNITURES','en','Supplies'),
  ('charge_famille','FOURNITURES','ar','لوازم'),
  ('charge_famille','LOYER','fr','Loyer'),
  ('charge_famille','LOYER','en','Rent'),
  ('charge_famille','LOYER','ar','إيجار'),
  ('charge_famille','TRANSPORT','fr','Transport'),
  ('charge_famille','TRANSPORT','en','Transport'),
  ('charge_famille','TRANSPORT','ar','نقل'),
  ('charge_famille','TELECOM','fr','Télécoms'),
  ('charge_famille','TELECOM','en','Telecom'),
  ('charge_famille','TELECOM','ar','اتصالات'),
  ('charge_famille','SERVICES_BANCAIRES','fr','Services bancaires'),
  ('charge_famille','SERVICES_BANCAIRES','en','Bank services'),
  ('charge_famille','SERVICES_BANCAIRES','ar','خدمات بنكية'),
  ('charge_famille','HONORAIRES','fr','Honoraires'),
  ('charge_famille','HONORAIRES','en','Professional fees'),
  ('charge_famille','HONORAIRES','ar','أتعاب'),
  ('charge_famille','IMPOTS_DROITS','fr','Impôts et droits'),
  ('charge_famille','IMPOTS_DROITS','en','Taxes and duties'),
  ('charge_famille','IMPOTS_DROITS','ar','ضرائب ومعاليم'),
  ('charge_famille','NON_CLASSE','fr','Non classée'),
  ('charge_famille','NON_CLASSE','en','Unclassified'),
  ('charge_famille','NON_CLASSE','ar','غير مصنّف')
on conflict (ns, key, locale) do nothing;