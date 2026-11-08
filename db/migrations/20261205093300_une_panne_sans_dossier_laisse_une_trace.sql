-- Une panne vue hors de tout dossier laisse, elle aussi, sa trace en base.
--
-- ================================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
--
-- 6 novembre 2026, règle du dirigeant : « aucune erreur technique à l'écran ;
-- l'écran dit une phrase humaine, et le détail va au journal, EN BASE ».
--
-- Le journal des pannes (`audit.journal_client`, 20261013160000) est sous RLS
-- du dossier : il faut un dossier pour y écrire. Or des écrans échouent sans
-- dossier ouvert — accepter une invitation, ouvrir le dossier d'un client
-- depuis le cabinet, la tour. Leur panne n'allait nulle part : l'écran se
-- taisait (règle tenue), et le journal aussi (règle rompue).
--
-- ================================================================ CE QUE LA PORTE FAIT
--
-- Elle inscrit, dans `app.signalements` (que seul l'opérateur relit), une
-- ligne d'origine `panne` : QUI (la session, jamais ce que le client prétend),
-- OÙ (l'endroit du code), le CODE (le nom de l'erreur, un statut HTTP) et un
-- DÉTAIL coupé à 500 caractères. Le client l'expurge avant l'envoi
-- (`apps/web/src/lib/rapport-plantage.ts`, `expurger`) ; la porte ne s'y fie
-- pas et borne quand même.
--
-- Elle est BORNÉE : vingt pannes par personne et par dix minutes. Au-delà,
-- elle n'écrit rien et le dit (`false`) — sans lever : signaler une panne ne
-- doit jamais en créer une seconde, et une boucle de rendu ne doit pas
-- remplir la table.
--
-- REJEU (R11) : `drop … if exists`, `create or replace`.

begin;

alter table app.signalements
  drop constraint if exists signalements_origine_check;

alter table app.signalements
  add constraint signalements_origine_check
  check (origine in ('personne', 'plantage', 'panne'));

comment on column app.signalements.origine is
  'personne : un geste volontaire depuis l''application. '
  'plantage : la frontière d''erreur a rapporté toute seule, texte expurgé '
  'côté client (apps/web/src/lib/rapport-plantage.ts). '
  'panne : un écran a dit une phrase humaine à la place d''une erreur, hors '
  'de tout dossier ; le détail expurgé est ici (public.journal_hors_dossier_consigner).';

-- La borne se compte sur les lignes de la personne : la porte, sous le
-- portier, relit les SIENNES — et seulement elles. L'auteur, lui, ne relit
-- toujours rien (la politique de lecture des clients reste celle de
-- l'opérateur).
drop policy if exists app_signalements_sel_portier on app.signalements;
create policy app_signalements_sel_portier on app.signalements
  for select to portier
  using (user_id = (select app.current_uid()));

create index if not exists signalements_user_origine_idx
  on app.signalements (user_id, origine, cree_le desc);

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

alter function public.journal_hors_dossier_consigner(text, text, text, text, text) owner to portier;
revoke all on function public.journal_hors_dossier_consigner(text, text, text, text, text)
  from public, anon;
grant execute on function public.journal_hors_dossier_consigner(text, text, text, text, text)
  to authenticated;

comment on function public.journal_hors_dossier_consigner(text, text, text, text, text) is
  'Inscrit une panne vue hors de tout dossier (origine panne de app.signalements) : '
  'qui, où, le code, un détail coupé à 500 caractères. Bornée à vingt par personne '
  'et par dix minutes ; au-delà, n''écrit rien et rend false.';

commit;
