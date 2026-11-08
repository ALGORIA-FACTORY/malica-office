-- Le cachet se voit sans modèle.
--
-- ================================================================== POURQUOI
--
-- Banc sans IA du 4 novembre 2026 : sur le jeu d'ALGORIA, 58 cachets d'émetteur imprimés,
-- 0 lu. Le champ (`booleen`, expert `presence`) ne disait que son libellé vu (« signalé ») :
-- rien ne regardait l'encre. Le second lecteur relève désormais les cachets sans modèle
-- (`infra/ocr/service.py`, `_cachets` : une empreinte d'encre de couleur, compacte et
-- creuse). Mesure sur les 161 pièces du jeu : 41 cachets trouvés sur 81, aucun sur les 80
-- pièces sans cachet.
--
-- ================================================================== CE QUI CHANGE
--
-- `ref.grille_champs.marque` nomme la marque qu'un champ de présence attend (« cachet »).
-- Le moteur ne l'affirme que si la grille n'a qu'UN champ de cette marque et que la page
-- en porte une : un cachet ne dit pas de qui il est quand deux champs l'attendent.
-- Posée sur le cachet de l'émetteur de la facture seulement : les autres champs du
-- concept `signature_cachet` mêlent cachet et signature (« Signature et cachet ») ou
-- disent la marque d'une autre partie ; ils attendent leur classement.
--
-- R10 : défaut livré. REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

alter table ref.grille_champs add column if not exists marque text
  check (marque is null or marque in ('cachet'));

update ref.grille_champs gc
   set marque = 'cachet'
  from ref.grilles g
 where g.id = gc.grille_id and g.code = 'facture' and gc.code = 'cachet_emetteur';

-- Ajoutée À LA FIN : `create or replace view` refuse tout autre changement.
create or replace view public.ref_grille_champs_v with (security_invoker = true) as
  select id, grille_id, parcelle, code, libelle, type, obligatoire, condition, reperes_fr,
         reperes_ar, format_code, groupe, fondement, source_fondement, statut, concept_id, role,
         repetee, marque
    from ref.grille_champs;

revoke all on table public.ref_grille_champs_v from public, anon, service_role;
grant select on table public.ref_grille_champs_v to authenticated;

do $$
begin
  if (select count(*) from ref.grille_champs gc join ref.grilles g on g.id = gc.grille_id
       where g.code = 'facture' and gc.marque = 'cachet') <> (select count(*) from ref.grilles where code = 'facture') then
    raise exception 'grille facture : un champ « cachet » par grille attendu';
  end if;
end $$;

commit;
