-- Un jugement revérifié sans changer le dit, à côté de lui.
--
-- Revue de la PR 143 : une pièce jugée avant le marqueur de règles
-- (`capture.analyses.regles` NUL) que les règles du jour jugent à
-- l'identique ne recevait rien — le rejeu n'ajoute une analyse que si le
-- jugement change. Elle restait donc « périmée », et chaque ouverture, la
-- file du cabinet comprise, refaisait tout le jugement pour rien.
--
-- L'analyse ne se met pas à jour (R7). Le constat s'inscrit à côté : « cette
-- analyse a été revérifiée sous telles règles, et elle tient ». Un jugement
-- est à jour quand sa dernière analyse porte les règles du jour, ou qu'une
-- vérification sous ces règles la nomme.

begin;

create table if not exists capture.analyses_verifiees (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identity.organizations(id) on delete cascade,
  piece_id    uuid not null references capture.pieces(id) on delete cascade,
  analyse_id  uuid not null references capture.analyses(id) on delete cascade,
  -- La version des règles sous lesquelles l'analyse a été rejouée à l'identique
  -- (`REGLES_DU_JUGEMENT`, apps/api/src/scan/analyse.ts).
  regles      text not null,
  verifie_par uuid default auth.uid(),
  verifie_le  timestamptz not null default now()
);

-- Une vérification par analyse et par version : deux ouvertures simultanées
-- n'en écrivent qu'une (`on conflict do nothing`). L'index mène par tenant (R6).
create unique index if not exists analyses_verifiees_une_par_regles_idx
  on capture.analyses_verifiees (tenant_id, analyse_id, regles);
create index if not exists analyses_verifiees_analyse_id_fk_idx
  on capture.analyses_verifiees (analyse_id);
create index if not exists analyses_verifiees_piece_id_fk_idx
  on capture.analyses_verifiees (piece_id);

select app.enable_tenant_rls('capture', 'analyses_verifiees', false, true);
revoke all on table capture.analyses_verifiees from public, anon, service_role;
-- Ajout seul : le helper ouvre aussi la mise à jour et l'effacement, qu'on retire.
revoke update, delete on table capture.analyses_verifiees from authenticated;
grant select, insert on table capture.analyses_verifiees to authenticated;

-- Comme l'analyse : celui qui supervise le dossier pose aussi le constat.
drop policy if exists capture_analyses_verifiees_ins_superviseur on capture.analyses_verifiees;
create policy capture_analyses_verifiees_ins_superviseur on capture.analyses_verifiees
  for insert to authenticated
  with check (app.supervise_le_dossier(tenant_id));

-- Un constat ne se modifie pas ; il part seulement avec sa pièce.
drop trigger if exists capture_analyses_verifiees_no_upd on capture.analyses_verifiees;
create trigger capture_analyses_verifiees_no_upd
  before update or delete on capture.analyses_verifiees
  for each row execute function app.deny_mutation_hors_effacement_de_piece();

-- Rien de nouveau ne s'écrit sur une version gelée (`20261029190000`).
drop trigger if exists pas_de_geste_sur_une_version_precedente on capture.analyses_verifiees;
create trigger pas_de_geste_sur_une_version_precedente
  before insert on capture.analyses_verifiees
  for each row execute function app.pas_de_geste_sur_une_version_precedente();

comment on table capture.analyses_verifiees is
  'Une analyse rejouée sous des règles plus récentes, à l''identique : le constat, '
  'à côté d''elle (R7). Elle est à jour si elle porte les règles du jour ou si un '
  'constat sous ces règles la nomme (`scan/rejeu.ts`).';

commit;
