-- ======================================================================
--  La borne des pannes tient quand elles arrivent ensemble (6 novembre 2026).
--
--  `public.journal_hors_dossier_consigner` (20261202120000) compte les pannes
--  de la personne sur dix minutes, puis en inscrit une. Sans verrou, deux
--  appels simultanés comptent tous deux moins de vingt et inscrivent tous
--  deux : soixante appels en parallèle en écrivaient 22 ou 23 (relevé par la
--  vérification indépendante du lot E,
--  `apps/api/src/scan/la-borne-des-pannes-tient-en-parallele.test.ts`).
--
--  Un verrou de transaction par personne (`pg_advisory_xact_lock`) range ses
--  appels l'un après l'autre : le compte voit les inscriptions précédentes.
--  Les appels de deux personnes différentes ne s'attendent pas.
--
--  Le reste du corps est inchangé ; `create or replace` garde le propriétaire
--  (`portier`) et les droits.
--
--  REJEU (R11) : aucune horloge n'écrit dans `ref`.
-- ======================================================================

begin;

create or replace function public.journal_hors_dossier_consigner(
  p_ou text,
  p_code text,
  p_detail text,
  p_version text default null,
  p_plateforme text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moi uuid := app.current_uid();
begin
  if v_moi is null then
    return false;
  end if;
  -- One person's calls go one after the other: the count sees the rows just written.
  perform pg_advisory_xact_lock(hashtextextended('journal_hors_dossier:' || v_moi::text, 0));
  if (select count(*) from app.signalements s
       where s.user_id = v_moi and s.origine = 'panne'
         and s.cree_le > now() - interval '10 minutes') >= 20 then
    return false;
  end if;
  insert into app.signalements (user_id, tenant_id, version_client, appareil, ou, message, origine)
  values (
    v_moi,
    null,
    coalesce(nullif(left(btrim(coalesce(p_version, '')), 120), ''), 'inconnue'),
    left(p_plateforme, 300),
    left(coalesce(nullif(btrim(coalesce(p_ou, '')), ''), 'inconnu'), 200),
    left(
      coalesce(nullif(btrim(coalesce(p_code, '')), ''), 'sans code')
        || coalesce(' : ' || nullif(left(btrim(p_detail), 500), ''), ''),
      2000),
    'panne'
  );
  return true;
end
$$;

commit;
