-- Le devis (et la facture pro forma) se prouve par ses totaux.
--
-- ================================================================== POURQUOI
--
-- Banc sans IA du 4 novembre 2026 : les trois devis du banc restaient muets (0 juste, 43
-- silences). Leur preuve P01 (« Somme des lignes = total HT ; HT + TVA = TTC ») était
-- `a_traduire` : le moteur ne lisait aucun de leurs montants. La grille n'a pas de champ
-- de montant de ligne ; les totaux, eux, se traduisent avec les opérations du moteur :
--
--   P01b  total_ttc = total_ht + montant_tva        (somme)
--   P01c  montant_tva = total_ht × un taux du barème (taux)
--
-- Les deux ensemble : un devis à un seul taux se prouve, ses trois totaux justes ou tus.
-- Un devis à plusieurs taux ne se prouve pas (le taux unique ne ferme pas) : il reste muet,
-- jamais faux. P01 garde sa règle entière, `a_traduire`, pour la somme des lignes.
--
-- R10 : défaut livré (`defaut_a_valider`). REJEU (R11) : aucune horloge n'écrit dans `ref`.

begin;

insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut, variante)
select g.id, v.code, v.regle, 'arithmetique', v.expression, 'defaut_a_valider', null
  from ref.grilles g
  cross join (values
    ('P01b', 'Partie de P01 : HT + TVA = TTC',
     '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva"]}'::jsonb),
    ('P01c', 'Partie de P01 : TVA = HT × taux du barème (tolérance d''arrondi au millime)',
     '{"op": "taux", "montant": "montant_tva", "base": "total_ht", "bareme": "tva"}'::jsonb)
  ) as v(code, regle, expression)
 where g.code = 'devis_proforma'
   and not exists (select 1 from ref.grille_preuves p where p.grille_id = g.id and p.code = v.code);

commit;
