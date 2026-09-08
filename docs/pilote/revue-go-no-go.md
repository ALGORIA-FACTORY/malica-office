# Revue de fin de pilote — go / no-go

Une semaine, quatre personnes (fondateur, expert-comptable, deux dirigeants
de PME), une décision écrite. Chaque critère est mesuré par
`db/pilote/tableau-de-bord.sql` sur les six dernières semaines, ou relevé
dans un registre nommé. Aucun critère ne se juge « à peu près ».

## Les critères

| #   | Critère                                              | Seuil                        | Mesuré par                                    | Résultat | Verdict |
| --- | ---------------------------------------------------- | ---------------------------- | --------------------------------------------- | -------- | ------- |
| 1   | Sessions sans plantage                               | ≥ 99,5 %                     | Sentry, « crash-free sessions », 6 semaines   |          |         |
| 2   | Captures réussies (pièce déposée / capture lancée)   | ≥ 95 %                       | tableau de bord, § captures                   |          |         |
| 3   | Pièces lues sans précision demandée                  | ≥ 70 %, croissant sur 6 sem. | tableau de bord, § lecture                    |          |         |
| 4   | Photo → proposition d'écriture, p95                  | < 120 s                      | tableau de bord, § délais                     |          |         |
| 5   | Photo → écriture validée par le cabinet, médiane     | < 48 h                       | tableau de bord, § délais                     |          |         |
| 6   | Échecs de lecture (pièce jamais lue après 1 h)       | < 3 %                        | tableau de bord, § lecture                    |          |         |
| 7   | Drainage de la file hors ligne, p95                  | < 10 min après retour réseau | signalements + Sentry (fil d'Ariane « file ») |          |         |
| 8   | PME actives (≥ 1 capture par semaine)                | ≥ 80 % des inscrites         | tableau de bord, § activité                   |          |         |
| 9   | Bloquants ouverts                                    | 0                            | projet GitHub « Pilote », étiquette bloquant  |          |         |
| 10  | Acceptation de l'expert-comptable                    | ≥ 8 / 10, signée             | ce document, § acceptation                    |          |         |
| 11  | Dernière répétition de restauration                  | < 30 jours, réussie          | `docs/exploitation.md`, registre              |          |         |
| 12  | Revue Play passée, fiche publiée, piste fermée tenue | 14 jours continus            | Play Console                                  |          |         |

**Go** : les douze verts. **Prolongation** (deux à quatre semaines) : au
plus deux oranges, aucun rouge sur 1, 6, 9, 11. **Arrêt** : autrement, ou
sur décision de l'expert.

## L'acceptation de l'expert-comptable

Sur dix : la qualité des lectures, la justesse des propositions, le temps
gagné par dossier, la confiance dans ce que Malica dit ne pas savoir, la
volonté de continuer avec ses clients. Note, remarques, signature, date.

## Ce que le go déclenche

1. `docs/exploitation.md` § Déployer : `DOMAINE=app.malica.tn` dans `.env`,
   `deployer.sh <version>` — Caddy obtient le certificat, rien n'est recopié.
2. Play Console : demande d'accès à la production, fiche FR/AR relue, la
   version de la piste fermée promue.
3. `apps/web/.env.coque-prod` et le canal Capgo `production` deviennent ceux
   de la coque distribuée ; `pilote` reste le canal du cabinet pilote pour
   les semaines qui suivent.
4. La convention de pilote est remplacée par le contrat de service ; la
   déclaration INPDP est mise à jour.

## Ce que le no-go déclenche

L'export complet de chaque dossier remis au cabinet sous 15 jours
(`/cabinet/export`), la purge selon la convention, et un écrit qui dit
pourquoi — critère par critère.

## Décision

Date · présents · décision (go / prolongation / arrêt) · signatures.
