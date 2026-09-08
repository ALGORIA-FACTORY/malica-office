-- =====================================================================================
--  Malica Office — Calendrier des obligations déclaratives, Tunisie
--
--  LA DÉCOUVERTE QUI JUSTIFIE CE FICHIER : l'échéance ne dépend pas seulement de la forme
--  juridique, elle dépend du MODE DE DÉPÔT. Une personne morale a 28 jours, la même
--  personne morale qui télédéclare n'en a plus que 20 — c'est une RÉDUCTION du délai,
--  introduite par la LF 2024, et vérifiée dans trois codes indépendants
--  (art. 18-IV-1 CTVA, art. 52-IV CIRPPIS, art. 39-II CFL, art. 119-III CDET).
--  Un calendrier qui ne modélise pas le mode de dépôt fera rater des échéances.
--
--  Idempotent.
-- =====================================================================================

insert into ref.fiscal_obligations
  (jurisdiction, code, libelle, periodicite, echeance_jour, echeance_regle,
   forme_juridique, mode_depot, texte_source, article, citation, valid_from, valid_to)
select v.j, v.code, v.libelle, v.periodicite, v.jour, v.regle,
       v.forme, v.mode, v.texte, v.article, v.citation, date '2026-01-01', null
from (values
  ('TN','TVA_PP','Declaration mensuelle TVA','mensuelle',15,'15 premiers jours du mois suivant','physique',null,'Code de la TVA','art. 18-IV-1-a',null),
  ('TN','TVA_PM','Declaration mensuelle TVA','mensuelle',28,'28 premiers jours du mois suivant','morale','papier','Code de la TVA','art. 18-IV-1-b',null),
  ('TN','TVA_PM_EDI','Declaration mensuelle TVA','mensuelle',20,'20 premiers jours du mois suivant','morale','electronique','Code de la TVA (alinea ajoute par art. 69 LF 2024)','art. 18-IV-1-b al.2',null),
  ('TN','RS_PP','Reversement des retenues a la source','mensuelle',15,'15 premiers jours du mois suivant','physique',null,'Code IRPP/IS','art. 52-IV tiret 1',null),
  ('TN','RS_PM','Reversement des retenues a la source','mensuelle',28,'28 premiers jours du mois suivant','morale','papier','Code IRPP/IS','art. 52-IV tiret 2',null),
  ('TN','RS_PM_EDI','Reversement des retenues a la source','mensuelle',20,'20 premiers jours du mois suivant','morale','electronique','Code IRPP/IS (mod. art. 69-1 LF 2023-13)','art. 52-IV tiret 2',null),
  ('TN','RS_FORF_TRIM','Reversement des retenues a la source','trimestrielle',15,'15 premiers jours du mois suivant chaque trimestre civil',null,null,'Code IRPP/IS','art. 52-IV tiret 1',null),
  ('TN','RS_TAXI_SEM','Reversement des retenues a la source','semestrielle',15,'15 premiers jours de janvier et de juillet',null,null,'Code IRPP/IS','art. 52-IV tiret 1',null),
  ('TN','TCL_PP','Declaration TCL (etablissements industriels, commerciaux ou professionnels)','mensuelle',15,'15 premiers jours du mois suivant celui de realisation du CA','physique',null,'Code de la fiscalite locale','art. 39-II',null),
  ('TN','TCL_TRIM','Declaration TCL','trimestrielle',15,'15 premiers jours du mois suivant chaque trimestre civil',null,null,'Code de la fiscalite locale','art. 39-II',null),
  ('TN','TCL_PM','Declaration TCL','mensuelle',28,'28 premiers jours du mois suivant','morale','papier','Code de la fiscalite locale','art. 39-II',null),
  ('TN','TCL_PM_EDI','Declaration TCL','mensuelle',20,'20 premiers jours du mois suivant','morale','electronique','Code de la fiscalite locale (mod. art. 69-4 LF 2024)','art. 39-II',null),
  ('TN','TFP_PP','Declaration taxe de formation professionnelle','mensuelle',15,'15 premiers jours du mois suivant celui du paiement des salaires','physique',null,'Loi n. 88-145 du 31/12/1988','art. 30',null),
  ('TN','TFP_TRIM','Declaration taxe de formation professionnelle','trimestrielle',15,'15 premiers jours du mois suivant chaque trimestre civil',null,null,'Loi n. 88-145 (ajout art. 57-9 decret-loi 2022-79)','art. 30',null),
  ('TN','TFP_PM','Declaration taxe de formation professionnelle','mensuelle',28,'28 premiers jours du mois suivant celui du paiement des salaires','morale',null,'Loi n. 88-145 du 31/12/1988 (mod. art. 49 loi 90-111 ; art. 34 loi 93-125)','art. 30',null),
  ('TN','FOPROLOS_PP','Declaration contribution FOPROLOS','mensuelle',15,'15 premiers jours du mois suivant celui du paiement des salaires','physique',null,'Loi n. 77-54 du 3 aout 1977','art. 3 tiret 1',null),
  ('TN','FOPROLOS_PM','Declaration contribution FOPROLOS','mensuelle',28,'28 premiers jours du mois suivant celui du paiement des salaires','morale',null,'Loi n. 77-54 du 3 aout 1977 (mod. art. 36 loi 88-145 ; art. 48 loi 90-111 ; art. 35 loi 93-125)','art. 3 tiret 2',null),
  ('TN','IRPP_RCM','Declaration annuelle IRPP','annuelle',25,'jusqu''au 25 fevrier','physique',null,'Code IRPP/IS','art. 60-I-1-a',null),
  ('TN','IRPP_COMM','Declaration annuelle IRPP','annuelle',25,'jusqu''au 25 avril',null,null,'Code IRPP/IS','art. 60-I-1-b',null),
  ('TN','IRPP_SERV','Declaration annuelle IRPP','annuelle',25,'jusqu''au 25 mai',null,null,'Code IRPP/IS','art. 60-I-1-c',null),
  ('TN','IRPP_ARTIS','Declaration annuelle IRPP','annuelle',25,'jusqu''au 25 juillet',null,null,'Code IRPP/IS','art. 60-I-1-d',null),
  ('TN','IRPP_AGRI','Declaration annuelle IRPP','annuelle',25,'jusqu''au 25 aout',null,null,'Code IRPP/IS','art. 60-I-1-e',null),
  ('TN','IRPP_SAL','Declaration annuelle IRPP','annuelle',5,'jusqu''au 5 decembre',null,null,'Code IRPP/IS','art. 60-I-1-f',null),
  ('TN','IS_PM','Declaration annuelle IS','annuelle',25,'jusqu''au 25 mars ; ou 25e jour du 3e mois suivant la cloture si exercice non calendaire','morale',null,'Code IRPP/IS','art. 60-I-2',null),
  ('TN','IS_PM_PROV','Modification de la declaration IS provisoire','ponctuelle',15,'dans les 15 jours suivant l''approbation ou la certification des comptes, au plus tard le 25e jour du 3e mois suivant la date limite de l''art. 60-I-2',null,null,'Code IRPP/IS','art. 60-I-2 al.3',null),
  ('TN','IRPP_NONCAL','Declaration annuelle IRPP exercice non calendaire','annuelle',null,'25e jour du 3e mois qui suit la cloture de l''exercice','physique',null,'Code IRPP/IS','art. 60-I-1',null),
  ('TN','DECL_EMPLOYEUR','Declaration de l''employeur (sommes soumises a RS et avances facturees)','annuelle',30,'jusqu''au 30 avril de chaque annee',null,null,'Code IRPP/IS','art. 55-III',null),
  ('TN','ACOMPTE_PP','Acomptes provisionnels (3 acomptes)','3 fois par an',25,'25 premiers jours des 6e, 9e et 12e mois suivant la cloture de l''exercice','physique',null,'Code IRPP/IS','art. 51-IV tiret 1',null),
  ('TN','ACOMPTE_PM','Acomptes provisionnels (3 acomptes)','3 fois par an',28,'28 premiers jours des 6e, 9e et 12e mois suivant la cloture de l''exercice','morale',null,'Code IRPP/IS','art. 51-IV tiret 2',null),
  ('TN','FORFAIT_OPT','Declaration annuelle de l''impot forfaitaire optionnel','2 tranches egales',25,'1re tranche jusqu''au 25 avril ; 2e tranche jusqu''au 25 octobre',null,null,'Code IRPP/IS art. 44 ter (ajoute par art. 91 LF 2026)','art. 44 ter',null),
  ('TN','IFORTUNE','Declaration de l''impot sur la fortune','annuelle',null,'au plus tard fin juin de chaque annee','physique',null,'Loi n. 2025-17 du 12/12/2025 (LF 2026)','art. 88 al.5',null),
  ('TN','PRIX_TRANSFERT','Declaration annuelle sur les prix de transfert','annuelle',60,'memes delais que l''art. 60-I-2 (25 mars / 25e jour du 3e mois)',null,'electronique','Code IRPP/IS','art. 59-II bis',null),
  ('TN','DECL_EXISTENCE','Declaration d''existence','ponctuelle',null,'avant d''entamer l''activite','morale',null,'Code IRPP/IS','art. 56',null),
  ('TN','DECL_MODIF','Depot des actes modificatifs (statuts, siege, capital, affectation des resultats)','ponctuelle',30,'dans les 30 jours de la date des deliberations de l''AG','morale',null,'Code IRPP/IS','art. 57',null),
  ('TN','DECL_CESSION','Declaration de cession ou cessation totale','ponctuelle',15,'dans les 15 jours de la cession ou de la fermeture definitive',null,null,'Code IRPP/IS','art. 58-I',null),
  ('TN','DECL_DECES','Declaration en cas de deces','ponctuelle',6,'dans les 6 mois de la date du deces',null,null,'Code IRPP/IS','art. 60-IV',null),
  ('TN','DECL_DEPART','Declaration avant depart de Tunisie','ponctuelle',null,'dans le mois qui precede celui du depart',null,null,'Code IRPP/IS','art. 60-III',null),
  ('TN','PLUSVALUE','Declaration de plus-value (cessions art. 27-2 et 27-3)','ponctuelle',null,'au plus tard a la fin du 3e mois suivant celui de la realisation effective de la cession',null,null,'Code IRPP/IS','art. 60-II',null),
  ('TN','CNSS_DECL','Declaration trimestrielle des salaires CNSS','trimestrielle',15,'15e jour du mois suivant le trimestre echu',null,null,'Loi n. 60-30 du 14 decembre 1960','art. 46',null),
  ('TN','CNSS_PAIEMENT','Paiement des cotisations CNSS','trimestrielle',15,'15e jour du mois suivant le trimestre echu',null,null,'Loi n. 60-30','art. 45 al.2',null),
  ('TN','TIMBRE_PP','Declaration du droit de timbre sur declaration','mensuelle',15,'15 premiers jours de chaque mois','physique',null,'CDET edition 2026','art. 119 par. III-1',null),
  ('TN','TIMBRE_PM','Declaration du droit de timbre sur declaration','mensuelle',28,'28 premiers jours de chaque mois','morale','papier','CDET edition 2026','art. 119 par. III-2',null),
  ('TN','TIMBRE_PM_EDI','Declaration du droit de timbre sur declaration','mensuelle',20,'20 premiers jours de chaque mois','morale','electronique','CDET, ajoute n.3 art. 69 LF 2023-13','art. 119 par. III-2 al.2',null)
) as v(j, code, libelle, periodicite, jour, regle, forme, mode, texte, article, citation)
where not exists (
  select 1 from ref.fiscal_obligations o
  where o.jurisdiction = v.j and o.code = v.code and o.valid_from = date '2026-01-01');
