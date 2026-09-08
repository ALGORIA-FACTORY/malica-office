-- =====================================================================================
--  Malica Office — Extensions Malica au plan comptable tunisien
--
--  CE FICHIER NE CONTIENT AUCUN COMPTE OFFICIEL.
--  Chaque ligne ci-dessous est une subdivision OUVERTE PAR MALICA parce que
--  la nomenclature NC 01 (1996) ne descend pas jusqu'au niveau dont le produit a
--  besoin, ou parce que la norme applicable est postérieure à la nomenclature.
--
--  Fondement de l'ouverture : NC 01 admet l'adaptation du plan par l'entreprise ;
--  le commentaire du compte 24 la prescrit même expressément
--  (« Ce compte est ventilé dans les mêmes conditions que le compte 22 »).
--
--  Toutes ces lignes portent is_official = false. L'expert-comptable peut les
--  renuméroter, les renommer ou les supprimer depuis la couche de paramétrage
--  sans toucher au socle officiel. C'est la frontière contractuelle du produit :
--    is_official = true  -> verbatim NC 01, jamais modifiable
--    is_official = false -> défaut Malica, ajustable par l'expert
--
--  Idempotent.
-- =====================================================================================

-- NOTE DE TYPAGE : account_class est supposée ENTIÈRE. Si la colonne du dépôt est de
-- type text, retirez le « ::int » ci-dessous — c'est le seul point à ajuster.
insert into ref.accounts
  (pack_version_id, account_code, label, parent_code, account_class,
   normal_side, is_collective, requires_auxiliary, is_official, source_ref)
select p.id, v.code, v.label, v.parent, v.classe,
       v.sens, false, false, false, v.justif
from ref.jurisdiction_packs p
cross join (values

  -- --- Impôts et taxes : 437 n'a aucune subdivision officielle -----------------------
  -- Le droit de timbre n'est PAS une taxe sur le chiffre d'affaires : la série 436 lui
  -- est fermée. Commentaire officiel NC 01 : le compte 437 « est crédité du montant de
  -- tous les autres impôts et taxes dus par l'entreprise par le débit des comptes de
  -- charges intéressés. » -> c'est le seul rattachement officiel possible.
  ('4371','Etat - droits de timbre collectés','437','4','credit',
   'Extension Malica sous 437 (NC 01 ne subdivise pas 437). Le timbre n''est pas une taxe sur le CA : serie 436 exclue.'),
  ('4372','Etat - taxe de formation professionnelle a payer','437','4','credit',
   'Extension Malica sous 437. Contrepartie de la charge officielle 6611 TFP.'),
  ('4373','Etat - FOPROLOS a payer','437','4','credit',
   'Extension Malica sous 437. Contrepartie de la charge officielle 6612 FOPROLOS.'),

  -- --- NC 41 « Contrats de location » (2008), postérieure à la nomenclature (1996) ----
  -- Preneur en location-financement : l'actif se loge en 24 et NON en 22.
  ('241','Immobilisations a statut juridique particulier - Terrains','24','2','debit',
   'NC 01, commentaire cpte 24 : « Ce compte est ventile dans les memes conditions que le compte 22 ».'),
  ('242','Immobilisations a statut juridique particulier - Constructions','24','2','debit',
   'NC 01, commentaire cpte 24 : ventilation en miroir du compte 22.'),
  ('243','Immobilisations a statut juridique particulier - Installations techniques, materiel et outillage industriels','24','2','debit',
   'NC 01, commentaire cpte 24 : ventilation en miroir du compte 22.'),
  ('244','Immobilisations a statut juridique particulier - Materiel de transport','24','2','debit',
   'NC 01, commentaire cpte 24 : ventilation en miroir du compte 22.'),
  ('248','Immobilisations a statut juridique particulier - Autres immobilisations corporelles','24','2','debit',
   'NC 01, commentaire cpte 24 : ventilation en miroir du compte 22.'),

  ('2841','Amortissements des immobilisations a statut juridique particulier - Terrains','284','2','credit',
   'Miroir de 241. Ouvert par symetrie avec la ventilation du compte 24.'),
  ('2842','Amortissements des immobilisations a statut juridique particulier - Constructions','284','2','credit',
   'Miroir de 242.'),
  ('2843','Amortissements des immobilisations a statut juridique particulier - Installations techniques, materiel et outillage industriels','284','2','credit',
   'Miroir de 243.'),
  ('2844','Amortissements des immobilisations a statut juridique particulier - Materiel de transport','284','2','credit',
   'Miroir de 244.'),
  ('2848','Amortissements des immobilisations a statut juridique particulier - Autres immobilisations corporelles','284','2','credit',
   'Miroir de 248.'),

  ('1686','Dettes sur contrats de location-financement','168','1','credit',
   'NC 41 (2008) posterieure a la nomenclature NC 01 (1996) : aucun compte dedie. 168 = {1681,1685,1688}, le 1686 est libre. Part < 1 an a reclasser en 505, interets courus en 508.'),
  ('1881','Resultat differe sur operation de cession-bail','188','1','credit',
   'NC 41 §56-57 : la plus-value de cession-bail suivie d''une location-financement est differee et amortie, jamais portee au resultat de l''exercice.')

) as v(code, label, parent, classe, sens, justif)
where p.jurisdiction = 'TN'
  and not exists (
    select 1 from ref.accounts a
    where a.pack_version_id = p.id and a.account_code = v.code);
