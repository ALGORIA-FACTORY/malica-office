# La fabrique de lecteurs — le plan, après lecture du dépôt

*18 octobre 2026. Écrit après avoir lu le code, pas avant.*

Chaque format documentaire suffisamment éprouvé doit devenir un **lecteur
spécialisé réutilisable**, pour que Malica cesse d'appeler un modèle distant sur
les documents récurrents — sans rien perdre des citations ni des contrôles.

---

## Ce que le dépôt porte déjà, et qui décide de l'architecture

Relevé dans le code, pas supposé :

| | ce que c'est | pourquoi cela décide |
|---|---|---|
| `PageToken` (`ports/malica.ts:22`) | page, ordinal, texte, **boîte normalisée 0..1**, confiance | une recette peut viser une **zone** sans dépendre de la résolution ni du dpi |
| `TokenRef` | page, ordinal, **`ordinalEnd`** | une plage de tokens est déjà exprimable et stockable |
| `FieldCitation` | + `field`, `zone`, `ui_field`, `ui_role`, `bbox` | la preuve d'origine existe déjà, avec ce que l'écran doit en montrer |
| `ReadFlag` | **ensemble FERMÉ** de codes | une abstention a déjà son vocabulaire ; on n'en invente pas un second |
| `legal.ingestion_queue` (`20260902130000`) | « la file dit où en est chaque texte » | **l'idiome du dépôt pour une file durable en base** — à copier, pas à réinventer |
| `agents.agent_runs` + `agents.model_pricing` | le journal des appels, tarifé par couple (modèle, rôle) | R8 : un organe sans tarif ne se journalise pas, **en silence** |
| `recoller-les-milliers.ts` | recolle « 5 » + « 650,000 » | corrigé le 18 octobre ; **tout nouveau lecteur doit passer par là** |

**Trois chiffres mesurés cette nuit**, qui bornent l'ambition : la chaîne lit en
**18 à 21 s** par pièce, dont **3 s** de désignation, pour ≈ **0,0035 $**. Le
relevé est le coût ; la désignation ne l'est plus. Une recette n'économise donc
pas « l'IA » en bloc : elle économise **la désignation**, et c'est ce qu'il faut
mesurer.

---

## Les quatre règles qui priment, et d'où elles viennent

### ① Aucun lecteur de valeur n'est réécrit — **la règle qui compte le plus**

L'interpréteur déterministe **ne lit pas les montants lui-même**. Il désigne des
`TokenRef`, exactement comme le modèle, et laisse la chaîne existante faire le
reste : `recollerLesMilliers`, `lireMontantDuPlan`, `normalizeDate`, `citer`,
`plageAmputee`, puis les contrôles.

La raison est écrite dans le sang de cette nuit : une facture arabe est sortie
**valide à 650 000 D là où le papier portait 5 650 000 D**, parce qu'une fonction
de recollage existait depuis treize jours et **n'était branchée nulle part**. Un
second lecteur de montants divergerait de la même façon, et personne ne le
verrait — les équations confirment une amputation systématique.

**Conséquence de conception** : une recette produit une **désignation**, pas une
valeur. C'est un `VisionSelection` comme un autre. Tout ce qui suit est partagé,
donc aucun doublon n'est possible par construction.

### ② Aucune constante dans le code (R4)

Une recette est une **donnée** : déclarative, versionnée, interprétée, stockée en
base. Aucun opérateur arbitraire exécutable, aucun seuil de promotion écrit en
TypeScript, aucun nom de format en dur. Les seuils vivent dans le référentiel,
datés et surchargeables (R10).

### ③ Rien de mort, et on supprime en route (R9)

Chaque chose trouvée morte pendant ce travail part dans le même commit que la
découverte. `knip` ne voit **ni le CSS ni le SQL** : la vérification est à faire
à la main, et elle a déjà rendu cinq outils justes non branchés cette nuit.

### ④ Une preuve obtenue en superutilisateur ne prouve rien

Toute garantie d'isolation s'éprouve sous une **identité `authenticated`
réelle**. C'est la règle du dépôt, et elle a un relevé : sept désaccords, sept
fois la lecture avait tort contre l'exécution.

---

## Le trajet, et le seul point d'insertion

```
relevé → plan de tokens → [ RECONNAISSANCE → recette applicable ? ]
                              ├─ oui → interprétation déterministe → sélection
                              └─ non → désignation par le modèle → sélection
                                               ↓
                        relecture dans le plan (partagée)  →  contrôles  →  écran
```

**Un seul point d'insertion** : entre le plan de tokens et la désignation, dans
`relever()` / `read-flow.ts`. En aval, rien ne change — donc rien ne se
duplique, et la non-régression est structurelle.

---

## Les tâches, séparées par **droit d'écriture**

C'est la règle qui a tenu toute la nuit : on sépare par zone de fichiers, jamais
par sujet. Deux agents sur un même fichier ont coûté 983 lignes.

| # | tâche | écrit dans |
|---|---|---|
| **1** | le socle de données : recettes, versions, exemples, évaluations, exécutions, décisions, dérives | `db/migrations/`, épreuves `apps/api/src/fabrique/` |
| **2** | la signature structurelle et la reconnaissance | `apps/api/src/fabrique/signature*` |
| **3** | le contrat de recette + le validateur strict | `apps/api/src/fabrique/recette*` |
| **4** | l'interpréteur déterministe et l'abstention | `apps/api/src/fabrique/interprete*` |
| **5** | le branchement dans la chaîne (le seul point d'insertion) | `apps/api/src/malica/lecture/read-flow.ts`, `vision.ts` |
| **6** | la file durable des travaux, sur le modèle de `legal.ingestion_queue` | `db/migrations/`, `apps/api/src/fabrique/travaux*` |
| **7** | le générateur de recette et le cycle de vie | `apps/api/src/fabrique/generateur*`, `cycle*` |
| **8** | les dépôts RPC et les droits | `apps/api/src/depots/fabrique.ts`, `contrat/` |
| **9** | les écrans — expert et numériseur | `apps/web/src/` |
| **10** | la télémétrie et les garde-fous | `apps/api/src/fabrique/mesures*` |
| **11** | la documentation d'exploitation et le scénario reproductible | `docs/fabrique-de-lecteurs/` |

Les tâches **1, 2, 3** partent ensemble : zones disjointes. **4** suit 2 et 3,
**5** suit 4, **9** attend que les dépôts existent.

---

## Ce qu'une recette a le droit d'exprimer

Des **ancres textuelles**, des **relations spatiales** sur les boîtes
normalisées, des **zones** de page, et des **structures de tableau**. Jamais des
coordonnées fixes seules : un document scanné de travers les invalide toutes.

Elle doit tenir : français, arabe, pages mixtes, sens de lecture, en-têtes et
pieds, champs facultatifs, ancres répétées, pagination, et un tableau réparti sur
plusieurs pages.

**Elle n'invente jamais un champ absent** et **ne remplace jamais silencieusement
une valeur illisible** — elle s'abstient, et l'abstention rend la main à la
chaîne existante avec son motif.

---

## Ce qu'une recette n'apprend jamais

La **structure**, jamais les valeurs variables. Et une **décision comptable n'est
pas une règle de lecture** : une correction humaine se qualifie — reconnaissance,
désignation, normalisation, document incomplet, ou décision métier — et seules
les trois premières peuvent nourrir une recette.

---

## Ce qui sera mesuré, et ce qui ne sera pas inventé

Exactitude des champs critiques, montants faux **acceptés**, champs et pages
omis, exactitude des lignes, taux d'abstention, corrections humaines, recours au
modèle, latences médiane et p95, coût **total** par document — génération,
observation, évaluation et secours compris.

Une mesure absente **reste absente**. Le tableau de capacité de l'OCR, écrit
cette nuit, marque ses cases non essayées comme telles : c'est la tenue exigée
ici aussi. Et un score non calibré ne s'affiche jamais comme une probabilité de
justesse.

---

## Le démarrage, et sa limite

Toute recette naît **en observation** : elle s'exécute, on compare, on ne la
croit pas. C'est une mesure de déploiement — **ce n'est pas une excuse pour
livrer un cycle de vie incomplet.** L'activation, la suspension, le retrait et le
retour arrière doivent exister et s'éprouver.
