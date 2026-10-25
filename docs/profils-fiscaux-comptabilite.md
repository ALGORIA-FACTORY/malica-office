# Profils fiscaux des clients

Le comptable peut créer un profil par catégorie depuis les paramètres ou la mise en route, puis l'appliquer à un ou plusieurs dossiers. L'ouverture d'un dossier et sa synthèse donnent accès au même composant. Aucun écran PME n'est modifié.

- Cinq familles proposées à qualifier : TVA, timbre, FODEC, retenue, autres obligations. Aucun taux n'est inventé ni coché applicable par défaut.
- Activité, régime fiscal, régime TVA, prorata, règles par opération, seuil de retenue, référence légale, conditions, justificatif et date d'effet.
- Valeurs suggérées par le pack à la date choisie. Un changement de taux, de montant ou de traitement reste une décision explicite de l'expert.
- Profils et instantanés de dossier append-only ; auteur et historique conservés. Le cabinet peut avoir plusieurs juridictions de profils, mais une affectation exige celle du client.
- Application groupée avec sélection, filtre par catégorie, aperçu avant/après et contrôle du mandat. Les particularités existantes, juridictions incompatibles et dates incohérentes sont écartées. La reprise de particularités exige un geste individuel explicite.
- Contrôle de concurrence, verrouillage ordonné, transaction unique, détection d'un aperçu périmé. Aucun écrasement silencieux.
- La fiche fiscale existante est versionnée dans la même transaction sans perdre forme juridique, mode de dépôt ou exercice. Les lectures courantes respectent une date d'effet future.
- Les attentes sont revérifiées avant comptabilisation pour refuser un brouillon périmé. Les attentes TVA/timbre sont relues à la date de la facture ; la retenue à celle du règlement. Les taux et seuils du dossier alimentent les contrôles, les montants restent ceux des pièces et de la qualification. La version utilisée est tracée dans l'audit.

## Limites explicites

Ce paramétrage n'est pas une certification fiscale. Les assiettes légales, conditions sectorielles, seuils et imputations continuent à exiger le référentiel et une qualification correcte de l'opération. Un nouveau code doit disposer de son imputation ou de son assiette/seuil au référentiel avant utilisation.

La déduction partielle/mixte, l'ambiguïté entre plusieurs types portant le même code, et les droits proportionnels ou incorporés à l'assiette TVA sont refusés dans la proposition automatique sous profil tant que leur qualification par ligne n'est pas disponible. En particulier, cette livraison ne prétend pas corriger le calcul FODEC du moteur historique pour les dossiers sans profil. Les nouvelles configurations ne doivent pas autoriser silencieusement ce cas connu.

Une modification du régime ou de l'activité ne peut pas remplacer une fiche ouverte à la même date : choisir une date ultérieure. Les autres valeurs fiscales peuvent être révisées le même jour, par un nouvel instantané. Les écritures antérieures restent immuables.
