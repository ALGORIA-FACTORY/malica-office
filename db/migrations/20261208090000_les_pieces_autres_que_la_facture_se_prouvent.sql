-- Les pièces autres que la facture se prouvent par les relations qu'elles impriment.
--
-- ================================================================== POURQUOI
--
-- Banc sans IA du 8 novembre 2026 (411 pièces) : 283 pièces prouvées, dont 276 factures sur
-- 350. Les 61 autres pièces (bons de livraison, tickets, reçus, relevés, bulletins,
-- déclarations…) ne l'étaient que 7 fois : 44 d'entre elles finissaient sur « aucune
-- preuve arithmétique exécutable ». Leurs grilles écrivaient la preuve en français
-- (`a_traduire`) ; le moteur ne l'exécutait pas. Même avec 100 % des factures, le banc
-- plafonnait à 84 %.
--
-- Ce que ces pièces impriment, relevé sur le banc :
--
--   relevé bancaire  138 862,485 + 115 115,955 − 54 928,899 = 199 049,541 (algoria-136)
--   bulletin de paie 4 063 + 89 + 48 = 4 200 (brut) ; 4 200 − 385,560 − 909,032 = 2 905,408
--   quittance        3 200 + 608 + 207 − 320 = 3 695 (algoria-133)
--   BL, ticket, reçu, bon de commande tirés d'un logiciel de facturation (jeu du
--   dirigeant) : « Total HT 2136,000 · TVA 19 % 405,840 · Total TTC 2541,840 », et le
--   montant en toutes lettres (C-03, C-04, C-18, 50/16…).
--
-- ================================================================== CE QUI CHANGE
--
-- Les règles se traduisent avec les opérations que le moteur exécute déjà (`somme`,
-- `taux`, `lettres`) ; aucune ligne de code. La règle française d'origine reste
-- `a_traduire` : la traduction est une preuve de plus, sous un code nouveau (comme le devis,
-- `20261201091000`).
--
--   releve_bancaire  P01a  solde_final = solde_initial + total_credits − total_debits
--   bulletin_paie    P01a  salaire_brut = salaire_base + primes et indemnités imprimées
--                          − absences
--                    P03a  net_a_payer = salaire_brut − CNSS − IRPP − autres retenues
--                          imprimées
--   recu_quittance   P01a  montant_recu = loyer + TVA + charges + timbre − retenue
--                          (variante « loyer ») ;
--                    T01–T03 les totaux d'une pièce de facturation (variante « totaux »)
--   bon_livraison, ticket_caisse, bon_commande
--                    T01  total_ttc = total_ht + TVA
--                    T02  TVA = total_ht × un taux du barème (taux unique)
--                    T03  le montant en lettres égale le total TTC
--   declaration_mensuelle  P01b, P01c : la base et la TVA à 13 % et à 7 % sont facultatives
--                    (une déclaration sans ces taux ne se prouvait jamais : le moteur
--                    cherchait leurs montants sur les jetons d'autres champs).
--
-- Les champs nouveaux (total HT, TVA, total TTC, montant en lettres) reprennent les
-- concepts et les repères de la facture ; ils sont facultatifs. Une pièce qui n'imprime
-- aucun montant (un BL non valorisé) ne se prouve toujours pas : elle reste muette, jamais
-- fausse. Un taux unique ne ferme pas une pièce à plusieurs taux : muette aussi.
--
-- R4 : aucun taux écrit ici, la TVA vient du barème du pack. R10 : défauts livrés
-- (`defaut_a_valider`), que l'expertise corrige. REJEU (R11) : aucune horloge n'écrit dans
-- `ref`.

begin;

-- ---------------------------------------------------------------- les champs des totaux
insert into ref.grille_champs (grille_id, parcelle, code, libelle, type, obligatoire, condition,
                               reperes_fr, reperes_ar, format_code, groupe, fondement,
                               source_fondement, statut, concept_id, role, repetee)
select g.id, v.parcelle, v.code, s.libelle, s.type, 'non', null,
       s.reperes_fr, s.reperes_ar, null, null, 'pratique (pièce tirée d''un logiciel de facturation)',
       'pratique', 'defaut_a_valider', k.id, null, false
  from (values
    ('bon_livraison',  'Totaux',           'total_ht',           'facture',        'total_ht'),
    ('bon_livraison',  'Totaux',           'montant_tva',        'devis_proforma', 'montant_tva'),
    ('bon_livraison',  'Totaux',           'total_ttc',          'facture',        'total_ttc'),
    ('bon_livraison',  'Totaux',           'montant_en_lettres', 'facture',        'montant_en_lettres'),
    ('ticket_caisse',  'Lignes et totaux', 'total_ht',           'facture',        'total_ht'),
    ('ticket_caisse',  'Lignes et totaux', 'montant_en_lettres', 'facture',        'montant_en_lettres'),
    ('bon_commande',   'Lignes et totaux', 'montant_tva',        'devis_proforma', 'montant_tva'),
    ('bon_commande',   'Lignes et totaux', 'total_ttc',          'facture',        'total_ttc'),
    ('bon_commande',   'Lignes et totaux', 'montant_en_lettres', 'facture',        'montant_en_lettres'),
    ('recu_quittance', 'Montants',         'total_ht',           'facture',        'total_ht'),
    ('recu_quittance', 'Montants',         'total_ttc',          'facture',        'total_ttc'),
    ('recu_quittance', 'Montants',         'montant_en_lettres', 'facture',        'montant_en_lettres')
  ) as v(grille, parcelle, code, source, champ_source)
  join ref.grilles g on g.code = v.grille
  join ref.grilles gs on gs.code = v.source
  join ref.grille_champs s on s.grille_id = gs.id and s.code = v.champ_source
  join ref.concepts k on k.id = s.concept_id
 where not exists (select 1 from ref.grille_champs x where x.grille_id = g.id and x.code = v.code);

-- « Net reçu » : le libellé du montant d'une quittance (algoria-133).
update ref.grille_champs c
   set reperes_fr = c.reperes_fr || array['Net reçu', 'Montant reçu']::text[]
  from ref.grilles g
 where g.id = c.grille_id and g.code = 'recu_quittance' and c.code = 'montant_recu'
   and not ('Net reçu' = any (c.reperes_fr));

-- Les libellés des totaux : « Total avoir TTC » (50/36), « Total des crédits » (algoria-136). Sans groupe de taux, le
-- total d'une somme doit porter son libellé pour que la pièce se prouve (le moteur,
-- `packages/sudoku/src/lib.rs`) ; « Total TTC » ne se lisait pas dans « Total avoir TTC ».
-- « Total à payer » : celui d'une déclaration mensuelle (algoria-142).
update ref.grille_champs c
   set reperes_fr = c.reperes_fr || v.ajout
  from ref.grilles g,
       (values ('avoir', 'total_ttc', array['Total avoir TTC', 'Total avoir', 'Montant de l''avoir']::text[]),
               -- « Total des crédits », « Totaux / المجاميع » (algoria-136, algoria-137)
               ('releve_bancaire', 'total_credits', array['Total des crédits', 'Total crédits', 'Totaux']::text[]),
               ('releve_bancaire', 'total_debits', array['Total des débits', 'Total débits', 'Totaux']::text[]),
               ('declaration_mensuelle', 'total_a_payer', array['Total à payer']::text[])
       ) as v(grille, champ, ajout)
 where g.id = c.grille_id and g.code = v.grille and c.code = v.champ
   and not (v.ajout[1] = any (c.reperes_fr));

-- Le libellé arabe du total d'un avoir et d'un devis (« المجموع », « المبلغ الجملي ») :
-- algoria-127, avoir arabe, se prouvait par un total que rien ne nommait.
update ref.grille_champs c
   set reperes_ar = c.reperes_ar || array['المبلغ الجملي', 'المجموع']::text[]
  from ref.grilles g
 where g.id = c.grille_id and g.code in ('avoir', 'devis_proforma') and c.code = 'total_ttc'
   and not ('المجموع' = any (c.reperes_ar));

-- ---------------------------------------------------------------- les preuves traduites
insert into ref.grille_preuves (grille_id, code, regle, genre, expression, statut, variante)
select g.id, v.code, v.regle, v.genre, v.expression, 'defaut_a_valider', v.variante
  from ref.grilles g
  join (values
    ('releve_bancaire', 'P01a', 'Partie de P01 : solde final = solde initial + total des crédits − total des débits (soldes créditeurs ; un solde débiteur ne ferme pas et reste muet)',
     'arithmetique', null::text,
     '{"op": "somme", "total": "solde_final", "parties": ["solde_initial", "total_credits", "-total_debits"]}'::jsonb),
    ('bulletin_paie', 'P01a', 'Partie de P01 : salaire brut = salaire de base + primes, indemnités et heures supplémentaires imprimées − absences',
     'arithmetique', null,
     '{"op": "somme", "total": "salaire_brut", "parties": ["salaire_base", "prime_anciennete?", "prime_rendement?", "indemnite_presence?", "indemnite_transport?", "heures_supplementaires?", "avantages_en_nature?", "conges_payes_pris?", "jours_feries_payes?", "-absences?"]}'::jsonb),
    ('bulletin_paie', 'P03a', 'Partie de P03 : net à payer = salaire brut − retenue CNSS − IRPP − autres retenues imprimées',
     'arithmetique', null,
     '{"op": "somme", "total": "net_a_payer", "parties": ["salaire_brut", "-retenue_cnss_salarie", "-retenue_irpp", "-cotisation_fpe_salarie?", "-css_salarie?", "-retraite_complementaire_salarie?", "-assurance_groupe_salarie?", "-cotisation_syndicale?", "-avance_sur_salaire?", "-pret_employeur?", "-saisie_cession?"]}'::jsonb),
    ('recu_quittance', 'P01a', 'Partie de P01 : montant reçu = loyer + TVA + charges + timbre − retenue à la source',
     'arithmetique', 'loyer',
     '{"op": "somme", "total": "montant_recu", "parties": ["montant_loyer_principal", "tva_loyer?", "charges?", "droit_timbre?", "-retenue_source_loyer?"]}'::jsonb),
    ('recu_quittance', 'T01', 'Reçu tiré d''un logiciel de facturation : total TTC = total HT + TVA',
     'arithmetique', 'totaux',
     '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "tva_loyer"]}'::jsonb),
    ('recu_quittance', 'T02', 'Reçu tiré d''un logiciel de facturation : TVA = total HT × un taux du barème',
     'arithmetique', 'totaux',
     '{"op": "taux", "montant": "tva_loyer", "base": "total_ht", "bareme": "tva"}'::jsonb),
    ('recu_quittance', 'T03', 'Montant en chiffres = montant en lettres (P02, sur le total TTC)',
     'recoupement', 'totaux',
     '{"op": "lettres", "champ": "montant_en_lettres", "egal_a": ["total_ttc"]}'::jsonb),
    ('bon_livraison', 'T01', 'BL valorisé : total TTC = total HT + TVA',
     'arithmetique', null,
     '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva"]}'::jsonb),
    ('bon_livraison', 'T02', 'BL valorisé : TVA = total HT × un taux du barème',
     'arithmetique', null,
     '{"op": "taux", "montant": "montant_tva", "base": "total_ht", "bareme": "tva"}'::jsonb),
    ('bon_livraison', 'T03', 'BL valorisé : montant en chiffres = montant en lettres',
     'recoupement', null,
     '{"op": "lettres", "champ": "montant_en_lettres", "egal_a": ["total_ttc"]}'::jsonb),
    ('ticket_caisse', 'T01', 'Total TTC = total HT + TVA',
     'arithmetique', null,
     '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "ventilation_tva"]}'::jsonb),
    ('ticket_caisse', 'T02', 'TVA = total HT × un taux du barème',
     'arithmetique', null,
     '{"op": "taux", "montant": "ventilation_tva", "base": "total_ht", "bareme": "tva"}'::jsonb),
    ('ticket_caisse', 'T03', 'Montant en chiffres = montant en lettres',
     'recoupement', null,
     '{"op": "lettres", "champ": "montant_en_lettres", "egal_a": ["total_ttc"]}'::jsonb),
    ('bon_commande', 'T01', 'Total TTC = total HT + TVA',
     'arithmetique', null,
     '{"op": "somme", "total": "total_ttc", "parties": ["total_ht", "montant_tva"]}'::jsonb),
    ('bon_commande', 'T02', 'TVA = total HT × un taux du barème',
     'arithmetique', null,
     '{"op": "taux", "montant": "montant_tva", "base": "total_ht", "bareme": "tva"}'::jsonb),
    ('bon_commande', 'T03', 'Montant en chiffres = montant en lettres',
     'recoupement', null,
     '{"op": "lettres", "champ": "montant_en_lettres", "egal_a": ["total_ttc"]}'::jsonb)
  ) as v(grille, code, regle, genre, variante, expression) on v.grille = g.code
 where not exists (select 1 from ref.grille_preuves p where p.grille_id = g.id and p.code = v.code);

-- ---------------------------------------------------------------- la déclaration mensuelle
update ref.grille_preuves p
   set expression = v.expression
  from ref.grilles g,
       (values
         ('P01b', '{"op": "taux", "base": "ca_taxable_13?", "bareme": "tva", "montant": "tva_13?"}'::jsonb),
         ('P01c', '{"op": "taux", "base": "ca_taxable_7?", "bareme": "tva", "montant": "tva_7?"}'::jsonb)
       ) as v(code, expression)
 where g.id = p.grille_id and g.code = 'declaration_mensuelle' and p.code = v.code;

do $$
declare n integer;
begin
  select count(*) into n
    from ref.grille_preuves p join ref.grilles g on g.id = p.grille_id
   where (g.code, p.code) in (('releve_bancaire', 'P01a'), ('bulletin_paie', 'P01a'),
                              ('bulletin_paie', 'P03a'), ('recu_quittance', 'P01a'),
                              ('recu_quittance', 'T01'), ('bon_livraison', 'T01'),
                              ('ticket_caisse', 'T01'), ('bon_commande', 'T01'));
  if n <> 8 then
    raise exception 'preuves traduites : % sur 8 attendues', n;
  end if;
end $$;

commit;
