-- La déclaration d'IS, l'acompte provisionnel, le certificat de retenue et l'avis
-- d'échéance d'assurance se prouvent par la somme qu'ils impriment.
--
-- ================================================================== POURQUOI
--
-- Suite de `20261208090000` (diagnostic des pièces non prouvées du 8 novembre 2026, cause
-- E : « type de pièce sans preuve exécutable »). Les invariants, vérifiés sur la vérité du
-- jeu d'ALGORIA :
--
--   déclaration d'IS       20 618,249 − 9 577,878 − 3 301,313 = 7 739,058       algoria-146
--   acompte provisionnel   6 185,475 − 1 210,717 = 4 974,758                     algoria-148
--   certificat de retenue  76 483,638 − 1 147,255 = 75 336,383                   algoria-152
--   avis d'assurance       1 777,849 + 32 + 163,903 = 1 973,752                  algoria-158
--
-- ================================================================== CE QUI CHANGE
--
-- Une somme par pièce, traduite de leur règle française (qui reste `a_traduire`, sous son
-- code). Les parties que la pièce n'imprime pas sont facultatives : présentes si leur
-- libellé est imprimé. Le total doit porter son libellé (le moteur, sans groupe de taux).
--
-- Essayé et laissé : la déclaration mensuelle (ses rubriques TFP et FOPROLOS s'impriment
-- sans libellé sur leur rangée, algoria-147) et le PV d'AGO (des montants dans la prose).
--
-- R4 : aucun taux écrit ici. R10 : défauts livrés (`defaut_a_valider`). REJEU (R11) : aucune
-- horloge n'écrit dans `ref`.

begin;

insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut, variante)
select g.id, v.code, v.regle, 'arithmetique', v.expression, 'defaut_a_valider', v.variante
  from ref.grilles g
  join (values
    ('declaration_annuelle_is_irpp', 'P90', 'Reste à payer = impôt dû − acomptes provisionnels − retenues subies − excédent antérieur', null,
     '{"op": "somme", "total": "reste_a_payer", "parties": ["is_du", "-acomptes_payes?", "-retenues_subies?", "-excedent_anterieur?"]}'::jsonb),
    ('acompte_provisionnel', 'P90', 'Net à payer = montant de l''acompte − retenues imputées − excédent imputé + pénalités', null,
     '{"op": "somme", "total": "net_a_payer", "parties": ["montant_brut_acompte", "-retenues_imputees?", "-excedent_impot_impute?", "penalites?"]}'::jsonb),
    ('certificat_retenue_source', 'P02a', 'P02 : net servi = brut − retenue − retenue TVA − CSS', null,
     '{"op": "somme", "total": "net_servi", "parties": ["montant_brut", "-montant_retenue", "-retenue_tva?", "-retenue_css?"]}'::jsonb),
    ('avis_echeance_assurance', 'P90', 'Prime TTC = prime nette + accessoires + taxes', null,
     '{"op": "somme", "total": "montant_ttc", "parties": ["prime_nette", "accessoires?", "taxes?"]}'::jsonb)
  ) as v(grille, code, regle, variante, expression) on v.grille = g.code
 where not exists (select 1 from ref.grille_preuves p where p.grille_id = g.id and p.code = v.code);

do $$
declare n integer;
begin
  select count(*) into n
    from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where (g.code, p.code) in (('declaration_annuelle_is_irpp', 'P90'), ('acompte_provisionnel', 'P90'),
                              ('certificat_retenue_source', 'P02a'), ('avis_echeance_assurance', 'P90'));
  if n <> 4 then
    raise exception 'preuves traduites : % sur 4 attendues', n;
  end if;
end $$;

commit;
