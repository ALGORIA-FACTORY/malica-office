# Le corpus juridique et ses empreintes vectorielles

**Date** : 1er septembre 2026
**État** : en service sur `regalica_local`. Migration
`20260901090000_empreintes_vectorielles_du_corpus.sql`.

---

## 1. Ce qui est en base

| | |
|---|---|
| Documents en file d'ingestion | 788, dont 786 ingérés |
| Articles | 3 110 |
| Versions datées | 4 902 |
| Références juridiques extraites | 23 631 |
| Fragments (`legal.chunks`) | **13 662**, tous encodés |
| Modèle d'empreinte | `alibaba/qwen3.7-text-embedding`, 1024 dimensions |
| Coût de l'encodage complet | **0,52 $** pour 7 496 708 jetons |
| Durée | 32 minutes |
| Taille de `legal.chunks` | 203 Mo, dont 105 Mo d'index HNSW |
| Latence de recherche mesurée | **6 à 74 ms** |

---

## 2. Deux défauts corrigés dans le chargeur du corpus

Le corpus n'était pas chargé, et il ne pouvait pas l'être.

**`db/corpus/charger.ps1` écrivait les blocs `COPY` dans l'ordre du dump.**
`pg_dump` les range par ordre alphabétique de table : `legal.article_versions`
arrivait avant `legal.articles`, et le chargement mourait à la première ligne sur
`article_versions_article_id_fkey`. L'en-tête du script annonçait pourtant
« l'ordre n'est pas négociable : on charge les parents d'abord » — l'intention
était juste, l'implémentation ne la portait pas. Les blocs sont désormais
indexés par table puis écrits dans l'ordre de dépendance déclaré.

**Le script annonçait « corpus chargé » en vert même après l'échec.** Le
`truncate` ayant déjà eu lieu, la base restait vide et l'opérateur repartait
convaincu du contraire. Le code de retour de `psql` est maintenant vérifié, et
le script lève.

---

## 3. Les choix d'architecture, et pourquoi

### 3.1 Des fragments, pas une colonne sur la version

Une empreinte par version d'article aurait été plus simple. Les mesures du
corpus l'interdisent : sur 4 902 versions, **96 dépassent 20 000 caractères et
l'une atteint 738 225**. Un vecteur unique pour un texte de cette taille ne
désigne plus rien — il moyenne un code entier — et dépasse la fenêtre de
n'importe quel modèle d'empreinte.

La table dégénère d'elle-même là où elle le peut : **3 564 versions donnent un
fragment unique**, et seules les longues sont découpées (la plus longue en 467).
Découpage à 1 800 caractères, recouvrement de 200, coupe préférentielle sur fin
de phrase ou saut de ligne — jamais au milieu d'un mot.

Un fragment porte un extrait **exact** de `legal.article_versions`. La recherche
remonte donc toujours à un texte que l'on peut relire dans sa version. Rien
n'est résumé, rien n'est généré.

### 3.2 La dimension est le vrai verrou de R8

R8 dit que changer de modèle est une ligne de migration. C'est vrai du **nom**
du modèle. Ce ne l'est pas de la **dimension** de ses empreintes : une colonne
`vector(1024)` n'accueille pas des vecteurs de 768. En changer impose une
migration de schéma **et** un réencodage complet du corpus.

D'où le choix de **1024** : c'est la dimension native de `qwen3.7-text-embedding`,
de `text-embedding-v3` et `v4`, **et de `bge-m3`** — le modèle souverain vers
lequel basculer le jour où l'on veut que rien ne sorte de la machine. Ce
jour-là, R8 tient sa promesse : une ligne dans la table qui tarife, puis un
réencodage à 0,52 $. Pas une refonte.

### 3.3 Le modèle vient de la table qui le tarife

`agents.model_pricing` n'acceptait que les rôles `reasoner`, `chat`, `vision`,
`cache` ; la migration ajoute `embedding` au `CHECK` et y inscrit la ligne
`alibaba / qwen3.7-text-embedding / embedding / 0,070 USD par million de jetons`.

Le nom du modèle n'est écrit **nulle part** dans le code. `vectoriser.mjs` et
`rechercher.mjs` le lisent dans la table, et refusent de démarrer s'il n'y en a
pas en vigueur. Chaque fragment porte le `pricing_id` qui l'a produit, avec une
contrainte qui interdit structurellement une empreinte sans sa provenance :

```sql
constraint chunks_empreinte_tracee check (
  (embedding is null and pricing_id is null and encode_le is null)
  or (embedding is not null and pricing_id is not null and encode_le is not null))
```

« Quel modèle a produit cette empreinte, et ce qu'elle a coûté » est une seule
lecture — ce que R8 demande.

**Point d'attention** : la question doit être encodée avec le **même** modèle que
le corpus. Encoder une question avec un autre modèle ne donne pas un résultat
dégradé, il donne un résultat dénué de sens, dans un espace vectoriel différent.
`rechercher.mjs` lit donc le modèle à la même source. Le jour d'un changement de
modèle, corpus et questions doivent basculer ensemble.

---

## 4. Vérification

L'index HNSW est bien emprunté — ce n'est pas une supposition :

```
Limit  (actual time=3.513..6.163 rows=5)
  ->  Index Scan using chunks_hnsw on chunks  (actual time=3.508..6.155 rows=5)
        Order By: (embedding OPERATOR(extensions.<=>) '[...]'::extensions.vector)
Execution Time: 6.497 ms
```

L'opérateur est qualifié `operator(extensions.<=>)` : l'extension vit dans le
schéma `extensions`, hors du `search_path` par défaut, et un appel non qualifié
échoue par « l'opérateur n'existe pas ». Aucune résolution implicite.

### Résultats sur des questions réelles

| Question | Premier résultat | Distance |
|---|---|---|
| droit de timbre sur les factures | **CDET art. 127** — l'article qui impose la mention « droit de timbre payé sur déclaration » sur les factures | 0,210 |
| retenue à la source sur les honoraires | **CIRPPIS art. 52** — 15 % puis 10 % au titre des honoraires | 0,244 |
| taux de TVA applicable aux services | **LF-1998 art. 25** (18 %), puis **LF-2018 art. 43** (18 % → 19 %) | 0,248 |
| الأداء على القيمة المضافة | **CTVA art. 9 et 10** — droit à déduction de la TVA | 0,390 |
| معاليم التسجيل والطابع الجبائي | **CDET art. 117** — recouvrement du droit de timbre | 0,312 |

Le corpus répond en arabe comme en français, sur le même index.

---

## 5. Deux constats à traiter

### 5.1 Le texte faisant foi est absent pour 92 % du corpus

```
langue_faisant_foi | avec texte_ar | sans texte_ar
ar                 |           383 |          4519
```

**Les 4 902 versions déclarent l'arabe faisant foi ; 383 seulement portent du
texte arabe.** Pour 4 519 versions, la base affirme qu'un texte fait foi et ne
le détient pas — elle ne détient que sa traduction française.

Ce n'est pas un défaut du vectoriel : c'est un défaut du corpus, que le
vectoriel rend visible. En l'état, une réponse fondée sur ces versions cite un
texte qui n'est pas celui qui fait foi. À arbitrer : soit l'ingestion récupère
l'arabe, soit `langue_faisant_foi` cesse d'affirmer ce qui n'est pas là.

### 5.2 La recherche n'est pas datée

Une même question remonte aujourd'hui plusieurs éditions du même article — la
recherche « droit de timbre » rend CDET art. 127 dans ses versions 2018, 2020 et
2025. C'est correct pour explorer, faux pour répondre : à une question posée
pour un exercice donné, seule la version en vigueur à cette date fait foi.

`legal.article_versions` porte déjà `valid_from` et `valid_to`. Il manque le
paramètre de date dans la recherche, et le filtre correspondant. C'est la même
lacune que celle relevée sur `ref.compte_du_role` dans l'évaluation
d'architecture : le référentiel sait dater, les fonctions qui l'interrogent ne
le demandent pas.

---

## 6. Reproductibilité

```
db/corpus/charger.ps1        charge le corpus depuis l'archive de la base de connaissance
db/corpus/vectoriser.mjs     fragmente puis encode ce qui n'a pas d'empreinte (reprenable)
db/corpus/rechercher.mjs     recherche sémantique, modèle lu en base
```

```bash
$env:PGPASSWORD = "..."
.\db\corpus\charger.ps1
bun db/corpus/vectoriser.mjs
bun db/corpus/rechercher.mjs "droit de timbre sur les factures" --nb 5
```

**Bun, pas Node.** `dashscope-intl.aliyuncs.com` ne se résout qu'en IPv6 (NAT64)
depuis ce poste : le `fetch` de Node expire en `ETIMEDOUT`, celui de Bun passe.
Même famille de piège que `localhost` → `::1` sur l'API locale, qui n'écoute
qu'en IPv4. Ce n'est pas une préférence de style.

`vectoriser.mjs` est **reprenable** : tout se fait par « ce qui manque ». Une
interruption se rattrape en relançant, sans doublon et sans repayer ce qui est
déjà encodé.
