# Vérification du référentiel

Relevé du 2026-09-11 par `db/verification/comparer-referentiel.mjs`. Témoin : `malica_test`, montée par `npm run base-de-test` depuis les seules migrations du dépôt, juste avant la comparaison. Comparée : `malica_local`. Lecture seule des deux côtés.

**29 tables comparées, 2 en écart.** Chaque écart est détaillé plus bas ; tant qu'il n'est pas expliqué, la table n'est préservée que sous réserve.

Colonnes exclues de l'empreinte, parce que chaque chargement les fabrique à neuf : les UUID et les horodatages — rien d'autre. Une date de validité est une donnée, et se compare.

| Table                        | Lignes (travail) | Lignes (vierge) | Empreinte (travail) | Empreinte (vierge) | En plus | En moins |
| ---------------------------- | ---------------: | --------------: | ------------------- | ------------------ | ------: | -------: |
| `ref.account_mappings`       |               10 |              10 | `6ef08f0608e0`      | `6ef08f0608e0`     |       0 |        0 |
| `ref.account_roles`          |              160 |             160 | `f40821f7cb85`      | `f40821f7cb85`     |       0 |        0 |
| `ref.accounts`               |              626 |             626 | `f034f20a1209`      | `f034f20a1209`     |       0 |        0 |
| `ref.anomaly_thresholds`     |                1 |               1 | `3ae5100029ac`      | `3ae5100029ac`     |       0 |        0 |
| `ref.charge_famille_rules`   |               10 |              10 | `572608136620`      | `572608136620`     |       0 |        0 |
| `ref.charge_familles`        |                9 |               9 | `eeb3759d6e49`      | `eeb3759d6e49`     |       0 |        0 |
| `ref.document_types`         |               20 |              20 | `17381c7c1ff2`      | `17381c7c1ff2`     |       0 |        0 |
| `ref.entry_controls`         |                5 |               5 | `6b31f09f74b4`      | `6b31f09f74b4`     |       0 |        0 |
| `ref.entry_template_lines`   |              464 |             464 | `8abb75ac3490`      | `8abb75ac3490`     |       0 |        0 |
| `ref.entry_templates`        |              182 |             182 | `576804fa2bd1`      | `576804fa2bd1`     |       0 |        0 |
| `ref.fiscal_charges`         |                2 |               2 | `9cd61c635313`      | `9cd61c635313`     |       0 |        0 |
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
| `ref.rejet_motifs` **≠**     |                9 |               9 | `37bb960ab5d3`      | `a9d2d13c8811`     |       9 |        9 |
| `ref.role_bindings`          |              160 |             160 | `f694bed8ea54`      | `f694bed8ea54`     |       0 |        0 |
| `ref.socle_params`           |                6 |               6 | `bf8efcc38789`      | `bf8efcc38789`     |       0 |        0 |
| `ref.stock_categories`       |                5 |               5 | `28871f7c93df`      | `28871f7c93df`     |       0 |        0 |
| `ref.tva_rates`              |                5 |               5 | `58405cc2fd3f`      | `58405cc2fd3f`     |       0 |        0 |
| `agents.model_pricing` **≠** |                6 |               6 | `1fe9ba393865`      | `23ac5cce576d`     |       2 |        2 |
| `storage.buckets`            |                1 |               1 | `3cb602e6c5d1`      | `3cb602e6c5d1`     |       0 |        0 |
| `app.migrations`             |               95 |              95 | `cb23c78b299a`      | `cb23c78b299a`     |       0 |        0 |

## Les écarts, ligne par ligne

### `ref.rejet_motifs`

Colonnes comparées : `code`, `severity`, `requires_note`, `sort_order`, `active`, `valid_from`, `valid_to`.
Exclues : `id`.

**En plus dans `malica_local` (9)**

```
["piece_illisible","bloquant",false,10,true,"2026-08-30T23:00:00.000Z",null]
["montant_incoherent","bloquant",false,20,true,"2026-08-30T23:00:00.000Z",null]
["mention_legale_absente","bloquant",true,30,true,"2026-08-30T23:00:00.000Z",null]
["taux_tva_inapproprie","bloquant",false,40,true,"2026-08-30T23:00:00.000Z",null]
["non_deductible","bloquant",true,50,true,"2026-08-30T23:00:00.000Z",null]
["doublon","bloquant",false,60,true,"2026-08-30T23:00:00.000Z",null]
["hors_exercice","bloquant",false,70,true,"2026-08-30T23:00:00.000Z",null]
["justificatif_manquant","avertissement",true,80,true,"2026-08-30T23:00:00.000Z",null]
["imputation_a_revoir","avertissement",true,90,true,"2026-08-30T23:00:00.000Z",null]
```

**Absentes de `malica_local` (9)**

```
["piece_illisible","bloquant",false,10,true,"2026-09-10T23:00:00.000Z",null]
["montant_incoherent","bloquant",false,20,true,"2026-09-10T23:00:00.000Z",null]
["mention_legale_absente","bloquant",true,30,true,"2026-09-10T23:00:00.000Z",null]
["taux_tva_inapproprie","bloquant",false,40,true,"2026-09-10T23:00:00.000Z",null]
["non_deductible","bloquant",true,50,true,"2026-09-10T23:00:00.000Z",null]
["doublon","bloquant",false,60,true,"2026-09-10T23:00:00.000Z",null]
["hors_exercice","bloquant",false,70,true,"2026-09-10T23:00:00.000Z",null]
["justificatif_manquant","avertissement",true,80,true,"2026-09-10T23:00:00.000Z",null]
["imputation_a_revoir","avertissement",true,90,true,"2026-09-10T23:00:00.000Z",null]
```

### `agents.model_pricing`

Colonnes comparées : `provider`, `model`, `role`, `price_in_per_mtok`, `price_out_per_mtok`, `currency`, `sovereign`, `effective_from`, `effective_to`.
Exclues : `id`, `created_at`.

**En plus dans `malica_local` (2)**

```
["lovable","google/gemini-2.5-flash","vision","0.300","2.500","USD",false,"2025-12-31T23:00:00.000Z","2026-08-30T23:00:00.000Z"]
["interne","pdf-text","vision","0.000","0.000","USD",true,"2026-08-30T23:00:00.000Z",null]
```

**Absentes de `malica_local` (2)**

```
["lovable","google/gemini-2.5-flash","vision","0.300","2.500","USD",false,"2025-12-31T23:00:00.000Z","2026-09-10T23:00:00.000Z"]
["interne","pdf-text","vision","0.000","0.000","USD",true,"2026-09-10T23:00:00.000Z",null]
```

## Lecture des écarts — 11 septembre 2026

_Section écrite à la main pour ce relevé ; une nouvelle exécution du script la remplace._

**Les deux écarts sont expliqués. Ni l'un ni l'autre ne vient d'une retouche manuelle ou d'un test : ils viennent de migrations qui font entrer dans le référentiel la date du jour où on les joue.** Sur `malica_local`, ces migrations ont été jouées le 31 août 2026 ; sur le témoin, le jour du relevé. Mêmes fichiers, mêmes empreintes dans `app.migrations`, deux contenus.

- **`ref.rejet_motifs`** — 9 lignes, forme **cachée**. La table déclare `valid_from date not null default current_date` (`20260824130649`), et la migration `20260824132104` sème les 9 motifs sans donner `valid_from`. Les 9 motifs sont valides à partir du 31 août en local, et à partir du jour de la migration sur toute base montée plus tard. Codes, sévérités, ordre : identiques.
- **`agents.model_pricing`** — 2 lignes, forme **écrite**, dans `20260826163000` : `effective_to = current_date` sur le tarif Gemini, `effective_from = current_date` sur le tarif `pdf-text`. Prix, rôles, devises : identiques.

La ligne qui compte pour le corpus — `qwen3.7-text-embedding`, cible de `legal.chunks.pricing_id` pour les 31 863 fragments — est identique des deux côtés.

**Conclusion.** Les 27 autres tables sont identiques, dont `ref.accounts` : les deux fichiers `db/seed/plan_comptable_tn_*.sql` n'ont soit jamais été appliqués, soit rien ajouté, et il n'y a rien à recharger. `ref` est préservé, **sous une réserve connue et expliquée** : les dates de validité de ces 11 lignes dépendent du jour d'application. Conséquence concrète : sur une base montée plus tard, les motifs de rejet ne seraient valides qu'à partir de ce jour-là, et une recherche par date antérieure ne les trouverait pas. La correction serait une migration nouvelle, qui écrit ces dates en littéral — elle n'est pas faite ici.

**Correctif.** Le premier relevé de ce jour (commit `b438b74`) annonçait 28 tables sur 29 identiques. C'était faux : le comparateur écartait toute colonne dont le défaut est la date du chargement, et masquait `ref.rejet_motifs`. Il n'écarte plus que les UUID et les horodatages (commit `5c38ada`).

La règle qui interdit désormais ces deux formes est R11 (`AGENTS.md`), vérifiée par `db/reproductibilite.test.mjs` dans `npm test`.
