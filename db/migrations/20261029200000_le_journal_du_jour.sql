-- Le journal du jour du comptable, et ses exports numérotés (28 octobre 2026).
--
-- Spec « Malica sans blocage » (docs/sans-blocage.md, section 4) : le
-- comptable tient un journal du jour — toutes les écritures qu'il a validées
-- ou forcées ce jour-là, et les contre-passations — par journal (achats,
-- ventes, banque, caisse, OD), avec le contrôle débit = crédit. Il l'exporte
-- en Excel ou en CSV ; chaque export est numéroté et gardé, et le suivant dit
-- ce qui a changé depuis le précédent.
--
-- Ce que la base fait ici :
--   1. l'ordre des journaux et leur libellé dans les trois langues : du
--      référentiel, pas de l'écran ;
--   2. le journal des exports (`collab.exports`, append-only) apprend le
--      journal du jour : un numéro par cabinet, dossier et jour, et la liste
--      des écritures exportées — ce qui permet de dire, au suivant, ce qui a
--      changé ;
--   3. la lecture du journal : une seule définition de « inscrite ce jour-là »
--      et de l'origine d'une écriture (validée, forcée, contre-passation) ;
--   4. la journalisation d'un export du journal.
--
-- R7 : rien ici ne modifie une écriture. Le journal est « toujours
-- modifiable » au sens comptable : une correction est une contre-passation
-- et une écriture nouvelle, qui paraissent toutes deux au journal du jour où
-- elles sont inscrites.
--
-- REJEU (R11) : `if not exists`, `on conflict`, `create or replace` ; aucune
-- date du jour écrite dans le référentiel.

begin;

-- --- 1. Les journaux : un rang, et un libellé par langue ---------------------------
-- Le rang dit l'ordre dans lequel un comptable lit ses journaux. Un journal
-- ajouté plus tard sans rang se range après les autres, par code : il
-- paraît, il ne disparaît pas.
alter table ref.journals add column if not exists rang smallint;

update ref.journals j
   set rang = v.rang
  from (values ('ACH', 1), ('VEN', 2), ('BQ', 3), ('CA', 4), ('OD', 5)) as v(code, rang)
 where j.code = v.code
   and j.rang is distinct from v.rang;

insert into ref.labels (ns, key, locale, value) values
  ('journal', 'ACH', 'fr', 'Journal des achats'),
  ('journal', 'ACH', 'en', 'Purchases journal'),
  ('journal', 'ACH', 'ar', 'يومية المشتريات'),
  ('journal', 'VEN', 'fr', 'Journal des ventes'),
  ('journal', 'VEN', 'en', 'Sales journal'),
  ('journal', 'VEN', 'ar', 'يومية المبيعات'),
  ('journal', 'BQ', 'fr', 'Journal de banque'),
  ('journal', 'BQ', 'en', 'Bank journal'),
  ('journal', 'BQ', 'ar', 'يومية البنك'),
  ('journal', 'CA', 'fr', 'Journal de caisse'),
  ('journal', 'CA', 'en', 'Cash journal'),
  ('journal', 'CA', 'ar', 'يومية الصندوق'),
  ('journal', 'OD', 'fr', 'Opérations diverses'),
  ('journal', 'OD', 'en', 'Miscellaneous operations'),
  ('journal', 'OD', 'ar', 'عمليات متنوعة')
on conflict (ns, key, locale) do update set value = excluded.value;

-- --- 2. Le journal des exports apprend le journal du jour ---------------------------
-- `du` = `au` = le jour exporté. `numero` compte les exports d'un même
-- cabinet, dossier (ou « tous », nul) et jour, à partir de 1. `ecritures`
-- est la liste des écritures du fichier, `contre_passees` celles qui y
-- figuraient déjà contre-passées : l'export suivant s'y compare.
alter table collab.exports drop constraint if exists exports_format_check;
alter table collab.exports add constraint exports_format_check
  check (format in ('fec', 'csv_ecritures', 'csv_plan', 'journal_csv', 'journal_xlsx'));

alter table collab.exports add column if not exists numero integer;
alter table collab.exports add column if not exists ecritures uuid[];
alter table collab.exports add column if not exists contre_passees uuid[];

alter table collab.exports drop constraint if exists exports_journal_numerote;
alter table collab.exports add constraint exports_journal_numerote check (
  (format in ('journal_csv', 'journal_xlsx'))
    = (numero is not null and numero > 0 and ecritures is not null
       and contre_passees is not null and du = au));

-- Un numéro ne sert qu'une fois par cabinet, dossier et jour : deux exports
-- simultanés ne peuvent pas porter le même. L'index mène par `tenant_id` (R6).
create unique index if not exists exports_journal_numero_unique
  on collab.exports (tenant_id,
                     coalesce(client_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     du, numero)
  where numero is not null;

create or replace view public.exports_v with (security_invoker = true) as
select id, tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
       pack_version_id, created_by, created_at, numero, ecritures, contre_passees
  from collab.exports;
revoke all on public.exports_v from public, anon, service_role;
grant select on public.exports_v to authenticated;

-- --- 3. Le journal du jour ---------------------------------------------------------
-- Une ligne par ligne d'écriture inscrite au journal du cabinet ce jour-là,
-- dans le fuseau de celui qui lit (le jour du comptable n'est pas celui du
-- serveur).
--
-- L'origine, et le moment où l'écriture entre au journal :
--   * contre_passation : l'écriture annule une autre (`reverses_id`) — à son
--     inscription ;
--   * forcee : le comptable l'a modifiée ou saisie (fait `ecriture.forcee` de
--     la piste d'audit) — à son inscription ;
--   * validee : l'écriture proposée par le Socle, prise en charge par le
--     cabinet — inscrite par un membre du cabinet, ou validée en supervision ;
--     au premier des deux.
-- Une écriture inscrite par la société et pas encore prise en charge n'est
-- pas au journal du cabinet. « par » ne nomme qu'un membre du cabinet.
--
-- Le périmètre et la garde sont ceux des exports (`app.export_mandats`) :
-- membre du cabinet, mandats actifs ; un dossier hors périmètre lève. Une
-- société n'est jamais le cabinet demandé : elle est refusée.
create or replace function public.journal_du_jour_lire(
  p_cabinet uuid, p_client uuid, p_jour date, p_fuseau text, p_locale text
)
returns table (
  client_tenant_id uuid,
  client_nom       text,
  ecriture_id      uuid,
  journal          text,
  journal_libelle  text,
  journal_rang     smallint,
  piece_id         uuid,
  ecriture_libelle text,
  ordinal          smallint,
  compte           text,
  compte_libelle   text,
  debit            numeric,
  credit           numeric,
  devise           text,
  origine          text,
  inscrite_le      timestamptz,
  heure            text,
  par              text,
  reverses_id      uuid,
  contre_passee_le timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mandats uuid[] := array(select app.export_mandats(p_cabinet, p_client));
begin
  -- Un fuseau inconnu lève ici (22023), avant toute lecture.
  perform now() at time zone p_fuseau;

  return query
    with prises as (
      select e.*,
             exists (select 1 from audit.event_log a
                      where a.object_table = 'ecritures' and a.object_id = e.id
                        and a.action = 'ecriture.forcee') as forcee,
             exists (select 1 from identity.memberships m
                      where m.tenant_id = p_cabinet and m.user_id = e.booked_by) as par_le_cabinet
        from socle.ecritures e
       where e.status = 'booked'
         and e.vis = 'partage'::app.vis_t
         and e.tenant_id = any(v_mandats)
    ),
    classees as (
      select x.*,
             case when x.reverses_id is not null then 'contre_passation'
                  when x.forcee then 'forcee'
                  else 'validee' end as v_origine,
             case when x.reverses_id is not null or x.forcee then x.booked_at
                  else least(case when x.par_le_cabinet then x.booked_at end,
                             case when x.review_outcome = 'valide' then x.reviewed_at end)
             end as v_inscrite_le
        from prises x
    ),
    du_jour as (
      select c.*,
             case when c.v_inscrite_le = c.booked_at then c.booked_by else c.reviewed_by end as v_par
        from classees c
       where c.v_inscrite_le is not null
         and (c.v_inscrite_le at time zone p_fuseau)::date = p_jour
    )
    select d.tenant_id,
           o.name,
           d.id,
           d.journal,
           coalesce(lj.value, lf.value, j.libelle, d.journal),
           j.rang,
           d.piece_id,
           d.libelle,
           l.ordinal,
           l.account_code,
           coalesce(
             (select pa.label from parametrage.accounts pa
               where pa.tenant_id = p_cabinet and pa.account_code = l.account_code),
             (select ra.label from ref.accounts ra
               where ra.pack_version_id = d.pack_version_id and ra.account_code = l.account_code),
             l.libelle),
           l.debit::numeric,
           l.credit::numeric,
           d.devise,
           d.v_origine,
           d.v_inscrite_le,
           to_char(d.v_inscrite_le at time zone p_fuseau, 'HH24:MI'),
           (select coalesce(nullif(btrim(concat_ws(' ', pr.prenom, pr.nom)), ''),
                            nullif(btrim(pr.display_name), ''),
                            u.email::text)
              from auth.users u
              left join identity.profiles pr on pr.user_id = u.id
             where u.id = d.v_par
               and exists (select 1 from identity.memberships m
                            where m.tenant_id = p_cabinet and m.user_id = u.id)),
           d.reverses_id,
           (select r.booked_at from socle.ecritures r
             where r.reverses_id = d.id and r.status = 'booked')
      from du_jour d
      join socle.ecriture_lignes l on l.ecriture_id = d.id
      join identity.organizations o on o.id = d.tenant_id
      left join ref.journals j on j.code = d.journal
      left join ref.labels lj on lj.ns = 'journal' and lj.key = d.journal and lj.locale = p_locale
      left join ref.labels lf on lf.ns = 'journal' and lf.key = d.journal and lf.locale = 'fr'
     order by j.rang nulls last, d.journal, d.v_inscrite_le, o.name, d.id, l.ordinal;
end $$;
revoke all on function public.journal_du_jour_lire(uuid, uuid, date, text, text) from public, anon;
grant execute on function public.journal_du_jour_lire(uuid, uuid, date, text, text) to authenticated;

-- --- 4. Journaliser un export du journal du jour -------------------------------------
-- Le numéro est calculé par l'appelant sous verrou (le contenu du fichier le
-- porte, et l'empreinte porte le contenu) ; la base vérifie qu'il suit le
-- dernier, et l'index unique tranche entre deux exports simultanés.
create or replace function public.journal_export_journaliser(
  p_cabinet uuid, p_client uuid, p_jour date, p_format text, p_numero integer,
  p_lignes integer, p_taille bigint, p_empreinte text, p_pack uuid,
  p_ecritures uuid[], p_contre_passees uuid[], p_ecart jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id      uuid;
  v_dernier integer;
begin
  if p_cabinet not in (select app.member_orgs()) then
    raise exception 'cabinet introuvable ou non autorise' using errcode = '42501';
  end if;
  -- Même garde que la lecture : un dossier hors mandat lève.
  perform 1 from app.export_mandats(p_cabinet, p_client);
  if p_format not in ('journal_csv', 'journal_xlsx') then
    raise exception 'ce format n''est pas un export du journal' using errcode = '22023';
  end if;

  select max(x.numero) into v_dernier
    from collab.exports x
   where x.tenant_id = p_cabinet
     and x.client_tenant_id is not distinct from p_client
     and x.du = p_jour and x.numero is not null;
  if p_numero <> coalesce(v_dernier, 0) + 1 then
    raise exception 'un autre export de ce journal vient d''etre produit : recommencez'
      using errcode = '40001';
  end if;

  insert into collab.exports
    (tenant_id, client_tenant_id, format, du, au, lignes, taille_octets, empreinte,
     pack_version_id, numero, ecritures, contre_passees)
  values (p_cabinet, p_client, p_format, p_jour, p_jour, p_lignes, p_taille, p_empreinte,
          p_pack, p_numero, p_ecritures, p_contre_passees)
  returning id into v_id;

  insert into audit.event_log
    (tenant_id, actor, action, object_schema, object_table, object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'export.genere', 'collab', 'exports', v_id, p_pack,
          jsonb_build_object('format', p_format, 'client', p_client, 'jour', p_jour,
                             'numero', p_numero, 'lignes', p_lignes, 'taille', p_taille,
                             'empreinte', p_empreinte, 'ecart', p_ecart));
  return v_id;
end $$;
revoke all on function public.journal_export_journaliser(uuid, uuid, date, text, integer, integer, bigint, text, uuid, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.journal_export_journaliser(uuid, uuid, date, text, integer, integer, bigint, text, uuid, uuid[], uuid[], jsonb) to authenticated;

commit;
