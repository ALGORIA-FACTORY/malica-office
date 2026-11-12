-- L'ancienne comptabilité garde son archive (recette du 11 novembre 2026, 1.6).
--
-- CE QUI ÉTAIT FAUX. À la révocation, le mandat passe à « terminé » et
-- `app.engaged_orgs()` cesse de rendre la société : toute lecture de
-- l'ancienne comptabilité tombe d'un coup, y compris celle des pièces qu'elle a
-- elle-même inscrites. `capture.dossier` répondait 404 et la société quittait
-- sa Bibliothèque. Règle 10 du 16 octobre 2026 : la comptabilité qui a
-- travaillé garde son archive, en LECTURE SEULE, sur la période traitée.
--
-- CE QUE POSE CETTE MIGRATION.
--
--   1. `identity.mandats_clos` : le fait « ce mandat a pris fin tel jour »,
--      en ajout seul. La ligne d'`identity.engagements` est réutilisée quand la
--      comptabilité repropose (`mandat_proposer`) : elle perd alors sa date de
--      fin. La borne de l'archive ne peut donc pas s'y lire. Le fait est posé
--      par déclencheur, quel que soit le chemin qui termine le mandat.
--
--   2. La borne : une écriture est « de l'archive » quand la comptabilité l'a
--      prise en charge (`socle.prises_en_charge`, gelée à l'inscription) AU
--      PLUS TARD à la fin de son mandat. La contre-passation qu'une
--      comptabilité suivante inscrit ensuite entre au journal de l'ancienne
--      (`app.geler_la_prise_en_charge`) : elle est postérieure, elle ne se lit
--      pas. Une pièce est de l'archive quand une de ses écritures l'est ; ce
--      qui la décrit (lecture, citations, précisions) se lit jusqu'à la borne.
--
--   3. Des politiques de LECTURE en plus, une par table, permissives : elles
--      s'ajoutent aux politiques existantes sans en réécrire une seule. Aucune
--      politique d'écriture n'est touchée, et `app.engaged_orgs()` non plus :
--      tout ce qui écrit continue d'exiger un mandat en vigueur (R6).
--
--   4. `app.piece_lisible` n'est PAS élargie : des portes s'en servent pour
--      autoriser un geste. L'archive a ses propres fonctions.
--
-- REJEU (R11) : `if not exists`, `create or replace`, `drop policy if exists`.
-- Aucune donnée de référence n'est écrite.

begin;

-- --- 1. Le fait : un mandat a pris fin ------------------------------------------------
-- `tenant_id` est la COMPTABILITÉ : c'est son archive.
create table if not exists identity.mandats_clos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.organizations(id) on delete cascade,
  pme_org_id    uuid not null references identity.organizations(id) on delete cascade,
  engagement_id uuid not null references identity.engagements(id) on delete cascade,
  debut         date not null,
  fin           date not null,
  clos_le       timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (engagement_id, clos_le)
);
create index if not exists mandats_clos_tenant_pme_idx
  on identity.mandats_clos (tenant_id, pme_org_id, clos_le);
create index if not exists mandats_clos_pme_idx
  on identity.mandats_clos (pme_org_id);

alter table identity.mandats_clos enable row level security;
alter table identity.mandats_clos force row level security;
revoke all on table identity.mandats_clos from public, anon, authenticated;
grant select on table identity.mandats_clos to authenticated;

drop policy if exists mandats_clos_sel on identity.mandats_clos;
create policy mandats_clos_sel on identity.mandats_clos for select to authenticated
  using (tenant_id in (select app.member_orgs())
         or pme_org_id in (select app.member_orgs())
         or (select app.is_platform()));

-- Le relecteur de nuit (compte de service) n'y écrit ni n'y lit : la fin
-- d'un mandat n'est pas une pièce (`20261118100000_le_relecteur_de_nuit`).
drop trigger if exists service_hors_perimetre on identity.mandats_clos;
create trigger service_hors_perimetre before insert or update or delete on identity.mandats_clos
  for each statement execute function app.service_hors_perimetre();
drop policy if exists service_hors_perimetre on identity.mandats_clos;
create policy service_hors_perimetre on identity.mandats_clos as restrictive for select
  to authenticated using ((select app.service()) is null);

drop trigger if exists mandats_clos_no_upd on identity.mandats_clos;
create trigger mandats_clos_no_upd before update or delete on identity.mandats_clos
  for each row execute function app.deny_mutation();

-- Le déclencheur : tout chemin qui termine un mandat qui a été en vigueur.
create or replace function app.consigner_la_fin_du_mandat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'termine' and old.status in ('actif', 'suspendu') then
    insert into identity.mandats_clos (tenant_id, pme_org_id, engagement_id, debut, fin, clos_le)
    values (new.cabinet_org_id, new.pme_org_id, new.id, old.starts_on,
            coalesce(new.ends_on, current_date), now())
    on conflict (engagement_id, clos_le) do nothing;
  end if;
  return null;
end
$$;
revoke all on function app.consigner_la_fin_du_mandat() from public;

drop trigger if exists consigner_la_fin_du_mandat on identity.engagements;
create trigger consigner_la_fin_du_mandat after update of status on identity.engagements
  for each row execute function app.consigner_la_fin_du_mandat();

-- Les mandats déjà révoqués : leur fin est au journal d'audit de la
-- comptabilité (`engagement.revoque`, posé par `mandat_revoquer`).
insert into identity.mandats_clos (tenant_id, pme_org_id, engagement_id, debut, fin, clos_le)
select e.cabinet_org_id, e.pme_org_id, e.id,
       least(e.starts_on, (a.at at time zone 'UTC')::date), (a.at at time zone 'UTC')::date, a.at
  from audit.event_log a
  join identity.engagements e on e.id = a.object_id and e.cabinet_org_id = a.tenant_id
 where a.action = 'engagement.revoque'
   and a.object_schema = 'identity' and a.object_table = 'engagements'
on conflict (engagement_id, clos_le) do nothing;

-- --- 2. Qui lit quelle archive, et jusqu'à quand ---------------------------------------
-- Les mêmes personnes que pendant le mandat (`app.engaged_orgs`) : l'expert, et
-- le collaborateur affecté au dossier. Jamais un compte de service. Une
-- comptabilité qui n'a rien pris en charge n'a pas d'archive.
create or replace function app.mes_archives()
returns table (cabinet uuid, pme uuid, clos_le timestamptz, fin date)
language sql
stable
security definer
set search_path = ''
as $$
  select c.tenant_id, c.pme_org_id, max(c.clos_le), max(c.fin)
    from identity.mandats_clos c
   where c.tenant_id in (select app.member_orgs())
     and (select app.service()) is null
     and (app.has_org_role(c.tenant_id, array['expert'])
          or exists (select 1 from collab.assignments a
                      where a.cabinet_tenant_id = c.tenant_id
                        and a.client_tenant_id = c.pme_org_id
                        and a.collaborator_id = auth.uid()
                        and a.active))
     and exists (select 1 from socle.prises_en_charge pc
                  where pc.tenant_id = c.tenant_id
                    and pc.client_tenant_id = c.pme_org_id
                    and pc.prise_le <= c.clos_le)
   group by c.tenant_id, c.pme_org_id
$$;
revoke all on function app.mes_archives() from public;
grant execute on function app.mes_archives() to authenticated;

create or replace function app.archive_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.pme from app.mes_archives() a
$$;
revoke all on function app.archive_orgs() from public;
grant execute on function app.archive_orgs() to authenticated;

-- L'écriture que ma comptabilité a prise en charge avant la fin de son mandat.
create or replace function app.ecriture_en_archive(p_ecriture uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from socle.prises_en_charge pc
      join app.mes_archives() a on a.cabinet = pc.tenant_id and a.pme = pc.client_tenant_id
     where pc.ecriture_id = p_ecriture
       and pc.prise_le <= a.clos_le)
$$;
revoke all on function app.ecriture_en_archive(uuid) from public;
grant execute on function app.ecriture_en_archive(uuid) to authenticated;

-- La borne de lecture d'une pièce : la fin du mandat pendant lequel ma
-- comptabilité a pris en charge une de ses écritures. `null` : pas d'archive.
create or replace function app.borne_d_archive(p_piece uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(a.clos_le)
    from socle.ecritures e
    join socle.prises_en_charge pc on pc.ecriture_id = e.id
    join app.mes_archives() a on a.cabinet = pc.tenant_id and a.pme = pc.client_tenant_id
   where e.piece_id = p_piece
     and pc.prise_le <= a.clos_le
$$;
revoke all on function app.borne_d_archive(uuid) from public;
grant execute on function app.borne_d_archive(uuid) to authenticated;

-- Ce que l'écran doit savoir pour se dire « en lecture seule » : rien quand la
-- comptabilité est (de nouveau) mandatée, le jour de la fin sinon.
create or replace function public.piece_archive_lire(p_piece uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('mandatClosLe', a.fin)
    from capture.pieces p
    join app.mes_archives() a on a.pme = p.tenant_id
   where p.id = p_piece
     and p.tenant_id not in (select app.engaged_orgs())
     and app.borne_d_archive(p.id) is not null
   order by a.clos_le desc
   limit 1
$$;
revoke all on function public.piece_archive_lire(uuid) from public;
grant execute on function public.piece_archive_lire(uuid) to authenticated;

-- --- 3. La lecture s'élargit, table par table ------------------------------------------
-- `tenant_id in (select app.archive_orgs())` d'abord : un SubPlan haché, vide
-- pour qui n'a aucune archive — la borne par ligne ne se calcule alors jamais.
drop policy if exists pieces_sel_archive on capture.pieces;
create policy pieces_sel_archive on capture.pieces for select to authenticated
  using (tenant_id in (select app.archive_orgs())
         and app.borne_d_archive(id) is not null);

do $$
declare
  t text;
begin
  -- Ce qui décrit la pièce, tel qu'il était à la fin du mandat.
  foreach t in array array['extractions', 'citations', 'token_plan', 'analyses'] loop
    execute format('drop policy if exists %I on capture.%I', t || '_sel_archive', t);
    execute format(
      'create policy %I on capture.%I for select to authenticated
         using (tenant_id in (select app.archive_orgs())
                and created_at <= app.borne_d_archive(piece_id))',
      t || '_sel_archive', t);
  end loop;
end
$$;

drop policy if exists precisions_sel_archive on capture.precisions;
create policy precisions_sel_archive on capture.precisions for select to authenticated
  using (tenant_id in (select app.archive_orgs())
         and decided_at <= app.borne_d_archive(piece_id));

drop policy if exists ecritures_sel_archive on socle.ecritures;
create policy ecritures_sel_archive on socle.ecritures for select to authenticated
  using (tenant_id in (select app.archive_orgs())
         and app.ecriture_en_archive(id));

drop policy if exists ecriture_lignes_sel_archive on socle.ecriture_lignes;
create policy ecriture_lignes_sel_archive on socle.ecriture_lignes for select to authenticated
  using (tenant_id in (select app.archive_orgs())
         and app.ecriture_en_archive(ecriture_id));

-- Le nom et le matricule de la société dont on garde l'archive.
drop policy if exists organizations_sel_archive on identity.organizations;
create policy organizations_sel_archive on identity.organizations for select to authenticated
  using (id in (select app.archive_orgs()));

commit;
