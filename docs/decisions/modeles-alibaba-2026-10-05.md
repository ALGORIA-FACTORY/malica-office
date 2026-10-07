# Modèles Alibaba et PaddleOCR — décision du 5 octobre 2026

Décision du commanditaire, reportée ici mot pour mot depuis la note de projet
« decisions-paddleocr-modeles-alibaba-infra-2026-10-05 ». Ce fichier existe
parce qu'une décision qui ne vit que dans un projet extérieur n'est pas
opposable au dépôt : le 5 octobre, une note de conception a nommé
`qwen3-vl-flash` comme cible alors qu'il est retiré cinq jours plus tard.

**Les tarifs ci-dessous sont ceux de la décision, pas ceux que j'ai relevés.**
Ils prévalent. Là où ma propre recherche donnait autre chose — 0,05 / 0,40 $
pour `qwen3.8-flash` au lieu de 0,15 / 0,47 — c'est la décision qui compte, et
l'écart est noté pour qu'on sache qu'il existe.

---

## Les modèles retenus

| rôle                      | modèle                   | entrée / sortie, $ par Mtok |
| ------------------------- | ------------------------ | --------------------------- |
| Témoin OCR                | `qwen-vl-ocr-2025-11-20` | 0,07 / 0,16                 |
| Compréhension de page     | `qwen3.8-flash`          | 0,15 / 0,47                 |
| Cas difficiles, en option | `qwen3.6-plus`           | 0,5 / 3                     |
| Embeddings                | `qwen3.7-text-embedding` | —                           |

## Les modèles interdits

- `qwen3-vl-flash` — **retrait le 10 octobre 2026**
- `qwen3-vl-plus`
- `qwen-vl-max`
- `qwen-vl-plus`
- Qwen3 VL en version open source

## PaddleOCR

- **PP-OCRv6** si disponible, sinon **PP-OCRv5**
- **PP-StructureV3** pour la structure de page
- lecture des **cachets**
- **PaddleOCR-VL 1.6** en second lecteur

---

## Ce que cette décision implique dans le dépôt

**R8 n'est pas satisfaite par ce fichier.** « Le modèle est une donnée, pas une
constante » veut dire que le nom vient de la table qui le tarife
(`agents.model_pricing`), versionnée par date d'effet. Aujourd'hui seuls
`qwen-vl-ocr-2025-11-20`, `deepseek-chat`, `deepseek-reasoner`, `pdf-text` et
`qwen3.7-text-embedding` y ont une ligne en vigueur.

Appeler `qwen3.8-flash` sans sa ligne de tarif ferait exactement ce qui est
arrivé à l'œil : l'appel s'exécute, `agents_run_log` ne trouve aucun tarif, et
le coût n'est **pas** journalisé — donc le plafond de `agents.budgets` ne mord
sur rien (dette D47). La bascule passe donc par une migration datée, pas par un
déploiement, et le tarif y sera celui de ce tableau.

Les modèles interdits ne sont pas seulement « à éviter » : ils doivent être
**impossibles**. Une ligne de tarif absente les rend déjà inappelables sans
perte de journal ; un test confrontant le code à cette liste rendrait la faute
visible plus tôt. À écrire avec la bascule.

## État au 5 octobre 2026, le soir

|                             | aujourd'hui dans le code | cible              |
| --------------------------- | ------------------------ | ------------------ |
| relevé (l'œil)              | `qwen-vl-ocr-2025-11-20` | inchangé           |
| compréhension / désignation | `deepseek-chat`          | `qwen3.8-flash`    |
| second témoin               | —                        | PP-OCRv6, sinon v5 |

`deepseek-chat` a remplacé `deepseek-reasoner` le 5 octobre après mesure
(`tests/real/designation-cout.ts`) : 414 jetons de sortie contre 3 792, et
0,0020 $ contre 0,0097. Ce n'est pas la cible, c'est l'étape qui enlève
trente-six secondes d'attente dès maintenant.

La bascule vers `qwen3.8-flash` demande trois choses, dans cet ordre : son
tarif en base, un client qui sache l'appeler avec une image, et la mesure
côte à côte sur les dix factures du jeu d'or. Sans la troisième, on
remplacerait un modèle mesuré par un modèle supposé.
