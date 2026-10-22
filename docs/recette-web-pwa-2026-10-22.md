# Reprise web/PWA — 0.2.65

Travail Codex autorisé par Wissem le 22 octobre 2026, sur une branche isolée
depuis `a3376f5fca31d2d11ae37f8718e4fa92dae664b7` (0.2.64).
La publication demandée vise le staging, via le circuit GitHub existant.

## Corrections livrées

- Le cadre PME utilise la largeur du poste : suppression de la troisième
  colonne vide et des limites de 440–544 px sur tablette et desktop. Le même
  contenu et les mêmes composants restent servis. Les raccourcis de l'accueil
  passent sur quatre colonnes quand la place le permet ; les liens Documents,
  Échéances et Réglages complètent le rail desktop. Les couleurs et thèmes
  existants sont conservés.
- Une facture dont le total ou un règlement manque affiche « Solde à
  confirmer ». Les règlements en chargement, en erreur ou sans montant ne
  valent plus zéro. Le vrai solde connu reste distinct. Trois tests de rendu
  protègent ces cas.
- Sans mandat actif, la tuile du cabinet le dit. Un chargement ou un échec de
  lecture du mandat est également distingué de son absence.
- Les notifications de retard ne promettent plus que Malica ou un comptable
  traite une obligation : la phrase indique qu'une action est requise.
- « Mon espace » montre les captures privées réellement conservées dans la
  file locale du dossier. Une lecture serveur interrompue n'est plus affichée
  comme une bibliothèque vide. Un nouvel essai est proposé quand le réseau
  le permet. Aucun cache de documents serveur ni changement de RLS n'est créé.
- Le panneau commercial des réglages (prix, changement d'offre, engagement
  annuel, achats de recharges, paiement et recharge automatique) ne se rend
  plus dans la coque native. L'offre attribuée et ses compteurs restent en
  lecture. Les achats web/PWA gardent leurs services existants.
- Le montant à payer passe par le formateur monétaire commun ; aucune taxe,
  devise ou valeur métier n'est ajoutée dans l'écran.
- La barre « Parler à Malica » est un bouton entier accessible au clavier,
  avec une seule action et sans bouton imbriqué. Les liens actifs du rail
  portent `aria-current`.

## Validation

Sur la copie isolée : 566 tests web et 283 tests du socle réussis ; lint et
compilation web réussis. Le typage des workspaces est contrôlé. La CI de la
branche doit aussi valider API, contrats, architecture et parcours Playwright
avant fusion. La vérification du déploiement et du rendu staging intervient
après la publication des images.

## Limites explicites pour Claude

Ce lot ne clôt pas les 148 remarques de l'audit UI/UX. Il corrige le cadre
desktop partagé et les constats ci-dessus. Les dates fiscales, la TVA reclassée
du cabinet, l'OCR énergie/assurance, les noms de fournisseurs et la validation
du référentiel par Mondher ne sont pas modifiés.

La PWA conserve le service worker existant : elle ne devient pas une copie
complète utilisable à froid hors connexion. Seule la file locale déjà présente
dans l'application est rendue dans l'espace privé. Le comportement du retour
depuis Malica n'est pas changé dans ce lot.

La nouvelle interface Android provient du code partagé ; elle ne constitue
pas une preuve de test sur téléphone ni une publication dans Google Play.
Le canal Capgo n'est pas publié par cette fusion web/PWA. La chaîne IA réelle
reste à relancer avec ses clés dans l'environnement GitHub prévu ; aucune clé
n'est lue, recopiée ou inventée ici.

Pour la suite : recetter la 0.2.65 déployée, puis traiter les points restants de
l'audit par parcours, avec reproduction et conservation des preuves. Les
écritures libres envoyées par le client nécessitent une décision de droits et
une recette API ; elles ne sont pas fermées par une modification d'affichage.

## Reprise après revue — 22 octobre 2026

Deux régressions P2 de la PR #53 corrigées avant fusion :

- Le constat explicite `non_paye` avec montant nul vaut zéro payé, conformément
  au contrat existant. Un autre règlement sans montant reste indéterminé ; les
  lignes éteintes sont exclues et les sommes hors précision entière sont refusées.
- Une capture privée dans la file locale empêche l'annonce contradictoire
  d'un coffre vide, même si la liste serveur est vide.

Preuves locales : cinq cas sur le total des règlements et deux rendus du coffre,
avec reproduction du message vide avant correction. Suite web complète réussie
(576 tests). La CI complète doit confirmer cette nouvelle révision avant fusion.
