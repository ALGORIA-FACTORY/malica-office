# La mesure de référence du chat, avant sa reconstruction

Relevé le 9 novembre 2026 sur le staging (`staging.malica-office.algoria-factory.com`, version
0.2.106, `main`), par la route publique `/malica/demander`, avec le compte d'essai du dirigeant de
SOTUMAG (société fictive du jeu de données). Script : `apps/api/tests/real/mesure-chat-reference.ts`.
Données brutes : `preuves/reference/mesures.json`.

Le jeu : les 24 questions de `epreuve-conseil.json` (19 questions de droit écrites depuis le corpus,
5 pièges), notées par `noterLeCas`, le barème de l'épreuve du conseil.

| Mesure                                    | Valeur                                    |
| ----------------------------------------- | ----------------------------------------- |
| Questions posées, réponses reçues         | 24 / 24 (HTTP 200)                        |
| Premier octet reçu, médiane / 95e centile | 13,5 s / 18,4 s                           |
| Fin de la réponse, médiane / 95e centile  | 13,5 s / 18,4 s (rien n'arrive en flux)   |
| Réponses justes (marqueurs du corpus)     | 13 / 19                                   |
| Faux refus                                | 1 / 19                                    |
| Citations justes                          | non mesurables : 0 / 19 (voir ci-dessous) |
| Pièges correctement refusés               | 4 / 5                                     |
| Réponses retenues pour la comptabilité    | 1                                         |
| Coût réel (journal `agents.agent_runs`)   | 0,2294 $ pour 24 appels                   |
| Jetons                                    | 302 068 en entrée, 35 883 en sortie       |

## Ce que ces chiffres veulent dire

- **Aucune citation n'est mesurable** : la route ne renvoie pas les sources au navigateur. Le score de
  citation est donc nul par construction ; c'est une limite de l'existant, pas une mesure de justesse.
- **Le piège manqué** est le « trou d'édition » (une date où le corpus n'a aucune édition en vigueur) :
  le chat répond « 20 % » au lieu de dire qu'il ne trouve pas le texte.
- **Le modèle journalisé** est `deepseek-reasoner` ; le fournisseur sert en réalité `deepseek-flash`
  sous cet alias (constat 13).
- **Ce que le navigateur reçoit** : `answer`, `controles`, `conversationId`, `latencyMs`, `messageId`,
  `model`, `reasoning` (vide), `retenue`, `runId`, `titre`, `tokensIn`, `tokensOut`. Le modèle, les
  jetons, la durée et l'identifiant d'exécution sont des secrets techniques à retirer (lot C).

## Une correction du barème, faite sans nouvel appel

Le premier passage ne reconnaissait comme refus que « je ne trouve pas » et notait 0 / 5 piège refusé.
À la lecture, quatre pièges étaient bien refusés (« Je ne peux pas vous répondre… relève du droit
français », « Ce n'est pas mon domaine »…). La reconnaissance des refus a été élargie et les réponses
enregistrées renotées (`--relire`), sans rappeler le modèle.
