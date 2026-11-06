# Audit de la base — inventaire et preuves (6 novembre 2026)

Vague d'inventaire : **rien n'est corrigé ici**. Chaque constat porte la requête
qui l'établit et son résultat compté. Aucune migration n'est ajoutée à
`db/migrations/` ; celles qui sont proposées (§ 6) sont écrites pour la vague
suivante.

## 0. Méthode

|                  |                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branche auditée  | `audit/db`, partie de `origin/claude/mission-production-ready` à `eb004c1c`                                                                              |
| Comparée à       | `origin/main` à `12a9acec` (base commune `93c4c708`)                                                                                                     |
| Base             | `malica_inventaire`, jetable, PostgreSQL 17 local, montée par `node db/migrer.mjs --base …` : **355 migrations, 355 jouées, 0 erreur**                   |
| Bases fusionnées | union des migrations de la branche et de `main` (378 fichiers), jouée dans `malica_inventaire` recréée — trois scénarios, § 4 et § 5                     |
| Code lu          | 1 627 fichiers suivis par git (hors `db/migrations/`, `docs/`, `*.md`) ; « tests » = chemin contenant `.test.`, `__tests__`, `tests/`, `banc`, `epreuve` |

Aucune autre base n'a été ouverte (ni `malica_test`, ni `malica_local`, ni
staging, ni production). Les scripts de mesure (lecture seule sur
`malica_inventaire`) ne sont pas versionnés ; leurs requêtes sont recopiées ici.

**Ce qu'une base neuve ne peut pas dire** : l'usage réel des index
(`pg_stat_user_indexes` est vide), le volume des tables, et l'état des
schémas d'amorçage en production. Ces points sont marqués **INCERTAIN**, avec la
requête à jouer sur la base vivante.

---

## 1. Inventaire

```sql
select n.nspname,
  count(*) filter (where c.relkind in ('r','p')) tables,
  count(*) filter (where c.relkind = 'v') vues,
  count(*) filter (where c.relkind = 'i') index,
  count(*) filter (where c.relkind in ('r','p') and c.relrowsecurity) rls,
  count(*) filter (where c.relkind in ('r','p') and c.relforcerowsecurity) force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog','information_schema','pg_toast') group by 1;
```

| schéma                                                |   tables |           RLS | FORCE |    vues |                              index |                                                                                 fonctions (definer) | politiques | déclencheurs |
| ----------------------------------------------------- | -------: | ------------: | ----: | ------: | ---------------------------------: | --------------------------------------------------------------------------------------------------: | ---------: | -----------: |
| ref                                                   |       85 |            85 |    77 |       0 |                                163 |                                                                                              10 (1) |         86 |            5 |
| facturation                                           |       24 |            24 |    10 |      17 |                                 87 |                                                                                             40 (34) |         42 |           35 |
| capture                                               |       20 |            20 |    20 |       0 |                                 99 |                                                                                               6 (3) |         56 |           58 |
| collab                                                |       17 |            17 |    16 |       0 |                                 57 |                                                                                               3 (1) |         76 |           26 |
| fabrique                                              |       13 |            13 |    13 |       2 |                                 57 |                                                                                             26 (16) |         33 |           30 |
| legal                                                 |       12 |            10 |    10 |       0 |                                 26 |                                                                                               1 (0) |         10 |            0 |
| plateforme                                            |       11 |            11 |     6 |       5 |                                 20 |                                                                                             24 (23) |         22 |           12 |
| identity                                              |       10 |            10 |    10 |       1 |                                 27 |                                                                                               6 (2) |         36 |           19 |
| agents                                                |        8 |             8 |     7 |       1 |                                 24 |                                                                                               2 (1) |         24 |           13 |
| parametrage                                           |        8 |             8 |     8 |       0 |                                 31 |                                                                                               1 (1) |         24 |           15 |
| banque                                                |        5 |             5 |     5 |       0 |                                 22 |                                                                                                   — |         29 |           10 |
| observabilite                                         |        5 |             5 |     5 |       1 |                                 11 |                                                                                               9 (4) |         10 |            — |
| app                                                   |        4 |             3 |     2 |       0 |                                  8 |                                                                                           171 (120) |          3 |            1 |
| audit, immo, stocks, notif                            | 4 chacun |             4 |   3–4 |     0–1 |                              10–20 |                                                                                                   — |       5–22 |         2–10 |
| auth                                                  |        3 |         **0** |     0 |       0 |                                  8 |                                                                                                   2 |          0 |            0 |
| billing, socle                                        |        3 |             3 |     3 |       0 |                              10–20 |                                                                                               3 (3) |      12–19 |         6–15 |
| pricing, commissions, storage                         |        2 | 2 (storage 0) |     — |       0 |                                3–6 |                                                                                                   — |       3–10 |            — |
| catalog, coffre, contracts, payments, schedule, tiers |        1 |             1 |     1 |       0 |                                2–5 |                                                                                                 0–1 |        5–6 |          1–2 |
| public                                                |        0 |             — |     — |  **82** |                                  0 |                                                                                           373 (169) |          — |            — |
| **Total branche**                                     |  **259** |           251 |   220 | **110** | **765** (420 uniques, 56 partiels) | **686** hors schéma `extensions` (dont 188 de `btree_gist` posées dans `public`, soit 498 du dépôt) |    **589** |          289 |
| **Total fusionné** (branche + main)                   |      263 |               |       |     111 |                                778 |                                                                                                 726 |        593 |              |

Rôles : `malica_api` (seul rôle de connexion applicatif, sans `bypassrls`,
membre d'`authenticated`), `portier` (100 portes `security definer`), `greffier`
(4), `malica_exploitation`, `authenticated`, `anon`, `service_role`
(`nologin bypassrls`), `postgres`. Fonctions `security definer` par
propriétaire : `postgres` 282, `portier` 100, `greffier` 4 ; **0** sans
`search_path` fixé. Extensions : `btree_gist` (dans `public`), `pgcrypto` et
`vector` (dans `extensions`).

Notables : `public` ne porte que des vues (82) et des portes ; `app` concentre
171 fonctions dont 120 `security definer` ; `socle.ecritures` (26 colonnes) et
`facturation.factures` (24) sont les tables les plus larges.

---

## 2. Isolation (R6)

| contrôle                                                                                                                                                  | requête (résumée)                                                                                 |                                                                                                                                                                                               résultat |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| Table sous RLS portant `tenant_id` **sans index menant par `tenant_id`** — élargi à toute politique, pas seulement au helper que vérifie `schema.test.ts` | `relrowsecurity and exists(attname='tenant_id') and not exists(pg_index … indkey[0] = tenant_id)` |                                                                                                                                                                                                  **0** |
| Table hors catalogues **sans RLS**                                                                                                                        | `relkind in ('r','p') and not relrowsecurity`                                                     |                                        8 : `app.migrations`, `auth.users`, `auth.refresh_tokens`, `auth.reinitialisations`, `legal.banque_cas`, `legal.sondages`, `storage.buckets`, `storage.objects` |
| … dont portant une colonne de tenant (`tenant_id`, `organization_id`, `org_id`, `dossier_id`, `cabinet_id`, `user_id`)                                    | idem, joint à `pg_attribute`                                                                      | 2 : `auth.refresh_tokens`, `auth.reinitialisations` (`user_id`) — lisibles et écrivables par `malica_api` seul, aucun droit à `authenticated` : **pas une fuite**, c'est le guichet d'authentification |
| Table sous RLS sans aucune politique (refus total)                                                                                                        | `relrowsecurity and not exists(pg_policy)`                                                        |                                                                            3 : `app.operateurs_attendus`, `app.platform_operators`, `capture.effacements_en_cours` (voulu : lues par portes seulement) |
| Table sous RLS **sans FORCE**                                                                                                                             | `relrowsecurity and not relforcerowsecurity`                                                      |                                                                                                   31 (propriétaire `postgres`), surtout `facturation.*` (14), `plateforme.reglages_*` (4), `ref.*` (8) |
| Vue **sans `security_invoker`**                                                                                                                           | `relkind='v' and not reloptions @> '{security_invoker=true}'`                                     |                                                                                                                                                        **1 / 110** : `facturation.pieces_orphelines_v` |
| Relation lisible par `anon` ou `PUBLIC`                                                                                                                   | `has_table_privilege('anon',…) or aclexplode(…).grantee = 0`                                      |                                                                                                                                                                                                  **0** |
| Relation écrivable par `authenticated`/`anon` (INSERT/UPDATE/DELETE/TRUNCATE)                                                                             | `aclexplode(relacl) where grantee in (authenticated, anon)`                                       |                                                                                                                                                                                                  **0** |
| Fonction `security definer` exécutable par `PUBLIC`                                                                                                       | `prosecdef and aclexplode(coalesce(proacl, acldefault('f',…))).grantee = 0`                       |                                             2 : `capture.un_reglement_dit_vrai()`, `capture.un_reglement_eteint_le_non_paye()` — fonctions de déclencheur, non appelables directement : **sans effet** |

Lecture :

- **L'isolation tient.** Aucune table de tenant sans RLS, aucune sans index de
  tenant, aucune écriture directe, aucun accès `anon`.
- **FORCE manquant (31 tables)** : sans conséquence tant que `malica_api`
  n'est propriétaire de rien (vérifié : `rel_possedees = 0`) et que les portes
  appartiennent à `postgres`, superutilisateur — qui contourne la RLS **avec
  ou sans** FORCE. FORCE ne protège donc rien ici ; à noter seulement par
  cohérence (77/85 en `ref`).
- **`facturation.pieces_orphelines_v`** est une vue _definer_ (propriétaire
  `postgres`) sur `capture.pieces` × `identity.memberships`, tous tenants
  confondus. Aucun droit accordé (`information_schema.role_table_grants` : seul
  `postgres`) ; aucun lecteur dans le code. Risque latent : un `grant select`
  futur ouvrirait toutes les pièces orphelines de tous les tenants. → § 6, M2.

---

## 3. Objets morts

Méthode (script `mort`) : un objet est **mort** si son nom, en mot entier,
n'apparaît ni dans le code suivi (hors `db/migrations/`), ni dans une définition
vivante du catalogue (corps de fonction, vue, politique, déclencheur, défaut,
contrainte — hors celles de sa propre table). Il est **« tests seulement »** s'il
n'apparaît que dans des fichiers de test. La correspondance par nom produit
des **faux négatifs** (un nom générique — `id`, `created_at` — paraît toujours
lu) et rarement des faux positifs (un nom composé à l'exécution).

### 3.1 Relations mortes — 11

| relation                            | genre                    | défini par     | droits               | dépendants |
| ----------------------------------- | ------------------------ | -------------- | -------------------- | ---------: |
| `public.ref_pack_rules_v`           | vue                      | 20260824132104 | authenticated:SELECT |          0 |
| `public.ref_charge_famille_rules_v` | vue                      | 20260826141710 | authenticated:SELECT |          0 |
| `public.banque_rapprochements_v`    | vue                      | 20260825213940 | authenticated:SELECT |          0 |
| `public.agents_model_pricing_v`     | vue                      | 20260825235433 | authenticated:SELECT |          0 |
| `public.conformite_v`               | vue                      | 20260824133728 | authenticated:SELECT |          0 |
| `public.ref_grille_relations_v`     | vue                      | 20261105110000 | authenticated:SELECT |          0 |
| `agents.angles_morts`               | vue                      | 20260901190000 | authenticated:SELECT |          0 |
| `facturation.pieces_orphelines_v`   | vue **definer**          | 20261018110000 | aucun                |          0 |
| `facturation.payeur_courant_v`      | vue (lit `CURRENT_DATE`) | 20261020110000 | authenticated:SELECT |          0 |
| `facturation.repartition_v`         | vue (lit `CURRENT_DATE`) | 20261020110000 | authenticated:SELECT |          0 |
| `ref.entry_controls`                | **table, 5 lignes**      | 20260831120300 | authenticated:SELECT |          0 |

Preuve grep (script `grep`, mot entier, fichiers suivis) : pour chacune,
`code: -` ; seules des migrations (1 à 3) et parfois des docs les nomment.
Preuve catalogue : `select count(*) from pg_depend d join pg_rewrite rw on
rw.oid = d.objid where d.refobjid = <rel> and rw.ev_class <> <rel>` = 0 pour les 11.

`ref.entry_controls` mérite une décision plutôt qu'un retrait : ses 5 lignes
énoncent des contrôles normatifs (NC 41 §26, NC 03 §25, NC 03 §06, NC 11 §17,
« liaison obligatoire ») que **rien n'applique depuis la table** — ni fonction,
ni code. Soit ils sont appliqués ailleurs en dur (contraire à R4), soit ils ne
le sont pas.

« Tests seulement » — 6 : `public.reglages_cabinet_v`, `public.agent_runs_v`,
`plateforme.reclamations_v`, `plateforme.archives`, `legal.corpus_vigueur`,
`app.operateurs_attendus`.

### 3.2 Schémas d'amorçage morts — 7 schémas, 11 tables

`billing` (3), `catalog` (1), `pricing` (2), `commissions` (2), `payments` (1),
`contracts` (1), `coffre` (1). Chacune : RLS, 3–5 politiques, 1–3
déclencheurs, `authenticated:SELECT`, **0 ligne** sur base neuve, aucun lecteur
hors `db/maintenance/purge_metier.sql`. Leurs seules clés étrangères entrantes
viennent d'elles-mêmes (8, ex. `payments.payments → billing.invoices`). Le
verrou d'intégrité nomme déjà `billing.next_invoice_number` comme « DETTE :
schéma billing de l'amorçage … retrait à trancher (données) ».

```sql
select c.oid::regclass, (select count(*) from pg_constraint x where x.confrelid = c.oid)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('billing','catalog','pricing','commissions','payments','contracts','coffre')
  and c.relkind = 'r';                                   -- 11 lignes
select (select count(*) from billing.invoices), …, (select count(*) from coffre.objects);  -- 0 partout
```

**INCERTAIN** : les volumes en production. À vérifier par la même requête de
comptage sur la base vivante avant tout retrait.

### 3.3 Fonctions mortes — 2 sur 498 (hors extensions)

| fonction                                       | droits                                   | lit                                    |
| ---------------------------------------------- | ---------------------------------------- | -------------------------------------- |
| `ref.parametre_fiscal(text,text,date)`         | défaut : `PUBLIC` EXECUTE (`proacl` nul) | `ref.fiscal_parameters` (454 lignes)   |
| `ref.appliquer_bareme(text,text,date,numeric)` | défaut : `PUBLIC` EXECUTE                | `ref.fiscal_scale_brackets` (8 lignes) |

Aucun appelant (code, autre fonction, politique, déclencheur, vue) ;
`pg_depend` sur elles : 0. `parametre_fiscal` lève encore un message français
brut et renvoie vers `ref.parametre_fiscal_texte`, **qui n'existe pas**. Aucune
fonction de déclencheur non attachée (requête 5c : 0).

### 3.4 Colonnes mortes — 54 (et 7 « tests seulement ») sur 2 272

Jamais nommées hors de leur DDL. Deux familles :

**Colonnes métier jamais branchées** (retrait possible) :
`agents.budgets.per_piece_cost_cap`, `agents.budgets.per_piece_latency_ms`,
`ref.fiscal_parameters.valeur_texte`, `ref.fiscal_scale_brackets.borne_min`,
`facturation.encaissements.annule_id` (uuid avec FK, jamais écrite),
`notif.gabarits.corps_html`, `notif.preferences.push_actif`,
`legal.documents.{pages_sans_texte, langue_mesuree, langue_annoncee, besoin_ocr, origine_texte}`,
`legal.articles_extraits.{offset_debut, offset_fin}`,
`legal.references_extraites.{type_ref, corpus_ref}`, `legal.article_versions.open_issues`,
`legal.ingestion_queue.url_fiche`, `legal.sondages.langue_attendue`,
`legal.banque_cas.{reponse_attendue, vaut_au, validee_par, validee_le}`,
plus les 9 des schémas d'amorçage (`billing.*`, `catalog.products.sku`,
`commissions.entries.*`, `payments.payments.value_date`, `pricing.prices.price_list_id`).

**Colonnes de provenance** (qui/quand, remplies par défaut, jamais relues) — à
garder, c'est la trace : `*_par`, `*_le` de `fabrique.*` (7),
`plateforme.archives` (4), `plateforme.requisitions.client_informe_le`,
`plateforme.reclamations.close_par`, `plateforme.grilles_publiees.publie_le`,
`app.operateurs_attendus.{attendu_le, honore_le}`,
`app.platform_operators.granted_by`, `capture.analyses_verifiees.{verifie_par, verifie_le}`,
`parametrage.accounts.ouvert_par`, `parametrage.fabrique_seuils.arrete_le`,
`facturation.licence_organisations.rattachee_le`, `facturation.lectures.consommee_le`.

« Tests seulement » : `billing.invoice_lines.unit_price`,
`plateforme.requisitions.depose_par`, `plateforme.reclamations.ouverte_par`,
`legal.corpus_vigueur.{signe_le, en_vigueur_le}`, `fabrique.travaux.demande_par`,
`parametrage.cours_de_change_imports.importe_le`.

**INCERTAIN** : une colonne nommée par un gabarit (`${champ}`) ou un
`select *` transmis tel quel à l'écran échappe à la méthode. Vérifier chaque
colonne retirée par `grep -rn "<colonne>" apps packages` et par la suite de
tests avant de l'inscrire dans une migration.

### 3.5 Index

| contrôle                                                                           |     résultat |
| ---------------------------------------------------------------------------------- | -----------: |
| Index strictement dupliqués (même table, colonnes, opclass, expressions, prédicat) |        **0** |
| Index non uniques **préfixe** d'un autre index btree sans prédicat                 |        **8** |
| Clés étrangères sans index menant par leurs colonnes                               | **40 / 439** |

Les 8 redondants (le couvrant entre parenthèses) :
`collab.obligations_cabinet_tenant_idx (tenant_id)` ⊂ `obligations_cabinet_pkey (tenant_id, obligation_code, exercice, secteur)` ;
`collab.pv_reunions_client_tenant_id_fk_idx (client_tenant_id)` ⊂ `pv_client_publication_idx (client_tenant_id, envoye_le desc)` ;
`identity.entities_tenant_idx (tenant_id)` ⊂ `entities_tenant_id_code_key` ;
`legal.chunks_version_idx (article_version_id)` ⊂ `chunks_version_ordinal_key` ;
`ref.account_classes_pack_idx (pack_version_id, prefix)` ⊂ `…_pack_version_id_prefix_valid_from_key` ;
`ref.concepts_pack_idx (pack_version_id, code)` ⊂ `…_pack_version_id_code_valid_from_key` ;
`ref.formes_juridiques_pack_idx (pack_version_id, code)` ⊂ `…_pack_version_id_code_valid_from_key` ;
`socle.lignes_ecriture_idx (ecriture_id)` ⊂ `ecriture_lignes_ecriture_id_ordinal_key`.

Retirer `obligations_cabinet_tenant_idx` et `entities_tenant_idx` laisse le test
R6 vert : la clé couvrante mène par `tenant_id`.

FK sans index — celle qui coûte : `capture.rattachements.piece_id` et
`.piece_liee_id`, toutes deux `on delete cascade` vers `capture.pieces` ; les
index existants mènent par `tenant_id` (`rattachements_tenant_piece_idx`), ce
qui ne sert pas la recherche de cascade par `piece_id` seul. Chaque suppression
de pièce parcourt `capture.rattachements` en entier, deux fois. Les 38 autres
pointent vers des tables de référence petites (`ref.*`, codes de moyens de
paiement) : sans enjeu.

**INCERTAIN** : les index jamais lus. Sur la base vivante :
`select indexrelid::regclass, idx_scan from pg_stat_user_indexes where idx_scan = 0
and indexrelid not in (select conindid from pg_constraint) order by pg_relation_size(indexrelid) desc;`
après au moins un cycle mensuel depuis `pg_stat_reset()`.

### 3.6 Doublons et droits orphelins

- **Fonctions au corps identique** (espaces normalisés, `md5(prosrc)`) : **0**.
  Une seule surcharge : `public.paiement_inscrire` (deux signatures sans rapport
  — l'inscription d'un paiement par le cabinet, et l'état d'un paiement en
  ligne). Même nom pour deux métiers : confusion à l'appel, pas un bogue.
- **Droits orphelins à `service_role`** (`nologin`, `bypassrls`, **0 membre**,
  rôle de compatibilité Supabase de `db/local/00_compat_supabase.sql` ; la
  production est un PostgreSQL auto-hébergé, `infra/compose.yml`) :
  `agents.model_pricing` (ALL), `public.ref_account_classes_v`,
  `public.ref_account_mappings_v` (SELECT), EXECUTE sur
  `capture_articles_persist`, `charge_famille_resolve`, `charge_question_answer`.
  Personne ne peut les exercer ; ils ne s'écrivent que par habitude.
- **`malica_exploitation`** : `nologin`, 0 membre, 5 EXECUTE, 6 droits de
  relation, 5 politiques `observabilite.*`. Orphelin dans le dépôt.
  **INCERTAIN** : en production, un rôle de connexion d'exploitation en est
  peut-être membre — `select member::regrole from pg_auth_members where roleid = 'malica_exploitation'::regrole;`.

---

## 4. La relecture de nuit : deux définitions, et la base dépend du chemin

Les deux définitions de `app.relecture_de_nuit(uuid)` :

|     | fichier                                                             | branche     | jour lu                                                                                                                                              |
| --- | ------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `20261127300000_la_relecture_de_nuit_se_lit_au_jour_du_dossier.sql` | mission     | `now() at time zone app.fuseau_du_cabinet(p_dossier)` — le fuseau **du dossier** (l'appel est inliné ; A **n'appelle pas** `public.jour_du_dossier`) |
| B   | `20261130230000_la_relecture_de_nuit_lit_le_jour_du_cabinet.sql`    | main (#262) | `app.fuseau_du_cabinet(coalesce(app.cabinet_du_parametrage(p_dossier), p_dossier))` — le fuseau **du cabinet** qui règle le dossier                  |

Sur la branche seule (355 migrations), seule A existe :
`md5(prosrc) = 2a54449b…`, `position('cabinet_du_parametrage' in prosrc) > 0` = false.

**Fusionnées, la définition vivante dépend de l'ordre où la base a reçu les fichiers** — `db/migrer.mjs` joue « chaque fichier absent, dans l'ordre des noms », sans refuser un fichier plus ancien que le dernier appliqué :

| scénario (rejoué)                                                                       | ordre effectif                   | `app.relecture_de_nuit`                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| Base neuve, 378 fichiers dans l'ordre des noms (CI, `malica_test`, témoin vierge)       | A (…27300000) puis B (…30230000) | **B, jour du cabinet** (`md5 e1202ed7…`, lit `cabinet_du_parametrage` = true) |
| Base déjà à `main` (352 fichiers), puis la fusion : 26 fichiers « absents » joués après | B puis A                         | **A, jour du dossier** (`md5 2a54449b…`)                                      |

Empreinte objet par objet (fonctions avec droits, vues, tables, contraintes,
index, politiques, déclencheurs, et données de `ref`, `agents`, `storage`,
`legal`, `notif`, `plateforme`, `parametrage` hors uuid et horodatages) des
deux bases : **4 501 objets, 1 seul différent : `fn app.relecture_de_nuit(uuid)`**.
Staging et production, qui sont à `main`, prendraient donc A au déploiement de
la fusion, quand la CI éprouve B. `db/registre.mjs` compare
`pg_get_functiondef` et verrait l'écart — s'il est joué contre staging après le
déploiement.

`public.jour_du_dossier(uuid)` (défini par `20261127310000`, branche) : **aucun
objet de la base ne l'emploie** (ni fonction, ni vue, ni politique : 0 ligne) ;
son seul appelant est `apps/api/src/depots/capture.ts:849`
(`contexteSudoku`, réglages du lecteur prouvé). Il reste donc vivant après la
fusion, mais il lit le jour **du dossier** quand B lit celui **du cabinet** : pour
un dossier à Dakar tenu depuis Tunis, le mode du lecteur (`lecture.sudoku`) et
la relecture de nuit liraient le même paramétrage à deux jours différents
pendant une heure par nuit. Choix produit à trancher ; B est la sémantique la
plus récente et la mieux argumentée (le réglage se lit dans le calendrier où il
a été daté). → § 6, M1.

Même famille de défaut, hors de ces deux fichiers : B affirme que
`app.relecture_de_nuit` « était la seule fonction qui lisait un réglage à
`current_date` ». Sur la branche, **12 fonctions** nomment un réglage
(`reglage`, `parametrage.`, `socle_params`) et `current_date` dans le même
corps : `conseil_contexte`, `fabrique.bornes_de_generation`,
`fabrique.bornes_de_recette`, `fabrique.bornes_de_travail`,
`fabrique.reglages_de_signature`, `fabrique.seuils_exiges`,
`facturation.emettre`, `facturation.emettre_cabinet`,
`facturation.recharge_automatique_possible`, `mon_annuel`, `mon_report`,
`notif.relancer_les_impayes` (64 fonctions et 10 vues lisent `current_date` au
total). **INCERTAIN** : toutes ne lisent pas un réglage daté par le cabinet
« à partir d'aujourd'hui » ; à revoir une par une avec la règle de B.

---

## 5. Hygiène des migrations

### 5.1 Horodatages en double

Sur la branche : **9** préfixes partagés (dont un triple). Après fusion avec
`main` : **13** — les 4 nouveaux viennent de la collision des deux branches :

| préfixe            | fichiers                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 20260901160000     | `codes_non_fiscaux_dans_la_file` · `les_conversations_de_malica`                                           |
| 20260901180000     | `nommer_les_corpus` · `normes_comptables_tunisiennes`                                                      |
| 20260901190000     | `controles_et_verdict_du_cabinet` · `douanes_assurances_securite_sociale` · `menage_dans_la_file`          |
| 20260902180000     | `ce_que_malica_accepte_de_classer` · `l_index_vectoriel_se_reconstruit_…`                                  |
| 20261020200000     | `la_fabrique_rejoint_le_garde_…` · `une_ancre_de_deux_caracteres_…`                                        |
| 20261023130000     | `le_client_recoit_ses_pv_publies` · `une_facture_se_paie_en_ligne`                                         |
| 20261110090000     | `un_refus_porte_ses_valeurs` · `une_vente_se_range_par_nature`                                             |
| 20261117100000     | `le_jour_de_reception_est_celui_du_dossier` · `une_relecture_est_un_travail`                               |
| 20261117110000     | `l_exoneration_partielle_…` · `une_montee_remplacee_ne_se_paie_plus`                                       |
| **20261126090000** | `la_tour_confie_et_archive_une_organisation` (main) · `un_identifiant_bancaire_porte_son_format` (branche) |
| **20261126100000** | `la_tour_voit_qui_dirige_une_organisation` (main) · `un_champ_liste_se_lit_dans_son_domaine` (branche)     |
| **20261126110000** | `la_tour_compte_les_bibliotheques` (main) · `le_titre_d_une_piece_a_son_domaine` (branche)                 |
| **20261127090000** | `la_facture_part_chaque_jour` (main) · `un_texte_non_prouve_se_lit_avec_assurance` (branche)               |

**L'ordre interne ne compte pas — prouvé deux fois :**

1. Statique (script `paires`) : pour chaque groupe, les objets créés,
   remplacés, modifiés ou alimentés par un fichier sont cherchés dans l'autre.
   Seuls recoupements : `legal.ingestion_queue` (`douanes_…` y insère des
   corpus CTVA, CDOUANE… ; `menage_…` y efface `INVEST`, renomme
   `DECRET_LOI_FINANCES` 2022-69, ignore les `NOTE_COMMUNE` sans fichier —
   ensembles disjoints) et `ref.socle_params` (`un_texte_non_prouve_…` insère
   `lecture.confiance_du_texte` ; `la_facture_part_chaque_jour` lit
   `facture.droit_de_timbre` — codes disjoints).
2. Dynamique : les 378 fichiers rejoués sur base neuve avec **l'ordre inversé
   dans chacun des 13 groupes** (renommés `<préfixe>_0_…`, `_1_…`) :
   378 jouées, 0 erreur ; empreinte comparée à l'ordre normal :
   **4 501 objets, 0 différent**.

Le danger n'est donc pas le doublon, mais l'**arrivée tardive** : § 4.

### 5.2 `migrer.mjs` accepte un fichier plus ancien que le dernier appliqué

C'est la cause de § 4. Lors de la fusion, les 26 fichiers de la branche
(`20261126…` à `20261127310000`) sont tous antérieurs au dernier de `main`
(`20261130230000`) : une base à `main` les jouera après. Un seul objet en
souffre aujourd'hui ; le prochain conflit de ce genre ne sera pas vu.

### 5.3 Un fichier qui porte son `commit;` sort de la transaction de `migrer.mjs`

**184 fichiers sur 378** contiennent un `commit;` en début de ligne
(`20261019150000_la_livraison_du_19_…` en a 5). `migrer.mjs` ouvre `begin`,
envoie le fichier, puis inscrit `app.migrations` et valide. Le `commit;` du
fichier valide **avant** l'inscription. Rejoué (script `atomicite`) :
`begin` → fichier `begin; create table …; commit;` → échec simulé de
l'inscription → `rollback` : PostgreSQL répond « aucune transaction en cours »
et **la table du fichier survit** (`true`). Une coupure entre le `commit;` du
fichier et l'inscription laisse un fichier appliqué mais non inscrit, rejoué au
passage suivant ; un fichier à plusieurs `commit;` qui échoue au milieu reste à
moitié appliqué.

### 5.4 Défauts R11 connus

`db/reproductibilite.test.mjs` les nomme (deux) ; rien de nouveau trouvé par
l'empreinte de données : les bases « neuve », « montée depuis main » et « ordre
inversé », jouées le même jour, ont des données de référence identiques. La
méthode ne voit pas une date du jour (elle est la même pour les trois) :
**INCERTAIN** pour une faute R11 nouvelle — `npm test` (`reproductibilite`)
reste le juge.

---

## 6. Nettoyages proposés (non inscrits)

Le dépôt n'a pas de migrations « down » ; chaque _down_ ci-dessous est la
migration de retour qu'on écrirait, horodatée après l'_up_, si l'on devait
revenir. Aucune n'écrit d'horloge dans `ref` (R11) ; les corps de fonction
peuvent lire `now()`.

### M1 — Faire converger `app.relecture_de_nuit` (critique, avant la fusion)

- **Objet** : `app.relecture_de_nuit(uuid)`.
- **Preuve** : § 4 (empreinte : 1 objet diffère entre base neuve et base montée depuis `main`).
- **Risque** : nul sur base neuve (même corps) ; sur staging/production, remplace A par B — c'est l'intention de #262.
- **Up** — `20261201090000_la_relecture_de_nuit_se_lit_au_jour_du_cabinet_partout.sql`
  (horodatage postérieur aux deux branches) : le `create or replace function
app.relecture_de_nuit` de `20261130230000`, **copié octet pour octet** depuis
  ce fichier (sans ses `begin;`/`commit;`, cf. § 5.3). Copier, ne pas retaper :
  `registre.mjs` compare `pg_get_functiondef`, et un blanc de plus ferait deux
  définitions selon le chemin. Après ce fichier, base neuve et base montée
  depuis `main` ont la même empreinte (B, `md5(prosrc) = e1202ed7…`) ; c'est le
  test d'acceptation : rejouer les deux scénarios du § 4 et comparer.
- **Down** — `…_la_relecture_de_nuit_revient_au_jour_du_dossier.sql` : le
  `create or replace function` de `20261127300000`, copié de même (A,
  `md5(prosrc) = 2a54449b…`).
- **À trancher en même temps** : `contexteSudoku` lit `public.jour_du_dossier`
  (fuseau du dossier). Pour une seule règle, soit `jour_du_dossier` prend
  `coalesce(app.cabinet_du_parametrage(p), p)`, soit on garde deux calendriers
  en le disant.
- **Et dans `migrer.mjs`** (code, pas migration) : refuser un fichier absent
  dont le nom précède le dernier appliqué, sauf drapeau explicite — et retirer
  ou refuser `begin;`/`commit;` dans les fichiers (§ 5.3).

### M2 — Retirer les 10 vues mortes

- **Preuve** : § 3.1 (0 lecteur, 0 dépendant).
- **Risque** : faible. Un écran hors dépôt (Android ?) qui lirait une de ces vues
  par PostgREST n'existe plus (l'API est le seul client SQL) ; `android/` n'en
  nomme aucune (grep : 0).
- **Up**

```sql
drop view public.ref_pack_rules_v;
drop view public.ref_charge_famille_rules_v;
drop view public.banque_rapprochements_v;
drop view public.agents_model_pricing_v;
drop view public.conformite_v;
drop view public.ref_grille_relations_v;
drop view agents.angles_morts;
drop view facturation.pieces_orphelines_v;
drop view facturation.payeur_courant_v;
drop view facturation.repartition_v;
```

- **Down** (définitions relevées par `pg_get_viewdef` sur `malica_inventaire`) :

```sql
create view public.ref_pack_rules_v with (security_invoker = true) as
  select id, pack_version_id, jurisdiction, kind, label, cadence, day_of_month,
         month_offset, legal_reference, valid_from, valid_to from ref.pack_rules;
create view public.ref_charge_famille_rules_v with (security_invoker = true) as
  select id, pack_version_id, famille_code, match_kind, pattern, priority, valid_from, valid_to
    from ref.charge_famille_rules;
create view public.banque_rapprochements_v with (security_invoker = true) as
  select id, tenant_id, ligne_id, ecriture_id, score, ecart_montant, ecart_jours,
         reference_exacte, decided_by, motif_id, pack_version_id, created_at
    from banque.rapprochements;
create view public.agents_model_pricing_v with (security_invoker = true) as
  select id, provider, model, role, price_in_per_mtok, price_out_per_mtok, currency,
         sovereign, effective_from, effective_to from agents.model_pricing;
create view public.conformite_v with (security_invoker = true) as
  select id, tenant_id, piece_id, verdict, motif_id, note, pack_version_id, decided_by, decided_at
    from capture.conformite;
create view public.ref_grille_relations_v with (security_invoker = true) as
  select id, grille_id, vers, nature, cle from ref.grille_relations;
create view agents.angles_morts with (security_invoker = true) as
  select tenant_id, message_id, attendu, created_at,
         (select count(*) from agents.reponse_controles c where c.message_id = v.message_id) as controles_cedes
    from agents.reponse_verdicts v
   where verdict = 'faux' and not exists (select 1 from agents.reponse_controles c
                                           where c.message_id = v.message_id and c.suite = 'retirer');
create view facturation.pieces_orphelines_v as
  select p.id as piece_id, p.tenant_id, p.created_by as auteur, p.vis, p.status, p.created_at,
         case when m.user_id is null then 'auteur_parti' when p.entity_id is null then 'sans_etablissement' end as motif
    from capture.pieces p
    left join identity.memberships m on m.tenant_id = p.tenant_id and m.user_id = p.created_by
   where m.user_id is null and p.vis = 'personnel'::app.vis_t or p.entity_id is null;
create view facturation.payeur_courant_v with (security_invoker = true) as
  select licence_id, du, au_exclu, au, payeur_type, payeur_tenant_id, payeur_personne,
         acces_id, acces_reference, part_offre_code, part_ht
    from facturation.payeurs_v
   where du <= current_date and (au_exclu is null or au_exclu > current_date);
create view facturation.repartition_v with (security_invoker = true) as
  select pv.licence_id, pv.du as segment_du, pv.au_exclu as segment_au_exclu, pv.au as segment_au,
         pv.origine, pv.origine_cabinet, pv.canal, pv.offre_code, pv.offre_libelle, pv.offre_rang,
         pv.prix_total_ht, pv.part_cabinet_ht, pv.part_pme_ht, pv.cabinet_tenant_id, pv.acces_id,
         pv.acces_reference, pv.acces_offre_code, pv.plancher_offre_code, pv.plancher_rang,
         pv.facturable, pv.titulaire, pi.payeur_type as payeur_initial_type,
         pi.payeur_tenant_id as payeur_initial_tenant_id, pi.payeur_personne as payeur_initial_personne,
         pi.depuis as payeur_initial_depuis
    from facturation.periodes_v pv
    left join facturation.payeur_initial_v pi on pi.licence_id = pv.licence_id
   where pv.du <= current_date and (pv.au_exclu is null or pv.au_exclu > current_date);
revoke all on public.ref_pack_rules_v, public.ref_charge_famille_rules_v, public.banque_rapprochements_v,
  public.agents_model_pricing_v, public.conformite_v, public.ref_grille_relations_v, agents.angles_morts,
  facturation.pieces_orphelines_v, facturation.payeur_courant_v, facturation.repartition_v from public, anon;
grant select on public.ref_pack_rules_v, public.ref_charge_famille_rules_v, public.banque_rapprochements_v,
  public.agents_model_pricing_v, public.conformite_v, public.ref_grille_relations_v, agents.angles_morts,
  facturation.payeur_courant_v, facturation.repartition_v to authenticated;
```

### M3 — Retirer les deux fonctions fiscales mortes

- **Preuve** : § 3.3. **Risque** : faible ; elles sont exécutables par `PUBLIC`
  et pointent vers une fonction qui n'existe pas.
- **Up** : `drop function ref.parametre_fiscal(text, text, date); drop function ref.appliquer_bareme(text, text, date, numeric);`
- **Down** : leurs corps tels que rendus par `pg_get_functiondef` sur
  `malica_inventaire` (relevés pour l'audit ; la dernière migration qui les
  nomme est `20261110090300`), recréés `language plpgsql stable` sans
  `security definer`, avec `revoke execute … from public` si l'on veut en
  profiter pour fermer le défaut de droit.

### M4 — Retirer les 8 index préfixe-redondants

- **Preuve** : § 3.5. **Risque** : faible ; un plan qui préférait l'index étroit
  prendra le large (quelques pages de plus). `drop index concurrently` →
  fichier sans transaction (`migrer.mjs` le reconnaît au mot `concurrently`).
- **Up**

```sql
drop index concurrently if exists collab.obligations_cabinet_tenant_idx;
drop index concurrently if exists collab.pv_reunions_client_tenant_id_fk_idx;
drop index concurrently if exists identity.entities_tenant_idx;
drop index concurrently if exists legal.chunks_version_idx;
drop index concurrently if exists ref.account_classes_pack_idx;
drop index concurrently if exists ref.concepts_pack_idx;
drop index concurrently if exists ref.formes_juridiques_pack_idx;
drop index concurrently if exists socle.lignes_ecriture_idx;
```

- **Down**

```sql
create index concurrently if not exists obligations_cabinet_tenant_idx on collab.obligations_cabinet (tenant_id);
create index concurrently if not exists pv_reunions_client_tenant_id_fk_idx on collab.pv_reunions (client_tenant_id);
create index concurrently if not exists entities_tenant_idx on identity.entities (tenant_id);
create index concurrently if not exists chunks_version_idx on legal.chunks (article_version_id);
create index concurrently if not exists account_classes_pack_idx on ref.account_classes (pack_version_id, prefix);
create index concurrently if not exists concepts_pack_idx on ref.concepts (pack_version_id, code);
create index concurrently if not exists formes_juridiques_pack_idx on ref.formes_juridiques (pack_version_id, code);
create index concurrently if not exists lignes_ecriture_idx on socle.ecriture_lignes (ecriture_id);
```

### M5 — Indexer les cascades de `capture.rattachements`

- **Preuve** : § 3.5 (FK `on delete cascade` sans index menant par `piece_id` / `piece_liee_id`).
- **Risque** : nul en lecture ; coût d'écriture d'un index par colonne.
- **Up** : `create index concurrently if not exists rattachements_piece_idx on capture.rattachements (piece_id); create index concurrently if not exists rattachements_piece_liee_idx on capture.rattachements (piece_liee_id);`
- **Down** : `drop index concurrently if exists capture.rattachements_piece_idx; drop index concurrently if exists capture.rattachements_piece_liee_idx;`

### M6 — Révoquer les droits orphelins de `service_role`

- **Preuve** : § 3.6 (rôle `nologin`, 0 membre). **Risque** : nul tant qu'aucun
  rôle de connexion n'en devient membre ; c'est justement ce qu'on veut
  empêcher (`bypassrls`).
- **Up**

```sql
revoke all on agents.model_pricing from service_role;
revoke select on public.ref_account_classes_v, public.ref_account_mappings_v from service_role;
revoke execute on function public.capture_articles_persist(uuid, uuid, date, text, jsonb),
  public.charge_famille_resolve(uuid, text, text, date),
  public.charge_question_answer(uuid, text, text, numeric, numeric, numeric, text, uuid, text) from service_role;
```

- **Down** : les `grant` symétriques (`grant all on agents.model_pricing to service_role; grant select on … ; grant execute on function … to service_role;`).
- `malica_exploitation` : ne pas toucher avant d'avoir levé l'INCERTAIN du § 3.6.

### M7 — Retirer les schémas d'amorçage (décision, puis migration)

- **Objets** : `billing`, `catalog`, `pricing`, `commissions`, `payments`, `contracts`, `coffre` (11 tables, 3 fonctions `billing.*` dont `billing.next_invoice_number`, 50 politiques, 17 déclencheurs).
- **Preuve** : § 3.2. **Risque** : **données** — à lever par le comptage en production. Aussi : `db/maintenance/purge_metier.sql` les nomme (à mettre à jour) et le verrou d'intégrité (`portes_sans_appel.billing.next_invoice_number`) doit perdre son entrée dans le même commit.
- **Up** : `drop schema billing, catalog, pricing, commissions, payments, contracts, coffre cascade;` — précédé d'un garde qui refuse si une table a des lignes :
  `do $$ begin if exists (select 1 from billing.invoices) or exists (select 1 from coffre.objects) … then raise exception 'refus.migration.donnees_presentes'; end if; end $$;`
- **Down** : le DDL de ces schémas relevé par `db/registre.sql` sur la base juste avant (tables, politiques, déclencheurs, droits). Il n'est pas recopié ici : 7 schémas, et le relevé doit être fait sur l'état exact qu'on retire.

### M8 — Colonnes métier mortes (par lot, après M7)

- **Preuve** : § 3.4, première famille. **Risque** : moyen — méthode par nom
  (INCERTAIN du § 3.4) ; certaines tables portent un déclencheur R7 qui refuse
  la mise à jour, pas le `alter table`.
- **Up** (exemple, premier lot) :
  `alter table agents.budgets drop column per_piece_cost_cap, drop column per_piece_latency_ms; alter table notif.gabarits drop column corps_html; alter table notif.preferences drop column push_actif; alter table facturation.encaissements drop column annule_id;`
- **Down** : `alter table … add column` du même type (`app.money_t`, `integer`, `text`, `boolean`, `uuid references facturation.encaissements(id)`), **avec la sauvegarde des valeurs** si la production en porte (INCERTAIN : `select count(*) from agents.budgets where per_piece_cost_cap is not null`, etc.).
- Les colonnes de provenance restent.

### Non proposé

FORCE sur les 31 tables : n'apporte rien tant que les portes appartiennent à
un superutilisateur (§ 2). `ref.entry_controls` : décision métier (§ 3.1),
pas un ménage.

---

## 7. Récapitulatif INCERTAIN

| point                                                   | comment le lever                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Index jamais lus                                        | `pg_stat_user_indexes.idx_scan = 0` en production, après un cycle complet  |
| Lignes dans les schémas d'amorçage                      | `select count(*)` sur les 11 tables, en production                         |
| Membres de `malica_exploitation`                        | `pg_auth_members` en production                                            |
| Colonnes mortes nommées dynamiquement                   | grep par colonne + `npm test` avant chaque `drop column`                   |
| Les 12 fonctions qui lisent un réglage à `current_date` | relecture une par une : le réglage est-il daté dans le fuseau du cabinet ? |
| Faute R11 nouvelle                                      | `npm test` (`db/reproductibilite.test.mjs`)                                |

## 8. Les dix constats, par risque

1. **`app.relecture_de_nuit` dépend du chemin de migration** après fusion : base neuve = jour du cabinet, staging/production = jour du dossier (§ 4).
2. **`migrer.mjs` joue sans broncher un fichier plus ancien que le dernier appliqué** — cause de 1, et de la prochaine (§ 5.2).
3. **184/378 migrations portent leur `commit;`** : appliquées hors de la transaction qui les inscrit (§ 5.3).
4. **Deux calendriers pour un même paramétrage** : `contexteSudoku` (jour du dossier) contre la relecture de nuit (jour du cabinet) (§ 4).
5. **12 fonctions lisent un réglage à `current_date`**, le défaut que #262 croyait unique (§ 4).
6. **`facturation.pieces_orphelines_v`**, seule vue _definer_ sur 110, traverse tous les tenants ; morte, sans droit — une mine (§ 2, § 3.1).
7. **`capture.rattachements`** : deux cascades depuis `capture.pieces` sans index (§ 3.5).
8. **7 schémas d'amorçage morts** (11 tables, politiques, déclencheurs, `authenticated:SELECT`) (§ 3.2).
9. **Droits orphelins** à `service_role` (`bypassrls`, 0 membre) et `malica_exploitation` (0 membre) (§ 3.6).
10. **Objets morts** : 10 vues, 2 fonctions exécutables par `PUBLIC` (dont une qui renvoie vers une fonction inexistante), 8 index redondants, ~25 colonnes métier jamais branchées, et `ref.entry_controls`, dont les 5 contrôles normatifs ne sont appliqués nulle part depuis la table (§ 3).

Ce qui tient, et qu'il faut dire aussi : 0 table de tenant sans RLS, 0 sans
index de tenant, 0 écriture directe par un client, 0 accès `anon`, 0 fonction
`security definer` sans `search_path`, 0 index dupliqué, 0 corps de fonction
recopié, et les 13 doublons d'horodatage indifférents à l'ordre.
