-- Une pièce qui n'imprime aucune devise est dans la devise du dossier.
--
-- ================================================================== POURQUOI
--
-- 5 novembre 2026, banc sans IA : 18 pièces du jeu d'ALGORIA (gabarit C surtout)
-- n'impriment ni « DT », ni « TND », ni « dinars ». Le champ de la devise se taisait, alors
-- que la chaîne de lecture, elle, retenait déjà la devise du dossier
-- (`deviseDeLaPiece`, source « dossier »). DÉCISION du dirigeant (5 novembre 2026) : « TND
-- par défaut quand aucune devise n'est imprimée » — c'est-à-dire la devise du dossier
-- (`identity.organizations`), rien n'est écrit en dur.
--
-- ================================================================== CE QUI CHANGE
--
-- `ref.concepts` gagne `defaut_du_dossier` : la donnée du DOSSIER qui vaut pour le champ
-- quand la pièce n'imprime rien (seule valeur admise : `devise`). Le concept `devise` (la
-- devise de la pièce) la porte ; pas `compte_devise`, ni les devises d'une ligne. Le moteur
-- (`packages/sudoku/src/lib.rs`) rend alors cette valeur au statut `deduit`, sans
-- référence de jeton : elle se voit pour ce qu'elle est, et une devise imprimée — ou deux,
-- contradictoires — l'emporte toujours.
--
-- R10 : défaut livré (`defaut_a_valider` comme le concept). REJEU (R11) : aucune horloge
-- n'écrit dans `ref`.

begin;

alter table ref.concepts add column if not exists defaut_du_dossier text
  check (defaut_du_dossier is null or defaut_du_dossier in ('devise'));

comment on column ref.concepts.defaut_du_dossier is
  'La donnée du dossier qui vaut pour un champ de ce concept quand la pièce n''imprime rien '
  '(`devise` : la devise du dossier). Rendue au statut `deduit`. Décision du dirigeant du '
  '5 novembre 2026.';

update ref.concepts set defaut_du_dossier = 'devise'
 where code = 'devise' and defaut_du_dossier is null;

create or replace view public.ref_concepts_v with (security_invoker = true) as
  select id, pack_version_id, code, libelle, expert, statut, valid_from, valid_to,
         porte_sur_une_partie, domaine, defaut_du_dossier
    from ref.concepts;

do $$
begin
  if not exists (select 1 from ref.concepts where code = 'devise' and defaut_du_dossier = 'devise')
  then
    raise exception 'le concept devise doit valoir la devise du dossier';
  end if;
end $$;

commit;
