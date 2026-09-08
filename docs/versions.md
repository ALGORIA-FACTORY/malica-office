# Les versions

Une seule ligne de numéros, `0.1.x`, pour les écrans et pour l'application
native. Chaque correction publiée prend le numéro suivant, jamais réutilisé.
Deux chemins de livraison :

- **En vol** — le bundle web part par Capgo (`ota.yml`, étiquette
  `web-v<version>`) ; le téléphone l'a au lancement suivant, sans le magasin.
- **Magasin** — l'application native part par Google Play (`android.yml`,
  piste choisie) ; elle emporte le bundle web du moment.

L'application dit ce qu'elle fait tourner dans Réglages → Version : les
ÉCRANS (bundle web), l'APPLICATION (native, avec son numéro de construction)
et le CANAL. C'est la première chose à lire avant de signaler une anomalie.

| Version           | Livrée par             | Date         | Contenu                                                                                                                                                                                        | Vérifié                                                                                                                    |
| ----------------- | ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0 (1)         | Magasin, piste interne | 6 sept. 2026 | Première application : capture hors ligne, lecture citée, fil de Malica, icône et écran de lancement.                                                                                          | Installée depuis le Store sur le téléphone de test.                                                                        |
| 0.1.1 (2, puis 6) | Magasin, piste interne | 7 sept. 2026 | Zone sûre du haut sous Android 15 (le haut de l'écran n'était pas cliquable) ; icônes de la barre d'état qui suivent Paper/Ink. La construction 6 est la première publiée par la CI, sans clé. | 396 tests web, 12 parcours Playwright ; à confirmer sur le téléphone.                                                      |
| 0.1.2             | En vol, canal staging  | 7 sept. 2026 | Contenu identique à 0.1.1 : l'épreuve du canal de mise à jour en vol.                                                                                                                          | Bundle servi par Capgo sur `staging`.                                                                                      |
| 0.1.3             | En vol, canal staging  | 7 sept. 2026 | Réglages → Version : écrans, application, canal.                                                                                                                                               | Test de garde du pont ; **vue sur le téléphone de test le 7 sept.**, arrivée en vol sans le Store : la chaîne est prouvée. |
| 0.2.0 | Magasin (nouvelle application `com.algoriafactory.malica`) puis en vol | 8 sept. 2026 | Malica Office : le nom, partout — écrans, textes en trois langues, identifiants, base, serveur, dépôt, Google Play, Capgo. Le visage de Malica. | Typage ×3, 398 tests web, 158 socle, 160 API, contrat RPC régénéré ; à confirmer sur le téléphone après installation de la nouvelle application. |
