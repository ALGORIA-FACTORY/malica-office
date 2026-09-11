# Vérification du référentiel

Relevé du 2026-09-11 par `db/verification/comparer-referentiel.mjs`. Témoin : `malica_test`, montée par `npm run base-de-test` depuis les seules migrations du dépôt, juste avant la comparaison. Comparée : `malica_local`. Lecture seule des deux côtés.

**29 tables comparées, 27 identiques, 2 en écart, dont 0 non expliqué(s).**

Chaque écart est expliqué plus bas. Les tables en écart sont préservées sous une réserve connue.

| Table                             | Lignes (travail) | Lignes (vierge) | Empreinte (travail) | Empreinte (vierge) | En plus | En moins |
| --------------------------------- | ---------------: | --------------: | ------------------- | ------------------ | ------: | -------: |
| `ref.account_mappings`            |               10 |              10 | `d38a9cab0c14`      | `d38a9cab0c14`     |       0 |        0 |
| `ref.account_roles`               |              160 |             160 | `65e50de2e986`      | `65e50de2e986`     |       0 |        0 |
| `ref.accounts`                    |              626 |             626 | `3d63f558806c`      | `3d63f558806c`     |       0 |        0 |
| `ref.anomaly_thresholds`          |                1 |               1 | `fdc2254273f3`      | `fdc2254273f3`     |       0 |        0 |
| `ref.charge_famille_rules`        |               10 |              10 | `2540e41b77ab`      | `2540e41b77ab`     |       0 |        0 |
| `ref.charge_familles`             |                9 |               9 | `fae120b2508a`      | `fae120b2508a`     |       0 |        0 |
| `ref.document_types`              |               20 |              20 | `118a063d3a56`      | `118a063d3a56`     |       0 |        0 |
| `ref.entry_controls`              |                5 |               5 | `8fdb23c4f890`      | `8fdb23c4f890`     |       0 |        0 |
| `ref.entry_template_lines`        |              464 |             464 | `9a6d7254d7e3`      | `9a6d7254d7e3`     |       0 |        0 |
| `ref.entry_templates`             |              182 |             182 | `a479d9952da3`      | `a479d9952da3`     |       0 |        0 |
| `ref.fiscal_charges`              |                2 |               2 | `7789e36ac12a`      | `7789e36ac12a`     |       0 |        0 |
| `ref.fiscal_obligations`          |               43 |              43 | `e85f4f4113e7`      | `e85f4f4113e7`     |       0 |        0 |
| `ref.fiscal_parameters`           |              454 |             454 | `4db74f38dd6a`      | `4db74f38dd6a`     |       0 |        0 |
| `ref.fiscal_scale_brackets`       |                8 |               8 | `e44cfb0cbf41`      | `e44cfb0cbf41`     |       0 |        0 |
| `ref.immo_categories`             |                7 |               7 | `e78038c51377`      | `e78038c51377`     |       0 |        0 |
| `ref.journals`                    |                4 |               4 | `01cd9656b8d6`      | `01cd9656b8d6`     |       0 |        0 |
| `ref.jurisdiction_packs`          |                1 |               1 | `6b3431922848`      | `6b3431922848`     |       0 |        0 |
| `ref.labels`                      |              108 |             108 | `7f689c832691`      | `7f689c832691`     |       0 |        0 |
| `ref.mentions`                    |               12 |              12 | `bc10e3bc75a6`      | `bc10e3bc75a6`     |       0 |        0 |
| `ref.pack_rules`                  |                6 |               6 | `7e3fb39baf82`      | `7e3fb39baf82`     |       0 |        0 |
| `ref.regimes_fiscaux`             |                5 |               5 | `cfa2959f9161`      | `cfa2959f9161`     |       0 |        0 |
| `ref.rejet_motifs` ≠ expliqué     |                9 |               9 | `7efaccd54a2f`      | `887ddf913e0f`     |       9 |        9 |
| `ref.role_bindings`               |              160 |             160 | `0e5c76eba77a`      | `0e5c76eba77a`     |       0 |        0 |
| `ref.socle_params`                |                6 |               6 | `ffff0708d72a`      | `ffff0708d72a`     |       0 |        0 |
| `ref.stock_categories`            |                5 |               5 | `4d2e53ea0fe2`      | `4d2e53ea0fe2`     |       0 |        0 |
| `ref.tva_rates`                   |                5 |               5 | `64098f94f4be`      | `64098f94f4be`     |       0 |        0 |
| `agents.model_pricing` ≠ expliqué |                6 |               6 | `5bb0b58d460d`      | `957ac534c8b9`     |       2 |        2 |
| `storage.buckets`                 |                1 |               1 | `08a583bb1f90`      | `08a583bb1f90`     |       0 |        0 |
| `app.migrations`                  |               95 |              95 | `cb23c78b299a`      | `cb23c78b299a`     |       0 |        0 |

## Les écarts

### `ref.rejet_motifs` — expliqué

Forme **cachée** de R11. La table déclare `valid_from date not null default current_date` (`20260824130649`), et `20260824132104` sème les 9 motifs sans donner `valid_from` : chaque base reçoit la date du jour où elle joue la migration — le 31 août 2026 pour `malica_local`. Codes, sévérités, ordre : identiques.

**En plus dans `malica_local` (9)**, colonnes `code`, `severity`, `requires_note`, `sort_order`, `active`, `valid_from`, `valid_to` :

```
["piece_illisible","bloquant","false","10","true","2026-08-31",null]
["montant_incoherent","bloquant","false","20","true","2026-08-31",null]
["mention_legale_absente","bloquant","true","30","true","2026-08-31",null]
["taux_tva_inapproprie","bloquant","false","40","true","2026-08-31",null]
["non_deductible","bloquant","true","50","true","2026-08-31",null]
["doublon","bloquant","false","60","true","2026-08-31",null]
["hors_exercice","bloquant","false","70","true","2026-08-31",null]
["justificatif_manquant","avertissement","true","80","true","2026-08-31",null]
["imputation_a_revoir","avertissement","true","90","true","2026-08-31",null]
```

**Absentes de `malica_local` (9)**, colonnes `code`, `severity`, `requires_note`, `sort_order`, `active`, `valid_from`, `valid_to` :

```
["piece_illisible","bloquant","false","10","true","2026-09-11",null]
["montant_incoherent","bloquant","false","20","true","2026-09-11",null]
["mention_legale_absente","bloquant","true","30","true","2026-09-11",null]
["taux_tva_inapproprie","bloquant","false","40","true","2026-09-11",null]
["non_deductible","bloquant","true","50","true","2026-09-11",null]
["doublon","bloquant","false","60","true","2026-09-11",null]
["hors_exercice","bloquant","false","70","true","2026-09-11",null]
["justificatif_manquant","avertissement","true","80","true","2026-09-11",null]
["imputation_a_revoir","avertissement","true","90","true","2026-09-11",null]
```

### `agents.model_pricing` — expliqué

Forme **écrite** de R11, dans `20260826163000` : `effective_to = current_date` sur le tarif Gemini, `effective_from = current_date` sur le tarif `pdf-text`. Prix, rôles, devises : identiques. La ligne `qwen3.7-text-embedding`, cible de `legal.chunks.pricing_id`, est identique.

**En plus dans `malica_local` (2)**, colonnes `provider`, `model`, `role`, `price_in_per_mtok`, `price_out_per_mtok`, `currency`, `sovereign`, `effective_from`, `effective_to` :

```
["lovable","google/gemini-2.5-flash","vision","0.300","2.500","USD","false","2026-01-01","2026-08-31"]
["interne","pdf-text","vision","0.000","0.000","USD","true","2026-08-31",null]
```

**Absentes de `malica_local` (2)**, colonnes `provider`, `model`, `role`, `price_in_per_mtok`, `price_out_per_mtok`, `currency`, `sovereign`, `effective_from`, `effective_to` :

```
["lovable","google/gemini-2.5-flash","vision","0.300","2.500","USD","false","2026-01-01","2026-09-11"]
["interne","pdf-text","vision","0.000","0.000","USD","true","2026-09-11",null]
```

## Ce qui n'est pas comparé, et pourquoi

Une exclusion est nominative et justifiée : chaque colonne est nommée ci-dessous avec sa raison. Toute colonne absente de cette liste est comparée.

| Colonne exclue                      | Raison                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `agents.model_pricing.id`           | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `agents.model_pricing.created_at`   | horodatage du chargement : `now()`, ne porte aucun contenu                      |
| `app.migrations.applique_le`        | horodatage de l'application de la migration sur CETTE base                      |
| `ref.account_mappings.id`           | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.accounts.id`                   | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.anomaly_thresholds.id`         | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.charge_famille_rules.id`       | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.charge_familles.id`            | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.document_types.created_at`     | horodatage du chargement : `now()`, ne porte aucun contenu                      |
| `ref.fiscal_charges.id`             | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.fiscal_obligations.id`         | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.fiscal_parameters.id`          | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.immo_categories.id`            | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.jurisdiction_packs.id`         | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.jurisdiction_packs.created_at` | horodatage du chargement : `now()`, ne porte aucun contenu                      |
| `ref.labels.id`                     | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.mentions.id`                   | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.pack_rules.id`                 | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.regimes_fiscaux.id`            | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.rejet_motifs.id`               | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.socle_params.id`               | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.stock_categories.id`           | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `ref.stock_categories.created_at`   | horodatage du chargement : `now()`, ne porte aucun contenu                      |
| `ref.tva_rates.id`                  | clé technique : `gen_random_uuid()` à chaque chargement, ne porte aucun contenu |
| `storage.buckets.created_at`        | horodatage du chargement : `now()`, ne porte aucun contenu                      |

Et 13 colonnes **traduites**, pas exclues : chaque `pack_version_id` est comparé par la clé naturelle du pack qu'il désigne (`juridiction/version`), puisque l'UUID du pack est tiré au chargement.

R11 (`AGENTS.md`) interdit désormais les deux formes d'écart relevées ici ; `db/reproductibilite.test.mjs` le vérifie dans `npm test`.
