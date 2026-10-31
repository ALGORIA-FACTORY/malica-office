-- La déclaration de TVA s'arrête au cabinet (3 novembre 2026), R10.
--
-- ========================================================== LE CONSTAT
--
-- Revue Codex de #145 : les lignes de la déclaration
-- (`ref.tva_declaration_lignes`) sont un défaut livré, INCERTAIN, sans
-- surcharge ni confirmation. R10 (AGENTS.md) : « un défaut se change sans
-- migration » et « un défaut se dit ». Une ligne fausse demandait une
-- migration pour tout le monde, et aucun écran ne savait dire qu'un
-- expert-comptable l'avait arrêtée.
--
-- ========================================================== LA RÈGLE
--
-- Le motif est celui des rôles de compte (`parametrage.role_bindings`, résolu
-- par `ref.compte_du_role` et `app.nature_des_comptes`) : ce que le DOSSIER a
-- arrêté, puis ce que le CABINET a arrêté, puis le défaut du pack. Ce qui
-- s'arrête ici est l'AFFECTATION : pour un sens (collectée, déductible) et une
-- nature (`ref.tva_natures`), la ligne de la déclaration qui la reçoit.
--
-- Deux écarts avec `role_bindings`, voulus :
--   - la table ne se modifie pas, elle s'AJOUTE (append-only, R7) : chaque
--     décision est datée (`valid_from`, `decide_le`), signée (`decide_par`),
--     et la plus récente l'emporte. Rendre au pack est une décision de plus
--     (`ligne_code` nul) ;
--   - seul le CABINET décide : l'expert pour tout le cabinet, et pour un
--     dossier quiconque au cabinet le supervise (`app.supervise_le_dossier`).
--     La PME lit, elle n'écrit jamais. On écrit par `app.tva_affecter`, qui
--     le vérifie et le dit (« refus.tva.affectation.droits ») avant la RLS.
--
-- CONFIRMER, c'est arrêter l'affectation telle qu'elle est : la décision
-- existe, l'origine n'est plus « pack », et la ligne n'est plus « à
-- confirmer » à l'écran. Une seule fonction résout tout, pour tous les écrans
-- et le PV : `app.declaration_tva`.
--
-- REJEU (R11) : les seules données de référence écrites ici sont les
-- libellés des natures (`ref.labels`), sans date.

begin;

-- --- 0. Le nom de chaque nature, pour l'écran qui l'arrête ----------------------------------------------

insert into ref.labels (ns, key, locale, value) values
  ('tva_nature', 'IMMOBILISATIONS', 'fr', 'Immobilisations'),
  ('tva_nature', 'IMMOBILISATIONS', 'en', 'Fixed assets'),
  ('tva_nature', 'IMMOBILISATIONS', 'ar', 'الأصول الثابتة'),
  ('tva_nature', 'BIENS_SERVICES', 'fr', 'Autres biens et services'),
  ('tva_nature', 'BIENS_SERVICES', 'en', 'Other goods and services'),
  ('tva_nature', 'BIENS_SERVICES', 'ar', 'السلع والخدمات الأخرى');

-- --- 1. Les décisions -----------------------------------------------------------------------------------

create table parametrage.tva_affectations (
  id              uuid primary key default gen_random_uuid(),
  -- Le cabinet qui décide.
  tenant_id       uuid not null references identity.organizations (id),
  portee          text not null check (portee in ('cabinet', 'dossier')),
  portee_id       uuid not null references identity.organizations (id),
  pack_version_id uuid not null references ref.jurisdiction_packs (id),
  sens            text not null check (sens in ('collectee', 'deductible')),
  nature          text not null references ref.tva_natures (code),
  -- Nul : rendu au défaut du pack.
  ligne_code      text check (ligne_code is null or ligne_code ~ '^[A-Z][A-Z0-9_]*$'),
  -- La déclaration à partir de laquelle la décision vaut.
  valid_from      date not null,
  motif           text,
  decide_par      uuid not null default auth.uid(),
  decide_le       timestamptz not null default now(),
  check (portee <> 'cabinet' or portee_id = tenant_id)
);

comment on table parametrage.tva_affectations is
  'R10 : la ligne de la déclaration de TVA qui reçoit un sens et une nature, arrêtée par le '
  'cabinet pour lui-même ou pour un dossier. Ajout seulement : la décision la plus récente '
  'l''emporte ; une ligne nulle rend au pack (3 novembre 2026).';

create index tva_affectations_tenant_idx
  on parametrage.tva_affectations (tenant_id, portee, portee_id);
create index tva_affectations_resolution_idx
  on parametrage.tva_affectations (portee, portee_id, pack_version_id, sens, nature,
                                   valid_from desc, decide_le desc);
create index tva_affectations_pack_idx on parametrage.tva_affectations (pack_version_id);
create index tva_affectations_nature_idx on parametrage.tva_affectations (nature);
create index tva_affectations_portee_id_idx on parametrage.tva_affectations (portee_id);

-- R7 : une décision ne se réécrit pas, elle se suit d'une autre.
create trigger tva_affectations_ajout_seulement
  before update or delete on parametrage.tva_affectations
  for each row execute function app.deny_mutation();

alter table parametrage.tva_affectations enable row level security;
alter table parametrage.tva_affectations force row level security;
revoke all on table parametrage.tva_affectations from public, anon;
grant select on table parametrage.tva_affectations to authenticated;
-- Le cabinet lit ses décisions ; le dossier lit celles qui le concernent.
create policy tva_affectations_sel on parametrage.tva_affectations
  for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or (portee = 'dossier' and portee_id in (select app.member_orgs()))
         or (portee = 'dossier' and portee_id in (select app.engaged_orgs()))
         or (select app.is_platform()));
-- Aucune politique d'écriture : on écrit par `app.tva_affecter`.

-- --- 2. La résolution : dossier, puis cabinet, puis pack ------------------------------------------------
--
-- Une ligne par (sens, nature) : la ligne qui la reçoit, d'où vient la
-- décision (dossier, cabinet, pack) et quand elle a été prise. Le cabinet est
-- celui qui tient le dossier (engagement actif). Une décision qui nomme une
-- ligne absente du pack à ce jour est ignorée : le défaut reprend. Réservée
-- aux dossiers de l'appelant.

create or replace function app.declaration_tva(p_dossier uuid, p_pack uuid, p_jour date)
returns table (sens text, nature text, ligne_code text, origine text, decide_le timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_dossier is null
     or p_dossier not in (select app.member_orgs() union select app.engaged_orgs()) then
    raise exception 'refus.tva.affectation.droits' using errcode = '42501';
  end if;
  return query
    with lignes as (
      select l.code, l.sens, l.nature, l.ordinal
        from ref.tva_declaration_lignes l
       where l.pack_version_id = p_pack
         and l.valid_from <= p_jour and (l.valid_to is null or l.valid_to >= p_jour)
    ),
    paires as (
      select s.sens, n.code as nature
        from (values ('collectee'), ('deductible')) s(sens)
        cross join ref.tva_natures n
    ),
    cabinet as (
      select g.cabinet_org_id as id
        from identity.engagements g
       where g.pme_org_id = p_dossier and g.status = 'actif'
       order by g.starts_on desc
       limit 1
    ),
    decisions as (
      select distinct on (a.portee, a.sens, a.nature)
             a.portee, a.sens, a.nature, a.ligne_code, a.decide_le
        from parametrage.tva_affectations a
       where a.pack_version_id = p_pack
         and a.valid_from <= p_jour
         and ((a.portee = 'dossier' and a.portee_id = p_dossier)
              or (a.portee = 'cabinet' and a.portee_id in (select c.id from cabinet c)))
       order by a.portee, a.sens, a.nature, a.valid_from desc, a.decide_le desc
    ),
    valides as (
      -- La ligne nommée doit exister, de ce sens, à ce jour ; une ligne nulle
      -- (rendu au pack) ne décide rien.
      select d.* from decisions d
       where exists (select 1 from lignes l where l.code = d.ligne_code and l.sens = d.sens)
    ),
    defaut as (
      select p.sens, p.nature,
             coalesce(
               (select l.code from lignes l where l.sens = p.sens and l.nature = p.nature
                 order by l.ordinal limit 1),
               (select l.code from lignes l where l.sens = p.sens and l.nature is null
                 order by l.ordinal limit 1)) as code
        from paires p
    )
    select p.sens, p.nature,
           coalesce(d.ligne_code, c.ligne_code, f.code),
           case when d.ligne_code is not null then 'dossier'
                when c.ligne_code is not null then 'cabinet'
                else 'pack' end,
           coalesce(d.decide_le, c.decide_le)
      from paires p
      left join valides d on d.portee = 'dossier' and d.sens = p.sens and d.nature = p.nature
      left join valides c on c.portee = 'cabinet' and c.sens = p.sens and c.nature = p.nature
      left join defaut f on f.sens = p.sens and f.nature = p.nature
     order by p.sens, p.nature;
end
$$;

revoke all on function app.declaration_tva(uuid, uuid, date) from public, anon;
grant execute on function app.declaration_tva(uuid, uuid, date) to authenticated;

comment on function app.declaration_tva(uuid, uuid, date) is
  'La ligne de la déclaration qui reçoit chaque (sens, nature) d''un dossier : ce que le dossier '
  'a arrêté, puis son cabinet, puis le pack (R10). La seule résolution : tous les écrans et le '
  'PV la lisent (3 novembre 2026).';

-- --- 3. Arrêter (ou confirmer) : le cabinet seulement -----------------------------------------------------
--
-- `p_affectations` : `[{sens, nature, ligne}]` ; `ligne` nulle rend au pack.
-- Pour tout le cabinet : l'expert-comptable. Pour un dossier : quiconque, au
-- cabinet qui le tient, le supervise. Chaque ligne nommée existe au pack, de
-- ce sens, à la date d'effet.

create or replace function app.tva_affecter(
  p_cabinet      uuid,
  p_portee       text,
  p_portee_id    uuid,
  p_pack         uuid,
  p_valid_from   date,
  p_affectations jsonb,
  p_motif        text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_portee = 'cabinet' then
    if p_portee_id is distinct from p_cabinet
       or not app.has_org_role(p_cabinet, array['expert']) then
      raise exception 'refus.tva.affectation.droits' using errcode = '42501';
    end if;
  elsif p_portee = 'dossier' then
    if p_cabinet not in (select app.member_orgs())
       or not app.supervise_le_dossier(p_portee_id)
       or not exists (select 1 from identity.engagements g
                       where g.cabinet_org_id = p_cabinet and g.pme_org_id = p_portee_id
                         and g.status = 'actif') then
      raise exception 'refus.tva.affectation.droits' using errcode = '42501';
    end if;
  else
    raise exception 'refus.tva.affectation.saisie' using errcode = '22023';
  end if;

  if p_affectations is null or jsonb_typeof(p_affectations) <> 'array'
     or jsonb_array_length(p_affectations) = 0
     or exists (
       select 1 from jsonb_array_elements(p_affectations) e
        where e ->> 'sens' is null or e ->> 'nature' is null
           or not exists (select 1 from ref.tva_natures n where n.code = e ->> 'nature')
           or (e ->> 'ligne' is not null and not exists (
                 select 1 from ref.tva_declaration_lignes l
                  where l.pack_version_id = p_pack and l.code = e ->> 'ligne'
                    and l.sens = e ->> 'sens'
                    and l.valid_from <= p_valid_from
                    and (l.valid_to is null or l.valid_to >= p_valid_from)))) then
    raise exception 'refus.tva.affectation.saisie' using errcode = '22023';
  end if;

  insert into parametrage.tva_affectations
    (tenant_id, portee, portee_id, pack_version_id, sens, nature, ligne_code, valid_from, motif)
  select p_cabinet, p_portee, p_portee_id, p_pack, e ->> 'sens', e ->> 'nature', e ->> 'ligne',
         p_valid_from, nullif(btrim(coalesce(p_motif, '')), '')
    from jsonb_array_elements(p_affectations) e;
  get diagnostics v_n = row_count;

  insert into audit.event_log (tenant_id, actor, action, object_schema, object_table,
                               object_id, pack_version_id, payload)
  values (p_cabinet, auth.uid(), 'tva.affectation', 'parametrage', 'tva_affectations',
          p_portee_id, p_pack,
          jsonb_build_object('portee', p_portee, 'valid_from', p_valid_from,
                             'affectations', p_affectations));
  return v_n;
end
$$;

revoke all on function app.tva_affecter(uuid, text, uuid, uuid, date, jsonb, text) from public, anon;
grant execute on function app.tva_affecter(uuid, text, uuid, uuid, date, jsonb, text) to authenticated;

commit;
