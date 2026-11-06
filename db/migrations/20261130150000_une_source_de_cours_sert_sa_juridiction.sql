-- ======================================================================
--  Une source de cours sert sa juridiction (5 novembre 2026).
--
--  Relevé sur staging : la règle de change d'un dossier tunisien proposait
--  la BCEAO comme source du cours qui fait foi. `ref.sources_de_cours` ne
--  disait pas qui chaque banque centrale sert ; l'écran offrait toutes les
--  sources, et la base acceptait d'en arrêter une étrangère au dossier.
--
--  `ref.sources_de_cours_juridictions` le dit : la BCT sert la Tunisie, la
--  BCEAO les huit États de l'UEMOA. L'API n'offre que les sources de la
--  juridiction du pack, et la base refuse d'arrêter une autre source
--  (`refus.change.source_hors_juridiction`), quelle que soit la porte qui
--  écrit `parametrage.regles_de_change` — un déclencheur, un seul endroit.
--
--  REJEU (R11) : aucune horloge n'écrit dans `ref`.
-- ======================================================================

begin;

create table ref.sources_de_cours_juridictions (
  source       text not null references ref.sources_de_cours (code),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  primary key (source, jurisdiction)
);

create index sources_de_cours_juridictions_jur_idx
  on ref.sources_de_cours_juridictions (jurisdiction);

comment on table ref.sources_de_cours_juridictions is
  'Les juridictions qu''une source de cours sert : la règle de change d''un dossier ne nomme '
  'qu''une source de sa juridiction (5 novembre 2026).';

alter table ref.sources_de_cours_juridictions enable row level security;
alter table ref.sources_de_cours_juridictions force row level security;
revoke all on table ref.sources_de_cours_juridictions from public, anon;
grant select on table ref.sources_de_cours_juridictions to authenticated;
create policy ref_sources_de_cours_juridictions_sel on ref.sources_de_cours_juridictions
  for select to authenticated using (true);

-- La BCEAO émet le franc CFA de l'UEMOA : Bénin, Burkina Faso, Côte d'Ivoire,
-- Guinée-Bissau, Mali, Niger, Sénégal, Togo.
insert into ref.sources_de_cours_juridictions (source, jurisdiction) values
  ('BCT', 'TN'),
  ('BCEAO', 'BJ'), ('BCEAO', 'BF'), ('BCEAO', 'CI'), ('BCEAO', 'GW'),
  ('BCEAO', 'ML'), ('BCEAO', 'NE'), ('BCEAO', 'SN'), ('BCEAO', 'TG');

-- La base refuse d'arrêter une source étrangère à la juridiction du pack.
create function parametrage.source_de_la_juridiction() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code = 'change.source' and new.valeur is not null and not exists (
       select 1
         from ref.jurisdiction_packs j
         join ref.sources_de_cours_juridictions s on s.jurisdiction = j.jurisdiction
        where j.id = new.pack_version_id and s.source = new.valeur) then
    raise exception 'refus.change.source_hors_juridiction' using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger regles_de_change_source_de_la_juridiction
  before insert on parametrage.regles_de_change
  for each row execute function parametrage.source_de_la_juridiction();

commit;
