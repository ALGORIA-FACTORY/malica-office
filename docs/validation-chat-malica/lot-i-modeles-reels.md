# Lot I — essai réel des trois moteurs sur la boucle de l'assistant

Date : 10 et 11 novembre 2026. Code : branche `chantier/malica-parite-et-visuels` (PR #345), sources recopiées dans un
dossier temporaire du conteneur de l'API du staging et jouées là, où sont les clés. **Rien n'a été déployé, redémarré ni
écrit en base** : le dossier est FICTIF et tenu en mémoire (une société « SOTUMAG SARL », douze pièces, trois échéances,
des totaux par classe), la consigne est celle du staging plus les deux sections de la branche.
Moteurs : `claude-haiku-5-5` (le modèle courant du réglage), `deepseek-chat`, `deepseek-flash`.
Données brutes : `preuves/lot-i-modeles-reels/essai-{1..5}-2026-11-10.json` (78 réponses).

## Ce que l'essai a trouvé, et qui n'était visible d'aucune épreuve simulée

**Sur Claude, toute réponse à outil était interrompue** (essai 1 : « Ma réponse a été interrompue » sur 4 questions sur 6).
L'API refuse un résultat d'outil qui mêle des blocs `search_result` à un bloc de texte ; l'annonce « un visuel est
disponible » y avait été glissée. DeepSeek, lui, l'acceptait : la parité était cassée dans l'autre sens. Corrigé
(l'annonce voyage à côté des résultats) et figé par une épreuve (`repli.test.ts`).

## Résultat après correction

| Mesure | Claude (Haiku) | deepseek-chat | deepseek-flash |
|---|---|---|---|
| Mêmes outils et mêmes blocs que les deux autres, par question (essais 3, 4, 5) | 24/24 · 12/12 · 12/12 | idem | idem |
| Fuite d'un nom de modèle, de fournisseur ou d'outil (essais 2 à 5) | 0 | 0 | 0 |
| Premier signe, médiane (essai 3, 8 questions) | 766 ms | 886 ms | 974 ms |
| Premier signe, maximum | 1 127 ms | 1 039 ms | 1 236 ms |
| Fin de réponse, médiane | 3,4 s | 3,9 s | 4,2 s |
| Phrases retirées par la garde (essai 3) | 0 | 1 | 1 |
| Coût mesuré, 78 réponses en tout | 0,0208 $ | 0,0461 $ | non chiffré : pas de tarif en base (M-4) |

Les chiffres sont les mêmes sur les trois moteurs (résultat 31 840,000 ; achats 21 789,500 ; ventes 149 670,500), et
depuis l'essai 4 ils sont écrits dans la même forme que le bloc. Le périmètre « Toutes les sociétés » ouvre la
comparaison sur les trois ; sans lui, les trois répondent qu'ils ne voient que le dossier ouvert, sans rien lire (essai 5).

## Ce qui n'est pas bon, dit tel quel

- **La cible du premier signe (moins d'une seconde en médiane) est tenue de peu** : 0,77 à 0,97 s, sur 8 questions et
  une seule exécution. Ce n'est ni une médiane sur cent questions ni un 95e centile.
- **L'annonce reste en français quand la question est en arabe**, sur Claude et sur deepseek-chat (« Je regarde vos
  achats par fournisseur. » puis la suite en arabe). Défaut de consigne, à traiter au lot E.
- **Les moteurs recopient encore des lignes du tableau** dans leur texte, alors que la consigne le déconseille.
- **Une période mal redite** (« de février à novembre » pour décembre à novembre) : la garde ne relit que les chiffres.
  Atténué — la période est maintenant écrite en toutes lettres dans la source — mais pas empêché.
- **Une phrase générale chiffrée est retirée** (question libre, deepseek-flash) : la garde ne distingue pas une
  conversation libre d'un chiffre du dossier. À traiter au lot E (« parler de tout »).
- Claude a écrit une fois « Je affiche les trois visuels » : il annonce le visuel, ce que la consigne interdit.

## Ce que cet essai ne prouve pas

Les outils lisaient un dossier fictif : ni la base, ni la RLS, ni le fil, ni la relecture par la comptabilité, ni le
flux jusqu'au navigateur n'étaient dans la boucle. La RLS des nouveaux outils est éprouvée à part, sur la base de test
(`verif-298.test.ts`). L'essai de bout en bout — écran, API, base, modèle — demande un déploiement sur le staging.
Le modèle « difficile » (Sonnet) n'a pas été sollicité : aucune question ne déclenchait la règle de difficulté.
