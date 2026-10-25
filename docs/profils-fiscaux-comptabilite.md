# Profils fiscaux des clients

Le comptable peut créer un profil par catégorie depuis les paramètres ou la mise en route, puis l'appliquer à un ou plusieurs dossiers. L'ouverture d'un dossier et sa synthèse donnent accès au même composant. Aucun écran PME n'est modifié.

- Cinq familles proposées à qualifier : TVA, timbre, FODEC, retenue, autres obligations. Aucun taux n'est inventé ni coché applicable par défaut.
- Activité, régime fiscal, régime TVA, prorata, règles par opération, seuil de retenue, référence légale, conditions, justificatif et date d'effet.
- Valeurs suggérées par le pack à la date choisie. Un changement de taux, de montant ou de traitement reste une décision explicite de l'expert.
- Profils et instantanés de dossier append-only ; auteur et historique conservés. Le cabinet peut avoir plusieurs juridictions de profils, mais une affectation exige celle du client.
- Lors d’une reprise de mandat, l’historique appartient au client : le nouveau mandataire le conserve, l’ancien perd l’accès.
- Application groupée avec sélection, filtre par catégorie, aperçu avant/après et contrôle du mandat. Les particularités existantes, juridictions incompatibles et dates incohérentes sont écartées. La reprise de particularités exige un geste individuel explicite.
- Contrôle de concurrence, verrouillage ordonné, transaction unique, détection d'un aperçu périmé. Aucun écrasement silencieux.
- La fiche fiscale existante est versionnée dans la même transaction sans perdre forme juridique, mode de dépôt ou exercice. Les lectures courantes respectent une date d'effet future.
- Les attentes sont revérifiées avant comptabilisation pour refuser un brouillon périmé. Les attentes TVA/timbre sont relues à la date de la facture ; la retenue à celle du règlement. Les taux et seuils du dossier alimentent les contrôles, les montants restent ceux des pièces et de la qualification. La version utilisée est tracée dans l'audit.

## Limites explicites

Ce paramétrage n'est pas une certification fiscale. Les assiettes légales, conditions sectorielles, seuils et imputations continuent à exiger le référentiel et une qualification correcte de l'opération. Un nouveau code doit disposer de son imputation ou de son assiette/seuil au référentiel avant utilisation.

## Qualification de la pièce et calcul des droits

La fiche du cabinet permet maintenant de qualifier les bases par groupe TVA et de partager un groupe entre plusieurs comptes ou usages. La qualification cite la lecture, la date, la version du profil, la qualité du redevable, le contexte intérieur/import/export et la justification. Chaque droit proportionnel porte sa propre assiette et sa source. Une base non soumise est explicitement zéro ; l’activité du client ne suffit jamais à rendre tous les produits soumis.

Le moteur calcule le droit au taux daté et le rapproche du montant imprimé. Les droits taxables majorent la base TVA. À l’achat, le FODEC non récupérable et la TVA non déductible suivent le compte du coût concerné : stock, immobilisation ou charge. L’affectation directe déductible/non déductible reste distincte de l’usage commun au prorata daté. À la vente, la TVA est collectée intégralement.

Les montants sont toujours relus dans les jetons. Une qualification incohérente est annulée dans la transaction. Les contrôles qualifiés exigent l’égalité exacte après arrondi à la devise, sans ligne de résidu. Une nouvelle extraction ou un nouveau profil invalide la qualification ; une proposition ancienne est revérifiée avant inscription. Le droit proportionnel sans qualification est refusé, même sans profil. Seul l’expert du mandat actif peut qualifier ; l’historique reste immuable.

Sources de principes : [Ministère des Finances, assiette TVA et FODEC](https://www.finances.gov.tn/fr/node/883), [DGI, note commune 29/2007, assiettes distinctes DC/FODEC et assiette TVA](https://jibaya.tn/wp-content/uploads/2024/02/Note-commune-n-29-4.pdf), [NC 04 §12, coût des stocks](https://oect.org.tn/wp-content/uploads/2023/01/NC_04.pdf). Les anciens exemples chiffrés de ces documents ne servent pas de barème actuel. L’éligibilité sectorielle, les exonérations, les pièces douanières et les autres obligations demandent la qualification et les textes applicables à l’opération ; aucun diagnostic exhaustif n’est inféré de la catégorie du client.

Une modification du régime ou de l'activité ne peut pas remplacer une fiche ouverte à la même date : choisir une date ultérieure. Les autres valeurs fiscales peuvent être révisées le même jour, par un nouvel instantané. Les écritures antérieures restent immuables.
