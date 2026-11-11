-- Deux totaux de plus se prouvent : l'avis d'échéance d'assurance et le relevé bancaire.
--
-- ================================================================== POURQUOI
--
-- Lot 1 du chantier E (docs « invariants par type », 10 novembre 2026, validé par le
-- dirigeant). Le diagnostic du 8 novembre compte 41 pièces sans preuve exécutable :
-- leur règle est écrite en clair dans `ref.grille_preuves` (statut `a_traduire`) mais
-- pas dans le langage du moteur, donc le moteur se tait.
--
-- Deux de ces règles se traduisent avec les opérateurs que le moteur a déjà, sans
-- toucher au solveur :
--
--   avis_echeance_assurance P01 : montant TTC = prime nette + accessoires + taxes ;
--   releve_bancaire         P01 : solde initial + total des crédits − total des
--                                 débits = solde final.
--
-- Ce que cela ne fait pas : le timbre d'un avis d'assurance n'a pas de champ dans la
-- grille (le diagnostic le cite pour « dirigeant 50/26 ») ; un solde débiteur imprimé
-- positif avec son sens à part ne referme pas l'égalité signée — la pièce reste alors
-- sans preuve, jamais faussement prouvée.
--
-- R4 : aucun taux ni seuil ici. R10 : livrées en `defaut_a_valider`. REJEU (R11) :
-- aucune horloge n'écrit dans `ref`.

begin;

update ref.grille_preuves p
   set expression = '{"op": "somme", "total": "montant_ttc", "parties": ["prime_nette", "accessoires?", "taxes?"]}'::jsonb,
       statut = 'defaut_a_valider'
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'avis_echeance_assurance' and p.code = 'P01'
   and p.expression is null;

update ref.grille_preuves p
   set expression = '{"op": "somme", "total": "solde_final", "parties": ["solde_initial", "total_credits", "-total_debits"]}'::jsonb,
       statut = 'defaut_a_valider'
  from ref.grilles g
 where g.id = p.grille_id and g.code = 'releve_bancaire' and p.code = 'P01'
   and p.expression is null;

do $$
declare n integer;
begin
  select count(*) into n from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where (g.code, p.code) in (('avis_echeance_assurance', 'P01'), ('releve_bancaire', 'P01'))
     and p.expression ->> 'op' = 'somme';
  if n <> 2 * (select count(*) from ref.grilles where code = 'avis_echeance_assurance') then
    raise exception 'lot 1 : % preuve(s) de somme posée(s), 2 par jeu de grilles attendues', n;
  end if;
end $$;

commit;
