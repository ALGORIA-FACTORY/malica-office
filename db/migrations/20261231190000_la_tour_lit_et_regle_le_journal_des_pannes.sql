-- La tour lit et règle le journal des pannes de tous les dossiers.
--
-- Le dirigeant, 23 novembre 2026 : « sur la tour uniquement je dois voir ces problèmes
-- et ce journal, pour tous les utilisateurs ». « Ce qui n'a pas marché » quitte les
-- Réglages de l'application ; la tour le montre pour tous les dossiers, et c'est d'elle
-- que l'opérateur pose la marque « tout est réglé ».
--
-- La lecture était déjà ouverte à l'opérateur (`app.is_platform()` dans les politiques
-- de `audit.journal_client` et de `audit.journal_client_reglements`). Seule la marque
-- était réservée aux membres du dossier : la porte et la politique d'insertion
-- l'ouvrent à l'opérateur, signée de lui. Rien n'est effacé (R7).
--
-- _Gardé par_ apps/api/src/scan/une-panne-laisse-une-trace.test.ts.
--
-- REJEU (R11) : `create or replace`, `drop policy if exists`.

begin;

create or replace function public.journal_client_regler(p_tenant uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare v_at timestamptz;
begin
  if p_tenant is null
     or not (p_tenant in (select app.member_orgs()) or (select app.is_platform())) then
    raise exception 'refus.journal.droits' using errcode = '42501';
  end if;
  insert into audit.journal_client_reglements (tenant_id) values (p_tenant)
  returning at into v_at;
  return v_at;
end
$$;
alter function public.journal_client_regler(uuid) owner to portier;
revoke all on function public.journal_client_regler(uuid) from public, anon;
grant execute on function public.journal_client_regler(uuid) to authenticated;

comment on function public.journal_client_regler(uuid) is
  'Pose la marque « tout est réglé » du journal des pannes d''un dossier, par un membre du '
  'dossier ou par l''opérateur depuis la tour. N''efface rien : la tour ne montre plus que '
  'ce qui suit.';

drop policy if exists journal_client_reglements_ins on audit.journal_client_reglements;
create policy journal_client_reglements_ins on audit.journal_client_reglements
  for insert to authenticated
  with check ((tenant_id in (select app.member_orgs()) or (select app.is_platform()))
              and acteur = (select auth.uid()));

commit;
