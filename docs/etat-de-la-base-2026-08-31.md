# État de la base locale — 31 août 2026

Constat établi en lecture sur `regalica_local` (PostgreSQL 17.11, poste
« algoria »), puis vérifié par un rejeu complet des migrations sur une base
neuve `regalica_verif`. Aucune écriture sur `regalica_local`.

## 1. Ce qui va bien

La base vivante est saine, et sur les points que les règles d'architecture
rendent vérifiables, elle est conforme :

- 27 schémas, 88 tables, 54 vues, 109 Mo.
- **R6 tenue** : aucune table portant `tenant_id` n'est sans RLS, et aucune
  n'est sans index menant par `tenant_id`. 85 tables sous RLS.
- Toutes les vues `public` sont en `security_invoker = true`.
- Aucune fonction `security definer` sans `search_path` figé.
- Aucun droit résiduel pour `public` ni pour `anon`.
- Toutes les tables ont une clé primaire.

## 2. Le défaut majeur : le dépôt ne reconstruit pas la base

C'est le point qui contredit l'exigence « tout doit finir dans les fichiers,
reconstructible par script ».

Un rejeu des 52 migrations sur une base vide produit **13 schémas et 12 tables**,
là où la base vivante en compte 27 et 88. Autrement dit : la base actuelle ne
peut pas être reconstruite à partir du dépôt. Elle a été montée par une
version antérieure du chargeur, qui réécrivait le texte des migrations au vol.

Deux causes, et une seule reste ouverte.

### 2.1 Corrigé — une coquille de deux caractères

`db/local/00_compat_supabase.sql`, lignes 105 et 119 : l'ouverture de corps de
fonction était écrite `as $` au lieu de `as $$`, alors que la fermeture était
bien `$$`. PostgreSQL refusait le fichier dès cette ligne.

Conséquence : les fonctions `auth.uid()` et `auth.role()` n'étaient jamais
créées, et **toutes** les migrations qui s'en servent comme valeur par défaut
échouaient à leur tour.

Corrigé le 31/08/2026. Rejeu vérifié après correction.

### 2.2 Ouvert — l'extension `vector` bloque 41 migrations sur 52

La migration `20260824130649` commence par :

```sql
create extension if not exists vector with schema extensions;
```

L'extension pgvector n'est pas disponible sur ce poste. La migration s'arrête
donc à sa **première ligne** — et c'est précisément elle qui crée dix schémas :
`ref`, `legal`, `capture`, `socle`, `coffre`, `agents`, `schedule`, `collab`,
`audit`, `sync`. Tout ce qui suit s'effondre en cascade : 41 migrations en
erreur, dont la totalité du plan comptable, du socle fiscal et du paramétrage.

Le paradoxe est que **plus personne n'a besoin de pgvector** : la seule table
qui portait une empreinte vectorielle, `legal.chunks`, a été supprimée par la
migration `20260830190000`, et le corpus juridique reconstruit ensuite ne porte
que du texte. La dépendance est morte, mais la ligne qui l'exige est toujours
en tête de chaîne.

Trois issues possibles, à arbitrer :

1. **Installer pgvector** sur le PostgreSQL du poste. Les migrations restent
   intactes, l'historique n'est pas réécrit. C'est la voie la plus propre si
   l'installation est possible sans chaîne de compilation.
2. **Retirer la dépendance morte** de `20260824130649` : la ligne `create
   extension`, la table `legal.chunks`, l'index HNSW — et, en regard, la partie
   de `20260830190000` qui les supprime. C'est une réécriture d'historique,
   assumée, cohérente avec R9 (rien de mort dans le dépôt).
3. **Conditionner la création de l'extension.** Écartée : ce serait exactement
   l'adaptation silencieuse que le chargeur actuel dit refuser.

## 3. Défauts secondaires

### 3.1 `app.platform_operators` : RLS active, aucune politique

La table est sous RLS sans aucune politique. Elle est donc refusée à tout le
monde sauf aux rôles qui contournent RLS (`postgres`, `service_role`). Si c'est
un refus par défaut voulu, il mérite d'être écrit noir sur blanc dans la
migration ; sinon, il manque une politique.

### 3.2 59 clés étrangères sans index

59 contraintes de clé étrangère n'ont aucun index les couvrant. Deux effets :
une jointure qui parcourt la table entière, et surtout une suppression ou une
mise à jour côté parent qui verrouille l'enfant en entier.

La plupart des tables concernées sont encore vides — le coût est aujourd'hui
nul. Il ne le restera pas. Les plus exposées, parce qu'elles portent déjà des
données :

| Table | Clé étrangère | Lignes |
|---|---|---|
| `capture.citations` | `token_id` | 97 000 |
| `socle.ecritures` | `entity_id`, `pack_version_id`, `reversal_reason_id`, `review_motif_id` | 7 760 |
| `capture.pieces` | `entity_id` | 4 200 |
| `audit.event_log` | `motif_id`, `pack_version_id` | 635 |

La liste complète est reproductible par la requête G du script d'audit.

### 3.3 Aucune trace des migrations appliquées

Il n'existe aucune table qui enregistre quelles migrations ont été jouées sur
une base. On ne peut donc pas répondre à « cette base est-elle à jour » sans
tout rejouer. À traiter une fois le point 2.2 arbitré.

## 4. Sauvegardes

Une sauvegarde complète a été prise avant toute intervention :
`db/sauvegardes/regalica_local_20260831_123448.dump` (18,2 Mo, format `custom`).
Le dossier `db/sauvegardes/` est exclu de git — un dump contient des données de
tenant, il n'a rien à faire dans un dépôt.

Restauration :

```
pg_restore -U postgres -h localhost -d regalica_local --clean --if-exists <fichier.dump>
```
