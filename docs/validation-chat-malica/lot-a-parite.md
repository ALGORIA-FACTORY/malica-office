# Lot A — inspection exécutée : le même chat sur Claude et sur DeepSeek

Date : 10 novembre 2026. Commit déployé sur le staging : `8257ce55` (= `origin/main`, #298 comprise).
Environnement : staging, société d'essai du jeu de données (SOTUMAG, fictive), compte dirigeant d'essai.
Méthode : les mêmes six questions posées au chemin Claude (`/malica/assistant`, flux, outils) et au chemin DeepSeek
(`/malica/demander`, ancienne conversation). Données brutes : `preuves/lot-a-parite/parite-2026-11-10.json`. Le script de la session n'est pas conservé (R9, `knip`) : le banc réutilisable de la recette (lot L) le remplace.
Dépense lue au journal des agents du staging : **≈ 0,226 $** (Haiku 0,0065 $, Sonnet 0,1713 $, DeepSeek 0,0484 $).

## Ce que la mesure établit

| Constat | Mesure | Verdict |
|---|---|---|
| Premier signe, chemin Claude | 188 à 229 ms (6 questions) | sous la cible de 1 s |
| Premier signe, chemin DeepSeek | 6,05 s à 15,18 s, aucun flux : la réponse arrive d'un bloc | cible manquée, cause : pas de flux |
| Latence journalisée de DeepSeek | 463 ms en moyenne au journal, pour 6 à 15 s réelles | confirme que la mesure est fausse (lue avant le corps) |
| Questions sur la société : mêmes faits ? | NON sur les trois | DeepSeek ne voit qu'un instantané |
| Sources rendues | Claude 0 à 14 ; DeepSeek 0 sur les six | pas de citation sur le chemin DeepSeek |
| Texte du droit | Claude et DeepSeek donnent 19 %, article 7 | cohérents sur cette question |

## Les trois contradictions sur la société (même société, même minute)

- **TVA du mois.** Claude : novembre en crédit de 342,000 TND, une seule pièce transmise. DeepSeek : déclaration d'octobre non déposée et aucune TVA à reprendre faute de facture saisie. Deux réponses différentes, aucune des deux n'est fausse d'après sa seule source, mais elles ne regardent pas les mêmes données.
- **Pièces en attente d'un geste.** Claude : 114 sur 119. DeepSeek : 23 « capturées », et il dit ne pas pouvoir conclure sur les autres.
- **Dépenses par fournisseur.** Claude : un classement établi sur les 20 pièces les plus récentes, avec ses limites dites. DeepSeek : « une seule dépense fournisseur », donc pas de comparaison.

Cause (lue dans le code, confirmée par la mesure) : DeepSeek passe par `askMalica`, sans boucle d'outils ; il lit un instantané du dossier,
pas les pièces ni les écritures par les mêmes outils que Claude. La parité demande d'unifier les moyens, pas seulement le style.

## Autres constats

- **Question en arabe sur le droit (délai de TVA).** Claude retient la réponse pour la comptabilité (53 caractères : « votre comptable relit ma réponse »)
  après 19,6 s ; DeepSeek répond en 15,2 s mais se corrige en cours de phrase (« vingt-cinq… non, plutôt vingt-huit jours ») et ne cite aucune source.
  Aucune des deux ne remplit le critère « réponse juste, citée, vite ». À traiter aux lots D et E.
- **Aucun bloc visuel** : tout est du texte, même la comparaison par fournisseur (lot I).
- **Modèles réellement servis** : Haiku pour la boucle d'outils (32 appels), Sonnet pour `conseil_fiscal` (4 appels), `deepseek-reasoner` pour le chemin DeepSeek.
  Aucun `deepseek-flash` ni `deepseek-v4-pro` dans le dépôt ni au journal : la documentation du fournisseur n'a pas été confrontée à une liste servie (à faire au lot B, appel `/models`, gratuit).

## Ce qui n'est pas vérifié ici

Six questions, une seule exécution : pas de médiane ni de 95e centile. Pas de téléphone. Pas de rôle autre que dirigeant. La justesse des chiffres de Claude
n'est pas recomptée contre la base (lot F). Le coût d'un Sonnet de bout en bout est mesuré sur 4 appels seulement.
