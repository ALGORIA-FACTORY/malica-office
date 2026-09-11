# Vérification du référentiel

Relevé du 2026-09-11 par `db/verification/comparer-referentiel.mjs`. Témoin : `malica_test`, montée par `npm run base-de-test` depuis les seules migrations du dépôt, juste avant la comparaison. Comparée : `malica_local`. Lecture seule des deux côtés.

**29 tables comparées, 1 en écart.** Chaque écart est détaillé plus bas ; tant qu'il n'est pas expliqué, la table n'est préservée que sous réserve.

Colonnes exclues de l'empreinte, parce que chaque chargement les fabrique à neuf : les UUID, les horodatages, et toute colonne dont le défaut est la date ou l'heure du chargement.

| Table                        | Lignes (travail) | Lignes (vierge) | Empreinte (travail) | Empreinte (vierge) | En plus | En moins |
| ---------------------------- | ---------------: | --------------: | ------------------- | ------------------ | ------: | -------: |
| `ref.account_mappings`       |               10 |              10 | `6ef08f0608e0`      | `6ef08f0608e0`     |       0 |        0 |
| `ref.account_roles`          |              160 |             160 | `f40821f7cb85`      | `f40821f7cb85`     |       0 |        0 |
| `ref.accounts`               |              626 |             626 | `f034f20a1209`      | `f034f20a1209`     |       0 |        0 |
| `ref.anomaly_thresholds`     |                1 |               1 | `c73104f2e66d`      | `c73104f2e66d`     |       0 |        0 |
| `ref.charge_famille_rules`   |               10 |              10 | `91623a52f52a`      | `91623a52f52a`     |       0 |        0 |
| `ref.charge_familles`        |                9 |               9 | `0b2826362fc2`      | `0b2826362fc2`     |       0 |        0 |
| `ref.document_types`         |               20 |              20 | `17381c7c1ff2`      | `17381c7c1ff2`     |       0 |        0 |
| `ref.entry_controls`         |                5 |               5 | `6b31f09f74b4`      | `6b31f09f74b4`     |       0 |        0 |
| `ref.entry_template_lines`   |              464 |             464 | `8abb75ac3490`      | `8abb75ac3490`     |       0 |        0 |
| `ref.entry_templates`        |              182 |             182 | `576804fa2bd1`      | `576804fa2bd1`     |       0 |        0 |
| `ref.fiscal_charges`         |                2 |               2 | `cf99384195e5`      | `cf99384195e5`     |       0 |        0 |
| `ref.fiscal_obligations`     |               43 |              43 | `017f5150b968`      | `017f5150b968`     |       0 |        0 |
| `ref.fiscal_parameters`      |              454 |             454 | `9d8253f5b548`      | `9d8253f5b548`     |       0 |        0 |
| `ref.fiscal_scale_brackets`  |                8 |               8 | `83f3c2229db7`      | `83f3c2229db7`     |       0 |        0 |
| `ref.immo_categories`        |                7 |               7 | `fbaf2ed2404f`      | `fbaf2ed2404f`     |       0 |        0 |
| `ref.journals`               |                4 |               4 | `01cd9656b8d6`      | `01cd9656b8d6`     |       0 |        0 |
| `ref.jurisdiction_packs`     |                1 |               1 | `8cd55e4ded80`      | `8cd55e4ded80`     |       0 |        0 |
| `ref.labels`                 |              108 |             108 | `7f689c832691`      | `7f689c832691`     |       0 |        0 |
| `ref.mentions`               |               12 |              12 | `c8441f6df423`      | `c8441f6df423`     |       0 |        0 |
| `ref.pack_rules`             |                6 |               6 | `a405fd7218b3`      | `a405fd7218b3`     |       0 |        0 |
| `ref.regimes_fiscaux`        |                5 |               5 | `a06c7b3081b0`      | `a06c7b3081b0`     |       0 |        0 |
| `ref.rejet_motifs`           |                9 |               9 | `e75bb36f8a4c`      | `e75bb36f8a4c`     |       0 |        0 |
| `ref.role_bindings`          |              160 |             160 | `f694bed8ea54`      | `f694bed8ea54`     |       0 |        0 |
| `ref.socle_params`           |                6 |               6 | `bf8efcc38789`      | `bf8efcc38789`     |       0 |        0 |
| `ref.stock_categories`       |                5 |               5 | `28871f7c93df`      | `28871f7c93df`     |       0 |        0 |
| `ref.tva_rates`              |                5 |               5 | `58405cc2fd3f`      | `58405cc2fd3f`     |       0 |        0 |
| `agents.model_pricing` **≠** |                6 |               6 | `64f5d7661773`      | `63af335023d7`     |       1 |        1 |
| `storage.buckets`            |                1 |               1 | `3cb602e6c5d1`      | `3cb602e6c5d1`     |       0 |        0 |
| `app.migrations`             |               94 |              94 | `ec835829e574`      | `ec835829e574`     |       0 |        0 |

## Les écarts, ligne par ligne

### `agents.model_pricing`

Colonnes comparées : `provider`, `model`, `role`, `price_in_per_mtok`, `price_out_per_mtok`, `currency`, `sovereign`, `effective_to`.
Exclues : `id`, `effective_from`, `created_at`.

**En plus dans `malica_local` (1)**

```
["lovable","google/gemini-2.5-flash","vision","0.300","2.500","USD",false,"2026-08-30T23:00:00.000Z"]
```

**Absentes de `malica_local` (1)**

```
["lovable","google/gemini-2.5-flash","vision","0.300","2.500","USD",false,"2026-09-10T23:00:00.000Z"]
```

## Lecture de l'écart — 11 septembre 2026

_Section écrite à la main pour ce relevé ; une nouvelle exécution du script la remplace._

**L'écart de `agents.model_pricing` est expliqué : ce n'est ni une retouche manuelle, ni l'œuvre d'un test.** La migration `20260826163000_tarifs_lecture_apres_bascule_qwen.sql` clôt le tarif Gemini par :

```sql
update agents.model_pricing set effective_to = current_date
 where provider = 'lovable' and model = 'google/gemini-2.5-flash' and role = 'vision' and effective_to is null;
```

`current_date` est la date du jour où la migration est **jouée**. Sur `malica_local`, elle l'a été le 31 août 2026 (`2026-08-30T23:00:00Z` en UTC) ; sur le témoin, le jour du relevé. Même instruction, même fichier (empreintes identiques dans `app.migrations`), deux dates. La ligne ne diffère que par cette colonne.

La ligne qui compte pour le corpus — `qwen3.7-text-embedding`, cible de `legal.chunks.pricing_id` pour les 31 863 fragments — est identique des deux côtés.

**Conclusion.** Les 29 tables du référentiel sont préservées sans réserve. En particulier `ref.accounts` est identique à ce que produisent les migrations : les deux fichiers `db/seed/plan_comptable_tn_*.sql` n'ont soit jamais été appliqués, soit rien ajouté. Il n'y a donc rien à recharger.

Une remarque pour plus tard, hors de cette étape : une migration qui écrit `current_date` dans une donnée de référence produit un référentiel qui dépend du jour où on la joue. C'est sans conséquence ici (le tarif Gemini n'est plus utilisé), mais la règle mérite d'être écrite.
