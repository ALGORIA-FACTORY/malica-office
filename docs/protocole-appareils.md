# Protocole d'épreuve sur appareil

Ce qu'aucun script ne sait juger : la caméra, le cadrage, la lumière, un
pouce, une batterie. Ce protocole se déroule **en entier** sur chaque
appareil de la matrice, avant l'alpha puis à chaque changement natif (un
greffon, une permission, une montée de Capacitor) ; les mises à jour en vol
ne rejouent que les points marqués ◆. Le relevé se consigne dans
`docs/pilote/appareils.md`, une colonne par appareil, une ligne par point,
avec la version de la coque et du bundle.

## La matrice

| Appareil                      | Pourquoi lui                                                | Android | RAM    |
| ----------------------------- | ----------------------------------------------------------- | ------- | ------ |
| Tecno Spark ou Infinix Hot    | le téléphone le plus vendu aux dirigeants de PME en Tunisie | 13–14   | 3–4 Go |
| Xiaomi Redmi 13C              | MIUI et son économiseur de batterie agressif                | 13–14   | 4 Go   |
| Samsung Galaxy A15 ou A54     | One UI, la moitié du parc                                   | 14–15   | 4–8 Go |
| Huawei (sans services Google) | pas de ML Kit : le repli sur le cadrage du navigateur       | 12      | 4 Go   |
| Émulateur Google APIs, API 34 | ce que la CI voit (Maestro)                                 | 14      | 2 Go   |

Deux appareils sont achetés pour le pilote (le premier et le second) ; les
autres sont empruntés une demi-journée.

## Avant de commencer

- La coque installée **depuis Play** (piste interne), pas par `adb`, sauf pour
  l'émulateur : la signature, les permissions et la mise à jour sont celles
  que la PME verra.
- Un compte du jeu de données sur `staging` (`contact@sotumag.tn`), jamais
  un compte réel.
- Trois documents papier : un ticket de caisse thermique, une facture A4, la
  carte d'identification fiscale plastifiée. Une pièce sombre, une fenêtre.
- La version affichée dans Réglages notée en tête de colonne.

## Les points

Chaque point se note **OK**, **KO** (avec ce qui s'est passé, en une
phrase, et un signalement depuis les réglages) ou **NA**.

### 1. Le scanner — les quatre cas

1. ◆ **Ticket à bout de bras** : ticket de caisse tenu au bout du bras, en
   lumière de plafond. Le cadre se pose seul, la pièce est lisible dans
   l'aperçu, le total est lu.
2. ◆ **Facture de biais** : facture A4 sur une table, téléphone à 30°. Le
   redressement donne un rectangle droit ; les colonnes restent alignées.
3. ◆ **Carte d'identification fiscale** : la carte plastifiée sous une
   fenêtre (reflets). Le matricule est lu, ou l'application dit qu'elle n'y
   arrive pas — jamais un matricule inventé.
4. **Abandon** : ouvrir le scanner, revenir sans photographier. Aucun message
   d'erreur, aucune pièce créée, l'écran d'avant intact.
5. **Permission refusée puis accordée** : refuser la caméra, voir le message
   qui explique quoi faire, accorder dans les réglages du téléphone, revenir :
   le scanner s'ouvre sans relancer l'application.
6. **Cinq pages** : un document de cinq pages en une capture. L'écran
   « Je prépare vos pages · n/5 » apparaît ; moins de 4 s avant l'aperçu.

### 2. Le hors ligne

7. ◆ **Mode avion, trois pièces** : mode avion, photographier trois pièces.
   Chacune apparaît « À envoyer » dans Vos documents, la pastille dit 3.
   Couper le mode avion : les trois partent sans un geste, en moins de 60 s,
   et la lecture démarre seule.
8. ◆ **Tuée pendant l'envoi** : photographier une pièce lourde (cinq pages)
   sur 3G, et forcer l'arrêt (`adb shell am force-stop com.algoriafactory.regalica`
   ou par les réglages) pendant « Envoi… ». Rouvrir : la pièce repart,
   **une seule** pièce existe côté cabinet, avec la même empreinte.
9. **Réseau lent** : 2G/EDGE simulée (réglages développeur, ou l'émulateur).
   Une pièce de 600 Ko part en moins de 25 s, avec reprise si le réseau
   tombe au milieu.
10. **Hors ligne, les autres gestes** : confirmer, transmettre, préciser en
    mode avion. Chacun dit « ce geste sera possible au retour du réseau » ;
    aucun ne semble réussir à tort.
11. **Données du cache** : hors ligne, ouvrir l'accueil et la liste. Les
    données d'avant s'affichent avec la mention de leur date.

### 3. Le ressenti

12. ◆ **Le bouton retour, à chaque écran** : accueil, liste, pièce, chat
    Regalica ouvert, visionneuse ouverte, détail des lignes, scanner,
    confirmation de suppression, réglages, fiche. Le retour ferme d'abord ce
    qui est ouvert par-dessus, puis recule d'un écran ; depuis l'accueil, il
    quitte — et une seule fois.
13. ◆ **Zone sûre** : la barre basse n'est pas sous la barre de gestes ; rien
    n'est caché sous la barre d'état ; le clavier pousse le champ actif et
    la barre basse ensemble.
14. ◆ **Sombre** : thème du téléphone en sombre, application en « Système ».
    Pas de flash blanc au lancement ; la barre d'état suit.
15. ◆ **Arabe** : langue arabe. Tout est en miroir (barre basse, flèches,
    listes), la police arabe est celle de l'application, les montants
    restent en chiffres latins alignés.
16. **Police 130 %** : taille de police maximale du téléphone. Rien n'est
    coupé, rien ne déborde, les boutons restent tapables.
17. **Rotation** : tourner l'appareil sur chaque écran. Rien ne se perd (un
    message en cours de saisie, une capture en cours).
18. **Reprise après une nuit** : laisser l'application en arrière-plan une
    nuit. Le matin, elle s'ouvre connectée, sans mot de passe, et la liste
    est à jour.
19. **Économiseur de batterie** : mode économie d'énergie actif (MIUI :
    « restriction en arrière-plan »). Une pièce déposée puis l'application
    mise en arrière-plan part quand même à la prochaine ouverture.
20. **Disque presque plein** : moins de 200 Mo libres. La capture dit
    clairement qu'il n'y a plus de place ; rien n'est perdu de ce qui était
    déjà en file.

### 4. La mise à jour

21. **Mise à jour en vol** : publier un bundle sur le canal `staging`
    (`ota.yml`). Fermer, rouvrir : la nouvelle version est là (Réglages), sans
    passer par Play. Rouvrir une seconde fois : elle y est toujours.
22. **Retour arrière** : dans Capgo, remettre le canal sur le bundle d'avant.
    Fermer, rouvrir : l'ancienne version est revenue.
23. **Mise à jour par Play** : installer la version suivante depuis la piste
    interne. La file hors ligne et la session survivent.

### 5. Les temps

Mesurés trois fois, la médiane notée. Budgets : démarrage à froid < 2 s sur
Galaxy A15, < 3,5 s sur Tecno ; scanner → aperçu < 1,5 s pour une page,
< 4 s pour cinq ; photo → proposition d'écriture p95 < 120 s.

24. Démarrage à froid (application tuée) jusqu'à l'accueil.
25. Scanner → aperçu, une page.
26. Scanner → aperçu, cinq pages.
27. Photo → proposition d'écriture, en Wi-Fi.

## Sur Huawei, sans services Google

Le scanner ML Kit n'existe pas : le point 1 se fait avec le cadrage du
navigateur (plus lent, un modèle téléchargé une fois). Les points 1 à 3 se
notent avec cette voie, et le temps du premier cadrage (téléchargement
compris) se relève à part.

## Ce qui arrête tout

Un KO sur 7, 8, 12 ou 18 est **bloquant** : pas d'alpha tant qu'il n'est pas
corrigé et rejoué sur le même appareil. Les autres KO se traitent dans la
semaine et se rejouent à la mise à jour suivante.
