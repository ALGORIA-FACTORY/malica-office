# Évaluation d'architecture — base Malica Office

**Date** : 31 août 2026
**Objet** : `malica_local`, PostgreSQL 17.11 — 27 schémas, 88 tables, 54 vues, 220 politiques RLS
**Méthode** : cinq audits menés en parallèle, en lecture seule, par cinq architectes séniors sur cinq
périmètres (socle comptable, isolation multi-tenant, référentiel et temporalité, chaîne de capture,
facturation et commissionnement). Chaque défaut cité ci-dessous est adossé à un nom d'objet réel, à
un extrait de code source ou à un résultat de requête. Les deux seuls tests d'écriture ont été
exécutés dans une transaction annulée, avec contrôle de non-persistance.
**Statut** : proposé — les arbitrages de la section 8 attendent une décision.

---

## 1. Verdict d'ensemble

Cette base est **au-dessus du marché sur la doctrine, en dessous sur l'exécution**.

La doctrine — les dix règles d'`AGENTS.md`, le générateur `app.enable_tenant_rls`, le domaine
`app.money_t`, les 54 vues en `security_invoker`, les déclencheurs `deny_mutation` — est meilleure
que ce qu'on trouve dans la plupart des produits comptables en production. Ce n'est pas une
politesse : le choix de porter l'isolation par la base plutôt que par l'application, la séparation
du plan officiel et des extensions maison, le refus de replier sur un défaut implicite, la
tarification des modèles en table datée, sont des décisions qu'une équipe expérimentée met des
années à prendre.

Mais entre la règle écrite et la règle exécutée, il y a un écart mesurable, et il est toujours au
même endroit : **les invariants sont portés par des fonctions que l'appelant peut contourner, au
lieu d'être portés par des contraintes qu'il ne peut pas contourner.** Le rôle `authenticated`
détient `INSERT`, `UPDATE` et `DELETE` en direct sur les tables que ces fonctions sont censées
garder. Une fonction n'est alors pas un mur : c'est une porte à côté de laquelle on passe.

Trois conséquences, chacune vérifiée :

1. **L'isolation ne tient pas.** Un utilisateur de rôle `expert` s'attribue lui-même un mandat sur
   n'importe quelle organisation dont il connaît l'identifiant, par un simple `INSERT`. Le
   prédicat `WITH CHECK` a été évalué en conditions réelles : il passe.
2. **Ce n'est pas encore une comptabilité.** Aucune clôture d'exercice, aucune numérotation
   chronologique de pièce, et `DELETE` protégé sur aucune des deux tables du grand livre. Un
   utilisateur efface une écriture comptabilisée sans laisser de trace.
3. **L'isolation ne passera pas à l'échelle.** Mesuré : une lecture sur 97 000 lignes parcourt
   2 083 blocs pour en renvoyer zéro, là où la même requête filtrée en dur en lit 3.

Aucun de ces trois points n'est une erreur d'inattention. Ce sont les trois faces d'un même choix
d'architecture, réparable — et la réparation est de l'ordre de quelques semaines de travail ciblé,
pas d'une réécriture. L'ossature est saine.

Sur l'ambition affichée — une architecture de classe mondiale : la comparaison utile n'est pas avec
tel ou tel éditeur, elle est avec ce qu'un vérificateur fiscal, un expert-comptable inscrit à
l'ordre et un attaquant motivé exigeraient chacun de leur côté. Aujourd'hui, les trois trouvent une
prise. Après les huit correctifs de la section 4, aucun des trois n'en trouve de simple.

---

## 2. Ce qui est déjà solide, et qu'il ne faut pas toucher

Ces points sont acquis et vérifiés. Ils constituent la base sur laquelle tout le reste se répare.

**Le typage monétaire.** Un domaine unique, `app.money_t AS numeric(38,3)`, et aucun flottant nulle
part dans la base. Sur 31 049 lignes d'écriture, zéro montant hors du millième. C'est la première
chose qu'on vérifie dans un logiciel comptable, et c'est la première qui manque d'habitude.

**Les contraintes de ligne d'écriture.** `CHECK (debit >= 0 AND credit >= 0)` et surtout
`CHECK ((debit = 0) <> (credit = 0))` — un XOR qui interdit à la fois la ligne nulle et la ligne
débit+crédit simultanés. Peu d'ERP posent le second.

**Le contrôle d'équilibre au passage en comptabilité.** `socle.assert_bookable()` refuse l'écriture
sans ligne et l'écriture déséquilibrée. Résultat sur les données réelles : zéro écriture
déséquilibrée, zéro écriture sans ligne, zéro incohérence de tenant entre lignes et en-tête.

**Le générateur de politiques RLS.** `app.enable_tenant_rls` pose systématiquement `enable` **et**
`force row level security`, révoque `public`, `anon` et `service_role`, et parenthèse
`(select app.is_platform())` pour en faire un InitPlan plutôt qu'un appel par ligne — avec la raison
écrite en commentaire. 82 des 85 tables sous RLS portent `force` grâce à lui. Un générateur qui
documente son propre piège de performance, c'est rare.

**Les 54 vues `public.*_v` sont toutes en `security_invoker = true`.** Zéro exception. C'est
l'erreur numéro un des schémas de type Supabase, et elle a été évitée partout.

**Le rôle de connexion de l'API ne peut pas contourner l'isolation par héritage.** `malica_api`
est `NOINHERIT`, sans `BYPASSRLS` ; `service_role`, qui porte `BYPASSRLS`, est `NOLOGIN` et n'a
aucun membre. `anon` n'a strictement aucun privilège de table dans toute la base.

**L'immuabilité est réellement outillée** : quinze déclencheurs `app.deny_mutation` sur les tables
de faits, plus `freeze_booked`, `freeze_lignes`, `freeze_issued`.

**Le lettrage bancaire est event-sourcé.** `banque.lettrages` est un journal immuable d'actions
(`lettre` / `delettre`, `seq >= 1`), `banque.lettrage_etat` en est la projection. C'est le meilleur
choix de conception du schéma.

**La séparation du plan officiel et des extensions.** `ref.accounts.is_official` + `source_ref`
distinguent les 611 comptes NC 01 verbatim des 15 extensions Malica, chacune portant sa
justification en clair (« Extension Malica sous 437. NC 01 ne subdivise pas 437. Le timbre n'est
pas une taxe sur le CA : série 436 exclue. »). `ref.proteger_comptes_officiels()` verrouille le
verbatim. C'est exactement R10.

**La qualité de la source fiscale est modélisée, pas supposée.** `ref.fiscal_parameters` porte
`autorite ∈ {texte, doctrine, lecture}` et `confiance ∈ {confirme, a_confirmer, non_trouve}`, avec
un CHECK imposant article **et** citation pour tout paramètre confirmé. Les 454 lignes sont
pourvues. Et `ref.parametre_fiscal` **refuse de servir** un paramètre `non_trouve` plutôt que de le
rendre : « il ne peut pas servir à un calcul ». C'est la bonne culture.

**Le refus de replier.** `ref.parametre_fiscal`, `ref.appliquer_bareme`, `ref.compte_du_role`
lèvent `no_data_found` au lieu d'inventer un défaut. Le corollaire de R4 est tenu partout où il a
été écrit.

**La numérotation de facture résiste à la concurrence.** `billing.next_invoice_number` incrémente
sous verrou de ligne ; le compteur `billing.invoice_sequences` n'est accessible qu'en `SELECT`.

**La discipline d'index par tenant est tenue à la lettre** : aucune table portant `tenant_id` n'est
sans index le portant en tête. (Voir §6 : la lettre, pas l'esprit.)

---

## 3. Le défaut de conception qui explique la moitié des failles

Il ne s'agit pas de huit bugs indépendants. Sept des huit blocages de la section 4 descendent d'un
même choix, et il se corrige en un seul geste d'architecture.

**Le choix.** L'invariant métier est écrit dans une fonction PL/pgSQL, et la table reste ouverte en
écriture directe au rôle `authenticated`. Exemples, tous vérifiés :

| L'invariant                                            | Où il est écrit                                   | Ce que `authenticated` détient sur la table       |
| ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------- |
| Une citation pointe le token qui porte le montant (R2) | `public.capture_read_persist`, `security invoker` | `INSERT, UPDATE, DELETE` sur `capture.citations`  |
| Une écriture comptabilisée est immuable (R7)           | `socle.freeze_booked`, `BEFORE UPDATE` seulement  | `DELETE` sur `socle.ecritures`, politique ouverte |
| Le journal d'audit dit la vérité                       | `app.deny_mutation` sur UPDATE/DELETE             | `INSERT` libre, `actor` non contraint             |
| Un tenant ne dépasse pas son budget d'agents           | nulle part                                        | `UPDATE` sur sa propre table `agents.budgets`     |
| Le paramétrage du cabinet est cohérent                 | `parametrage.verifier_compte_cabinet`             | `INSERT/UPDATE` direct                            |

**Pourquoi c'est structurellement faux.** Une fonction `security invoker` n'apporte aucun privilège
que l'appelant n'ait déjà : elle ne peut donc rien interdire qu'il ne puisse faire sans elle. Elle
documente une intention ; elle ne l'exécute pas. Le banc d'essai du dépôt le démontre lui-même :
`db/verification/banc_essai.sql` insère ses 97 000 citations **en contournant**
`capture_read_persist`. Le contournement est déjà dans le dépôt, écrit par l'équipe, sans intention
malveillante — simplement parce que rien ne l'empêche.

**La règle générale à adopter.** Un invariant appartient à l'une de ces trois catégories, dans cet
ordre de préférence :

1. **Une contrainte** — clé étrangère composite, `CHECK`, `EXCLUDE`, unicité. Personne ne la
   contourne, pas même une migration, pas même un `COPY`. C'est le seul niveau qui tient face à un
   auditeur externe qui ne lira jamais votre TypeScript.
2. **Un déclencheur**, quand la règle a besoin de contexte. Il tient face au SQL direct, mais pas
   face à `ALTER TABLE ... DISABLE TRIGGER` ni à `session_replication_role`.
3. **Une fonction `security definer`, seule détentrice du droit**, la table étant révoquée à
   `authenticated`. Elle tient tant que la révocation tient.

Une fonction `security invoker` sur une table ouverte n'est aucune des trois.

**Le geste de correction, en trois lignes de principe** :

```sql
-- 1. Fermer les portes latérales sur les tables de faits.
revoke insert, update, delete on capture.citations, capture.token_plan,
                                  socle.ecritures, socle.ecriture_lignes,
                                  audit.event_log, agents.budgets
  from authenticated;

-- 2. Les fonctions d'écriture deviennent security definer, et deviennent le seul chemin.
alter function public.capture_read_persist(...) security definer;

-- 3. Ce qui peut être une contrainte devient une contrainte (voir §5, défauts B5, C1, C2).
```

C'est le chantier à mener en premier, parce qu'il ferme d'un coup la moitié des brèches et rend les
suivantes vérifiables.

---

## 4. Les huit blocages, par ordre de gravité

| #   | Blocage                                                                          | Domaine      | Ce qui se produit concrètement                                                           |
| --- | -------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| 1   | Un expert s'auto-attribue un mandat sur n'importe quelle organisation            | Isolation    | Lecture complète des dossiers d'un client qui ne l'a jamais mandaté                      |
| 2   | La confidentialité `vis` n'est pas propagée aux tables filles                    | Isolation    | Le texte OCR intégral d'une pièce « personnelle » reste lisible par le cabinet           |
| 3   | Aucune clôture d'exercice, aucune numérotation chronologique                     | Comptabilité | Le résultat d'un exercice signé reste modifiable ; aucun FEC produisible                 |
| 4   | `DELETE` non protégé sur le grand livre ; la cascade contourne le gel            | Comptabilité | Une écriture comptabilisée disparaît sans trace                                          |
| 5   | Aucune clé étrangère sur `account_code` ni `journal`                             | Comptabilité | **Déjà arrivé** : compte `43661` inexistant, journal `VTE` inexistant, montants évaporés |
| 6   | La citation peut désigner le token d'un autre tenant ; la pièce est substituable | Capture      | R2 tombe : le montant cité ne prouve plus rien                                           |
| 7   | RLS produit un parcours séquentiel intégral                                      | Performance  | 2 083 blocs lus pour 0 ligne rendue ; ~1,7 Go par requête à l'échelle cible              |
| 8   | Le modèle de facturation ne porte aucune des règles commerciales                 | Facturation  | Ni seuil de commission, ni réduction, ni wallet, ni versement, ni Europe                 |

Les cinq premiers sont des défauts de **conformité et de sécurité** : ils bloquent la mise en
production chez un cabinet. Le sixième est un défaut de **preuve** : il vide R2 de sa substance. Le
septième est un défaut de **passage à l'échelle** : il ne se voit pas aujourd'hui et rendra le
produit inutilisable vers 500 tenants. Le huitième est un **manque** plus qu'un défaut : le domaine
n'a pas encore été conçu, et — vérifié — aucun code applicatif ne le référence, donc le reprendre
maintenant ne casse rien.

---

## 5. Détail par domaine

### 5.1 Isolation multi-tenant

**A1 — BLOQUANT. Un expert s'attribue un mandat sur n'importe quelle organisation.**

La politique d'insertion de `identity.engagements` :

```sql
WITH CHECK (
  app.has_org_role(pme_org_id,      ARRAY['dirigeant'])
  OR app.has_org_role(cabinet_org_id, ARRAY['expert'])
)
```

Le second disjoint ne contrôle **que le côté cabinet**. `pme_org_id` n'est contraint par rien, et
`status` — dont le défaut est pourtant `'propose'` — est librement positionnable à `'actif'`.
Évalué en conditions réelles, avec un compte `expert` réel et une organisation cible hors
portefeuille : la cible est invisible (`select count(*) from identity.organizations where id = …`
renvoie 0), et le `WITH CHECK` passe quand même. `engagements_upd` porte le même prédicat en
`USING` et en `WITH CHECK` : l'expert repointe même `pme_org_id` d'une ligne existante. Et il
n'existe **aucune politique `DELETE`** : le dirigeant de la PME ne peut pas rompre le lien, il ne
peut que basculer un statut que le cabinet rebascule.

Conséquence : une révocation de mandat n'est pas opposable. Les 38 politiques contenant
`tenant_id in (select app.engaged_orgs())` s'ouvrent d'un coup — écritures, lignes, relevés
bancaires, pièces, factures, paiements, contrats, coffre.

Correction : séparer les politiques (le cabinet ne peut créer qu'une proposition, seule la PME
active), interdire par déclencheur tout changement de `pme_org_id`/`cabinet_org_id` après création,
et contraindre `cabinet_org_id` à une organisation `kind='cabinet'` — aujourd'hui un cabinet peut
« s'engager » sur un cabinet concurrent.

**A2 — BLOQUANT. La confidentialité `vis` s'arrête aux tables racines.**

Le modèle promet deux niveaux : `vis='personnel'` (invisible au cabinet mandaté) et `'partage'`. Ce
contrôle est posé sur 7 tables racines et **absent de toutes leurs filles**, qui sont précisément
celles qui portent la donnée :

```sql
-- capture.pieces (racine) : la porte est là
... OR ((vis = 'partage') AND (tenant_id IN (SELECT app.engaged_orgs())))

-- capture.token_plan (fille) : la porte a disparu
... OR (tenant_id IN (SELECT app.engaged_orgs()))
```

`capture.token_plan` porte le **texte OCR intégral de chaque page**. Une pièce marquée
`personnel` disparaît de `capture.pieces` pour le cabinet, et son contenu reste lisible mot pour
mot. Même faille sur `socle.ecriture_lignes` (les montants), `banque.releve_lignes`,
`immo.dotations`, `stocks.mouvements` — douze tables filles.

L'auteur savait : `capture.piece_articles` a reçu sa propre colonne `vis`. Les autres ont été
oubliées. La base contient déjà 340 pièces `vis='personnel'` sur 210 tenants ; la fuite est
latente et s'ouvrira à la première pièce confidentielle passée à l'OCR.

Correction : la fille hérite de la porte de sa racine par un `EXISTS` indexé — le motif est déjà
employé, et correctement, par `pieces_storage_read_membre`. À généraliser par le générateur, avec
un test qui échoue dès qu'une table référence par clé étrangère une table portant `vis` sans
reprendre la porte.

**A3 — SÉRIEUX. `malica_api` lit et écrit `auth.users.encrypted_password`, table sans RLS.**

449 comptes, aucune politique, un `GRANT` colonne direct au rôle de connexion. Comme l'identité
applicative repose sur un GUC (`current_setting('request.jwt.claim.sub')`) que tout rôle peut
positionner, une seule injection SQL, n'importe où, suffit à usurper un compte puis, par
`RESET ROLE`, à lire ou réécrire la table des mots de passe. La qualité de l'isolation est donc
exactement égale à l'absence d'injection SQL dans tout le code — ce que R6 dit vouloir éviter.

**A4 — SÉRIEUX. `storage.objects` : trois politiques écrites, RLS jamais activée.** `relrowsecurity
= false`. Les trois politiques — dont la mieux écrite de la base — sont inertes. Aucune exposition
aujourd'hui (aucun `GRANT` hors `postgres`), mais le jour où l'extension de stockage pose ses
`GRANT` habituels, le coffre à pièces devient public entre tenants sans qu'une ligne de politique
n'ait changé.

**A5 — SÉRIEUX. Le journal d'audit est écrit par l'audité.** `audit.event_log` est append-only,
mais `INSERT` est libre et le contenu n'est contraint par rien. Un utilisateur forge des événements
dans son journal, un cabinet dans celui de son client. L'immuabilité protège de l'effacement, pas
de la pollution.

**A6 — MINEUR mais à traiter. `app.platform_operators` : refus voulu, qui ne tient que par
accident.** RLS forcée, zéro politique, zéro `GRANT` : la fermeture est délibérée et correcte. Mais
`app.is_platform()` ne la traverse que parce que `postgres` porte `BYPASSRLS`. Le jour où le schéma
sera restauré sous un propriétaire non-superutilisateur — c'est-à-dire le jour du durcissement — la
fonction renverra `false` pour tout le monde, silencieusement, et les 38 disjoints
`or (select app.is_platform())` s'éteindront sans message. Le sens de la panne va vers la
fermeture, mais le diagnostic sera impossible. Poser une politique explicite.

**Point positif à souligner** : les 17 couples table/commande à deux politiques permissives ont été
examinés un par un. Ils sont volontaires et corrects — la faille n'est pas dans le cumul permissif,
elle est en amont, dans qui décide du contenu de `engaged_orgs()`.

### 5.2 Socle comptable

**B1 — BLOQUANT. Aucune clôture de période, aucun exercice, aucun verrou.** Recherche exhaustive
sur les 27 schémas : aucun objet de clôture, et `identity.organizations` ne porte même pas de date
de début d'exercice. `assert_bookable()` ne contient aucun test de date, et `date_ecriture` est un
`date` libre sans `CHECK`. Rien n'empêche d'écrire au 31/12/2024 après la remise de la liasse.
Aucun expert-comptable ne signera sur cet outil. Correction : table `socle.exercices` avec
`EXCLUDE USING gist` pour interdire le chevauchement, clôture souple mensuelle et dure annuelle,
déclencheur de refus, écriture d'à-nouveaux.

**B2 — BLOQUANT. Aucune numérotation de pièce ni d'écriture.** Les 24 colonnes de `socle.ecritures`
ne contiennent aucun numéro ; l'inventaire des séquences de la base entière en compte **une**, sans
rapport avec la comptabilité. L'écriture est identifiée par un UUID v4 : non ordonné, non
chronologique, illisible. Aucun FEC produisible, aucune preuve d'absence de trou, et l'exigence de
numérotation chronologique continue du Système Comptable des Entreprises n'est pas satisfaite.
Correction : compteur ligne-verrouillé — **pas une `sequence` PostgreSQL**, qui laisse des trous à
chaque rollback — attribué au passage `proposee → booked`, jamais à la proposition.

**B3 — BLOQUANT. `DELETE` n'est protégé sur aucune des deux tables du grand livre.** Les trois
déclencheurs de `socle.ecritures` sont tous `BEFORE UPDATE`. Le privilège est ouvert et la politique
permissive. Pire, le garde-fou des lignes est contourné par la cascade : `freeze_lignes()` lit le
statut du parent, or pendant une cascade `ON DELETE` le parent a déjà disparu — `v_status` vaut
`NULL`, le test est faux, l'exception n'est jamais levée. Une écriture comptabilisée et toutes ses
lignes disparaissent, et `audit.event_log` ne journalise aucune suppression. _(Mécanisme déduit du
code, non exécuté — mandat de lecture seule ; l'absence de tout déclencheur `BEFORE DELETE` et
l'ouverture de la politique sont, elles, des faits.)_

**B4 — BLOQUANT. Aucune clé étrangère sur `account_code` ni sur `journal` — et le grand livre est
déjà corrompu.** Résultat de la requête d'intégrité sur les données réelles :

```
COMPTES_INCONNUS : account_code 43661 → 2 lignes
JOURNAUX_INCONNUS : journal VTE   → 1 écriture
```

Deux lignes imputées sur un compte qui n'existe dans aucun des 626 comptes de `ref.accounts`, et
une écriture sur un journal absent de `ref.journals` (`ACH, BQ, OD, VEN`). Ces montants
n'apparaîtront dans aucune balance, aucun état financier, aucune déclaration de TVA — tout en
restant dans une écriture parfaitement équilibrée. C'est la pire classe de bug comptable :
invisible et permanent. La clé cible existe déjà (`UNIQUE (pack_version_id, account_code)`).

**B5 — BLOQUANT. Le multidevise est absent, pas incomplet.** `ecritures.devise` est un `text` sans
FK ni `CHECK` ; `ecriture_lignes` n'a aucune colonne de devise ni de montant en devise de tenue ;
aucune table de taux de change dans les 27 schémas. Tout est `TND` aujourd'hui, donc jamais
éprouvé. Une facture fournisseur en EUR n'est pas comptabilisable correctement, et l'écart de
conversion à la clôture est incalculable. Pour la Tunisie, avec ses flux import/export, c'est
disqualifiant. Correction : modèle standard à deux montants, taux daté figé au `book`,
`ref.devises` avec le nombre de décimales par devise — ce qui justifiera enfin l'échelle 3 de
`money_t`, correcte pour le millime et fausse pour l'euro.

**B6 — BLOQUANT. La comptabilité auxiliaire n'est branchée sur rien.** `tiers.auxiliaires` est bien
conçue, `ref.accounts` porte `is_collective` et `requires_auxiliary` — mais `socle.ecriture_lignes`
n'a **aucune colonne de tiers**. Pas de grand livre auxiliaire, pas de balance âgée, pas de
lettrage client, pas de relance. Or c'est exactement ce qu'un cabinet vend à ses PME.

**B7 — SÉRIEUX. Fenêtre de course sur l'équilibre.** `assert_bookable` lit les lignes sans les
verrouiller, `freeze_lignes` lit le statut du parent sans le verrouiller. En `READ COMMITTED`, deux
transactions concurrentes valident chacune de son côté et l'écriture est comptabilisée
déséquilibrée — définitivement, plus aucun déclencheur ne la revérifiera. Un double-clic suffit.
Correction : `FOR SHARE` dans `freeze_lignes`, et surtout un `CONSTRAINT TRIGGER … DEFERRABLE
INITIALLY DEFERRED` qui revérifie l'équilibre au `COMMIT` — la seule défense qui tient quel que
soit l'ordre des opérations.

**B8 — SÉRIEUX. `freeze_booked` ne gèle que 13 colonnes sur 24.** Restent modifiables après
comptabilisation : `created_by`, `created_at`, `vis`, `booked_autonome`, `reviewed_by`,
`review_outcome`, `review_motif_id`… On peut donc faire porter à un collègue la responsabilité
d'une écriture, retourner un avis de supervision, ou soustraire une écriture au regard du cabinet.
Correction : inverser la logique — liste blanche des colonnes modifiables, refus de tout le reste
par comparaison de la ligne entière.

**B9 — SÉRIEUX. Aucune ségrégation des tâches.** `app.has_org_role` existe et n'est référencée que
par 8 politiques, **toutes dans `identity`**. Aucune politique de `socle`, `banque`, `immo`,
`stocks` ne la mentionne : un `assistant` a exactement les mêmes droits qu'un `expert`. Le contrôle
à quatre yeux de `assert_bookable` est donc nominal. Pour un produit vendu à des cabinets où
l'expert engage sa responsabilité ordinale, c'est un défaut de conception.

**B10 — SÉRIEUX. La supervision est rejouable.** `socle_ecriture_review` n'a aucune garde sur
`reviewed_at`, et l'index sur `reverses_id` n'est **pas unique** : deux appels génèrent deux
contre-passations complètes. La balance est fausse d'exactement un montant de pièce, et chaque
écriture reste individuellement équilibrée — donc indétectable en aval.

**B11 — SÉRIEUX. La contre-passation est datée du jour, pas de la période d'origine.** Une écriture
de décembre retournée en février est annulée sur l'exercice suivant : les deux exercices sont
faux. Correction impossible sans B1 — l'absence de clôture contamine tout le reste.

**B12 — SÉRIEUX. `stocks.mouvements` n'a aucun déclencheur.** Zéro, alors que ses voisines sont
protégées. Modifier rétroactivement un mouvement d'entrée change la valorisation de toutes les
sorties postérieures, donc le résultat, **sans qu'aucune écriture comptable ne bouge**.

**B13 — SÉRIEUX. Lettrage et rapprochement contraints au 1-pour-1, sans montant.** `PRIMARY KEY
(ligne_id)` sur `lettrage_etat`, `UNIQUE (ligne_id)` sur `rapprochements`, et aucune colonne de
montant lettré. Un virement client soldant trois factures n'est pas lettrable. Acompte, paiement
partiel, règlement groupé, remise de chèques : tous les cas réels de trésorerie sont hors modèle,
et le lettrage devrait porter sur la **ligne** d'écriture, pas sur l'écriture entière.

**Manque de fond** : aucun index sur `account_code` — or _toute_ requête comptable filtre sur le
compte ; et `ref.journals` est global, sans `tenant_id` et sans journal d'à-nouveaux, ce qui rendra
la réouverture d'exercice impossible sans migration.

### 5.3 Référentiel et temporalité

**C1 — BLOQUANT. La résolution rôle→compte n'a aucune date.** `ref.compte_du_role(p_tenant,
p_dossier, p_role, p_pack)` n'a pas de paramètre de date — et ne pourrait pas en avoir un d'utile :
`parametrage.role_bindings` n'a ni `valid_from` ni `valid_to`, et sa contrainte est
`UNIQUE (portee, portee_id, role_code)` : **une seule imputation par rôle, pour toujours**.
L'expert déplace le droit de timbre du 4367 au 4368 en mars 2026 ; en avril, la balance de décembre
2025 sort avec le 4368. Le paramétrage écrase le passé au lieu de s'y ajouter — le contraire exact
de R7, appliqué à la couche qui décide où l'écriture va.

**C2 — BLOQUANT. Trois implémentations de la même résolution, et elles divergent.**

| Endroit                                 | Comment le cabinet est trouvé                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `ref.compte_du_role()`                  | `portee = 'cabinet' and portee_id = p_tenant`                                     |
| `apps/api/src/depots/parametrage.ts:49` | `c.portee_id = $1` _(tenantId)_                                                   |
| `apps/api/src/depots/capture.ts:414`    | `c.portee_id in (select cabinet_org_id from engagements_v where pme_org_id = $1)` |

Les deux premières cherchent une liaison posée sur le tenant lui-même, la troisième sur le cabinet
qui le mandate. Pour un dossier PME, ce ne sont pas les mêmes lignes : **l'écran de paramétrage
affiche à l'expert un compte, et le moteur qui impute la facture en écrit un autre.** R10 est vrai
à l'écran et faux au journal. Aggravant : le `in (select …)` est multi-valué — une PME mandatée par
deux cabinets multiplie les lignes de la jointure et `coalesce` prend celle qui sort.

**C3 — BLOQUANT. Une seule contrainte d'exclusion dans toute la base.** `btree_gist` est installé
et servi **une fois** (`ref.fiscal_parameters`). Partout ailleurs la protection est un
`UNIQUE (pack_version_id, code, valid_from)`, qui interdit deux lignes ayant la même date de début
et rien d'autre. Dix tables sont concernées, dont `ref.tva_rates`. Conséquence : TVA 19 %
`[2026-01-01, ∞)` et TVA 13 % `[2026-07-01, ∞)` cohabitent sans que la base bronche, le prédicat de
lecture rend deux lignes, et l'appelant prend la première venue — **un taux de TVA choisi au hasard
sur une facture, sans erreur, sans trace.**

**C4 — BLOQUANT. Le plan comptable et les contrôles de classe sont aveugles au pack : R5 ne
tient pas.** `plan_comptable_v` lit `ref.accounts` sans colonne ni filtre `pack_version_id` ;
`ref.verifier_classe_role()` fait `where a.account_code = NEW.account_code limit 1` ;
`parametrage.verifier_compte_cabinet()` de même. Or l'unicité est `(pack_version_id,
account_code)` : le même code existe dans **chaque** pack. Au deuxième pack, le plan passe de 626 à
1 252 lignes indifférenciées, le `limit 1` tire une classe au hasard, et un cabinet tunisien se
voit refuser un compte parce qu'un pack UEMOA utilise ce code. « Activer un pack ne forke jamais le
code » est vrai du code et faux de la base.

**C5 — SÉRIEUX. Deux régimes de temporalité incompatibles.** `ref.fiscal_parameters`,
`fiscal_scale_brackets` et `fiscal_obligations` sont clés par `(jurisdiction, code, valid_from)`,
**sans `pack_version_id`** ; les 21 autres tables de `ref` sont clés par pack. Pire, l'unique
contrainte d'exclusion porte sur la juridiction : elle **interdit activement** de versionner ces
trois tables par pack. La contrainte la mieux écrite de la base est aussi celle qui bloque la
sortie. Publier TN 2027.1 renumérotera les comptes et la TVA en laissant les 454 paramètres fiscaux
hors version.

**C6 — SÉRIEUX. `appliquer_bareme` ignore `borne_min`.** La borne basse est recalculée par
`lag(borne_max)`, et rien ne relie la `borne_min` de la tranche N à la `borne_max` de la N−1, ni
n'impose que `ordre` soit contigu. Un barème saisi avec un trou se calcule comme s'il était
contigu, silencieusement. Le résultat actuel est juste — `appliquer_bareme('TN','IRPP_BAREME',
'2026-06-30', 50000) = 13 150,000` — mais par discipline de saisie, pas par contrainte. Et la
jointure sur `valid_from` en égalité stricte orpheline les huit tranches dès qu'on corrige la date
d'effet du paramètre.

**C7 — SÉRIEUX. `valeur_num` est un `numeric` nu et `echelle` est de la prose libre.** 72 couples
`(forme, echelle)` distincts, dont trois `forme='seuil'` valant 0,01 (un ratio), 50 (un
pourcentage) et 500 000 (des dinars) — rendus **à l'identique** par `ref.parametre_fiscal`.
L'appelant ne peut pas savoir s'il doit multiplier ou comparer. Le pipeline d'extraction a par
ailleurs déversé des fragments de phrase et des références d'articles dans le champ « unité ».

**C8 — SÉRIEUX. Le pack n'a ni état de publication, ni chaînage de remplacement.** Pas de `statut`,
pas de `supersedes`, pas de `published_at`. `ref_packs_v` expose `ratified` et **rien ne filtre
dessus** : le seul pack existant n'est pas ratifié et sert toute la production. Et la sélection
amont ignore `effective_to` — un pack retiré reste sélectionné.

**C9 — SÉRIEUX. `current_date` en dur et `"TN"` littéral dans le TypeScript.** L'écran de
paramétrage ne pourra jamais montrer la configuration au 31/12/2025. Et un code de juridiction
écrit en dur est un repli implicite au sens exact du corollaire de R4 : une organisation sans
juridiction renseignée doit lever, pas lire « tunisien » par défaut.

**C10 — SÉRIEUX. Aucune intégrité référentielle sur les codes de compte.** `ref.role_bindings`,
`ref.account_mappings` (trois colonnes), `ref.fiscal_charges`, `ref.accounts.parent_code`,
`parametrage.*` : tous `text`, aucune FK. Les données sont propres aujourd'hui — vérifié, zéro
orphelin — mais par discipline de seed uniquement.

**C11 — SÉRIEUX. Le corpus juridique et le référentiel fiscal ne se touchent pas.** Requête de
jointure sur `(jurisdiction, corpus, numero)` : **0 sur 454** paramètres fiscaux se résolvent à un
article de `legal.articles`. Deux vocabulaires en texte libre (`Article 52-I-a` contre `52 ter` ;
corpus agrégé `CDET/CFL/PARAFISCAL` contre corpus réels), aucune FK, aucune colonne
`article_version_id`. Quand LF-2027 modifiera l'article 52, une nouvelle version sera créée et
**rien** ne désignera les paramètres qu'elle périme. Un corpus de 4 902 versions d'articles qui ne
peut pas dire ce qu'il invalide est une bibliothèque, pas un référentiel.

**État de fait à connaître** : le référentiel ne contient aujourd'hui **qu'une seule tranche
temporelle** — les 454 paramètres sont tous `valid_from = 2026-01-01, valid_to = NULL`, et le seul
pack démarre au 2026-01-01. `parametre_fiscal('TN', …, '2025-12-31')` lève. C'est **honnête** — la
base refuse plutôt que de mentir — mais cela signifie que la rejouabilité n'a jamais été éprouvée,
et que les choix ci-dessus sont précisément ceux qui rendront la deuxième tranche douloureuse.

### 5.4 Chaîne de capture (R2)

**D1 — BLOQUANT. R2 est applicatif ; la table est ouverte en écriture directe.** Test exécuté en
transaction annulée : insertion d'une citation du tenant A, pièce A, page 7, adossée à un token du
tenant B, pièce B, page 1. **La base l'a acceptée.** Aucune contrainte composite, aucun `CHECK`,
aucun déclencheur `BEFORE INSERT` sur `capture.citations`. Un montant peut donc être « cité » depuis
la facture d'un autre client, et l'écran de surlignage affichera une bbox parfaitement cohérente —
celle du token étranger. Correction : la clé référencée existe déjà
(`token_plan_piece_id_page_ordinal_key`) ; une FK composite `(piece_id, page, ordinal)` rend la
citation _structurellement incapable_ de désigner le token d'une autre pièce.

**D2 — BLOQUANT. L'ancre de la chaîne est modifiable : le document sous les citations est
substituable.** `capture.pieces` ne porte que `pieces_touch`, et la politique autorise le membre à
écrire toute la ligne — `storage_path` et `sha256` compris. Test en transaction annulée : le
repointage vers `autre-tenant/piece-substituee.pdf` passe. Toute la partie immuable de la chaîne
pend à un pointeur mutable, et `audit.event_log` ne journalise aucun `piece.updated`. Aggravant :
`capture.piece_versions` existe, est immuable et bien conçue — mais compte **0 ligne**, et ni
`token_plan` ni `citations` ne référencent une version.

**D3 — BLOQUANT. `sha256` est nul sur 100 % des 4 223 pièces.** Aucune déduplication par empreinte ;
la seule barrière est une clé d'idempotence **fournie par le client** (le nom du fichier source). La
même facture déposée deux fois sous deux noms crée deux pièces, deux plans de tokens, et peut être
comptabilisée deux fois. Pour un produit comptable, c'est le défaut le plus coûteux en exploitation.

**D4 — BLOQUANT. `capture_read_persist` est à usage unique.** La fonction ouvre par un `delete from
capture.citations where piece_id = …`, or ces tables portent `deny_mutation` sur `DELETE`. Au
premier appel il n'y a rien à supprimer et tout passe ; au second, la transaction avorte. **Aucune
seconde passe OCR, aucun changement de modèle, aucune correction de lecture n'est possible.** Le
défaut est aujourd'hui invisible : `piece.read` = 0 événement, la fonction n'a jamais tourné — les
97 000 citations viennent du banc d'essai, qui insère en direct. Correction : une passe de lecture
devient un objet (`capture.read_passes`), et relire est un ajout, pas un effacement — ce qui résout
aussi l'absence de citation « courante » (100 % des couples `(piece_id, field)` portent aujourd'hui
2 ou 3 citations concurrentes, sans moyen de désigner la bonne).

**D5 — SÉRIEUX. Le lien montant ↔ citation n'existe nulle part dans la base.** `capture.extractions`
stocke les valeurs dans un `payload jsonb` sans aucun `CHECK` et sans FK vers `citations` ; le lien
est une convention de nommage résolue en TypeScript. La base ne peut donc pas répondre à « ce
montant a-t-il une citation ? ». R2 est vrai dans le code et **invérifiable en SQL** — l'inverse de
ce qu'il faut pour une piste d'audit opposable.

**D6 — SÉRIEUX. Le stockage physique n'est réconcilié avec rien.** Trois mécanismes coexistent et
aucun ne fonctionne : `storage.objects` vide et RLS désactivée, `coffre.objects` vide, et le disque
contient **3 fichiers pour 4 223 pièces référencées**. 80 pièces ont un `storage_path` dont le
premier segment n'est pas leur `tenant_id` — or toute l'isolation du stockage repose sur
`split_part(name,'/',1)::uuid`, qui sur ces chemins **lève** au lieu de refuser.

**D7 — SÉRIEUX. Le coût par pièce n'est ni alimenté ni vérifiable.** `agents.agent_runs` est vide ;
et même remplie, `cost` est une valeur libre sans FK vers le tarif appliqué, avec `tokens_in`/
`tokens_out` nullables — le coût n'est ni recalculable ni contrôlable, ce qui vide R8 de sa portée.
`agents.budgets` n'a aucun déclencheur de plafonnement, et le tenant détient `UPDATE` sur sa propre
table de plafonds : il relève son propre budget.

**D8 — SÉRIEUX. `audit.event_log` ne suffit pas à une piste d'audit opposable.** Quatre types
d'action pour 4 223 pièces : **92 % des pièces n'ont aucun événement**. Rien sur la lecture, la
conformité, les transitions de statut, la modification d'une pièce, le partage, l'accès par un
cabinet mandaté. Et aucun chaînage (`prev_hash`/`seq`) : rien ne détecte la suppression d'un bloc
par le propriétaire de la table.

### 5.5 Facturation, commissionnement, paiement

Ce domaine est un **squelette CRUD mono-pays, mono-devise, bi-partite**. Vérifié : aucune référence
à `billing.`, `commissions.`, `payments.` ni `next_invoice_number` dans tout le code TypeScript du
dépôt. Le reprendre maintenant ne casse rien.

| Règle commerciale que vous avez posée                     | Portée aujourd'hui                  | Ce qui manque                                                                      |
| --------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| Le cabinet inscrit des PME                                | **Oui**                             | —                                                                                  |
| La PME appelle un cabinet                                 | Oui en création, non en traçabilité | L'appel n'est pas un objet : ni initiateur, ni date, ni refus enregistré           |
| Plusieurs users par PME, plusieurs comptables par cabinet | **Oui**                             | FK manquante sur `memberships.user_id`                                             |
| Commission par seuil paramétrable                         | **Non**                             | Aucune table de tranches (`basis` ∈ {pourcentage, fixe} seulement)                 |
| Commission à l'appel **et** au paiement                   | **Non**                             | `entries` n'a ni événement déclencheur ni lien paiement                            |
| Réduction si cabinet hors portefeuille                    | **Non**                             | Aucune colonne de remise nulle part ; le fait « hors portefeuille » n'est pas daté |
| Seuils ALGORIA de réduction ou gratuité                   | **Non**                             | ALGORIA n'existe pas comme organisation                                            |
| Facturation de toutes les parties                         | **Non**                             | La facture ne désigne pas son client                                               |
| Carte ou wallet selon le pays                             | **Non**                             | `wallet` n'apparaît nulle part dans la base                                        |
| Paiements partiels, remboursements                        | **Non**                             | `amount > 0` interdit le remboursement ; ni solde ni statut                        |
| Versement des commissions                                 | **Non**                             | Aucune table de payout ; `beneficiary` est un uuid sans FK                         |
| Europe et réglementations locales                         | **Non**                             | Ni pays, ni n° de TVA, ni régime, ni `pack_version_id`, ni récap TVA, ni change    |

Trois blocages sont structurels et non contournables par du code :

**E1. ALGORIA Factory n'existe pas dans le modèle.** `organizations_kind_check` n'admet que `pme` et
`cabinet` ; la plateforme n'est qu'une liste d'utilisateurs dans `app.platform_operators`. Elle ne
peut donc émettre aucune facture, et aucune commission plateforme n'est facturable.

**E2. Une facture ne désigne pas son client.** `customer_name text`, sans clé étrangère. Le seul FK
sortant désigne l'**émetteur**. Impossible de répondre en SQL à « combien la PME X doit-elle au
cabinet Y », impossible de rattacher une facture à un engagement, impossible de connaître le pays
ni le numéro de TVA du client. Une place de marché dont les factures ne relient pas deux comptes
n'est pas une place de marché.

**E3. L'avoir est irreprésentable.** `CHECK (quantity > 0)` et `CHECK (unit_price >= 0)` : les
lignes d'un avoir ne peuvent pas être négatives. Rien ne lie `kind='avoir'` à `reverses_id`. Et
`freeze_issued` autorise la transition `emise → annulee` **sans avoir** : une facture émise
s'annule d'un `UPDATE`, ce qui est irrégulier en Tunisie comme dans l'UE. À comparer avec
`socle.ecritures`, qui fait cela correctement, à deux schémas de distance.

S'y ajoutent : la commission n'est pas rejouable (ni assiette, ni taux, ni tranche conservés, et
`commissions.rules` est modifiable et supprimable), la numérotation de facture n'est **pas par
entité émettrice** alors que `identity.entities` existe — et `identity.entities` ne porte de toute
façon ni identité légale, ni adresse, ni n° de TVA, donc ne peut pas être un émetteur légal ; et
`payments.payments` n'a ni devise, ni statut, ni référence PSP, ni idempotence, ni gel.

---

## 6. Ce qui casse à l'échelle

### 6.1 RLS produit un parcours séquentiel intégral

C'est la mesure la plus importante de cet audit, parce qu'elle est contre-intuitive : **le test R6
donne une fausse assurance.** Il vérifie qu'un index mène par `tenant_id` — vrai à 100 %. Il ne
vérifie pas que RLS s'en sert. Et RLS ne s'en sert jamais.

Mesuré sur `capture.token_plan` (97 000 lignes), sous un rôle `authenticated` réel :

```
Seq Scan on token_plan   (actual time=19.640..19.643 rows=0)
  Filter: ((ANY (tenant_id = (hashed SubPlan 1).col1))
        OR (ANY (tenant_id = (hashed SubPlan 2).col1))
        OR (InitPlan 3).col1)
  Rows Removed by Filter: 97000
  Buffers: shared hit=2083
```

La même requête avec le filtre `tenant_id` écrit en dur par l'application :

```
Index Only Scan using token_plan_tenant_piece_ordinal_idx  (actual time=1.614..1.614)
  Buffers: shared hit=3
```

**2 083 blocs contre 3.** Cause : un prédicat de la forme `a in (sous-requête) OR b in
(sous-requête) OR (initplan booléen)` n'est pas transformable en condition d'index. Le planificateur
n'a d'autre choix que le parcours séquentiel intégral, tous tenants confondus. L'ironie est
complète : R6 dit vouloir empêcher que « chaque lecture parcoure la table entière, tous tenants
confondus », et c'est exactement ce qui se produit dès qu'une requête ne porte pas déjà, en dur, le
filtre applicatif que RLS était censé rendre superflu.

Aggravant : les fonctions ne sont pas mises en cache une fois par requête mais **une fois par
référence de table**. Sur une jointure à deux tables, le plan montre quatre évaluations. Coût
unitaire mesuré : 189 blocs pour `member_orgs()`, 250 pour `engaged_orgs()`. Une requête de
rapprochement touchant six tables paiera douze évaluations, ~2 600 blocs, **avant de lire une seule
ligne de métier**. La raison est structurelle : PostgreSQL refuse d'inliner une fonction SQL
`security definer`.

**Correction, mesurée.** Remplacer le `OR` de sous-requêtes par un unique prédicat `= any(tableau)`,
qui est indexable :

```sql
where tenant_id = any(array(
        select o.id from identity.organizations o where (select app.is_platform())
        union select app.member_orgs()
        union select app.engaged_orgs()))
→ Index Only Scan ... Buffers: shared hit=368
```

**2 063 → 368 blocs**, et le rapport croît linéairement avec la taille de la table (les 368 sont le
calcul du tableau, constant, pas le parcours). Concrètement : créer `app.visible_orgs() returns
uuid[]`, réécrire le `read_expr` du générateur — **une seule ligne à changer régénère les 38
politiques** — et ajouter un test CI qui exécute un `EXPLAIN` sous `authenticated` et **échoue si le
plan contient `Seq Scan`**. C'est ce test-là, et non le test d'existence d'index, qui exécute
réellement l'intention de R6.

À 500 tenants et 10 M de lignes, la forme actuelle représente ~1,7 Go lus et ~2 s de CPU par
requête et par référence de table, pour rendre quelques dizaines de lignes.

### 6.2 Volumétrie de la capture

Avertissement de méthode : le banc d'essai produit **exactement 25 tokens par pièce** et un texte
moyen de 4,6 caractères. Une facture A4 réelle donne 400 à 800 tokens OCR par page. La volumétrie
observée est donc **~50× en dessous** de la réalité.

Coûts unitaires mesurés : `token_plan` 298 o/ligne (dont 163 d'index), `citations` 406 o/ligne,
`pieces` 431 o/ligne. Projection prudente à 100 000 pièces par tenant (3 pages × 450 tokens) :

- `token_plan` : **135 M lignes, ≈ 41 Go par tenant, dont 22 Go d'index.** Aucune partition
  (`PARTITIONS = 0` sur `capture`, `audit`, `agents`). Et une PK `uuid` v4 : les insertions frappent
  le B-tree en positions aléatoires — amplification WAL, fragmentation, perte du cache d'index dès
  que la table dépasse la RAM.
- `audit.event_log` : croissance perpétuelle, `DELETE` refusé par `deny_mutation` — donc **aucune
  purge ni archivage possible** en l'état.

Le remède structurel rejoint D1 : `token_plan` n'a pas besoin d'un `uuid`, sa clé naturelle
`(piece_id, page, ordinal)` existe déjà. La faire porter par la PK élimine simultanément l'index
`token_plan_pkey`, l'index redondant `token_plan_piece_idx` (préfixe strict d'un autre index —
inutilisable, 1 Mo aujourd'hui, plusieurs Go à l'échelle) **et** le trou d'intégrité inter-pièces.
Un même changement ferme le défaut le plus grave et le poste de coût le plus lourd.

Puis : partitionner `token_plan` et `citations` (par tenant en hachage, ou mieux par exercice — un
cabinet ne relit pas les tokens de N-3), partitionner `audit.event_log` par mois pour pouvoir
archiver par `DETACH PARTITION` sans violer R7, et définir une politique d'archivage froid du plan
de tokens passé la prescription.

---

## 7. Ce qui manque pour être de classe mondiale

Au-delà des correctifs, voici ce qu'un système comptable multi-tenant de premier rang possède et qui
n'existe pas ici. Rien dans cette liste n'est exotique ; tout y est attendu par un vérificateur, un
expert-comptable ou un acheteur qui compare.

1. **L'exercice et la clôture** — verrou souple mensuel, verrou dur annuel, à-nouveaux, report à
   nouveau. Tout le reste en dépend.
2. **La numérotation chronologique continue et prouvable**, par journal et par exercice, avec preuve
   d'absence de trou.
3. **L'export FEC / fichier des écritures normalisé.** Aucune table ni vue `fec|export|liasse|bilan`
   dans la base. C'est le premier objet que réclame l'administration, et le format d'entrée de tous
   les outils de révision. Son absence est aussi un obstacle commercial : un cabinet veut pouvoir
   sortir ses données.
4. **Une piste d'audit chaînée cryptographiquement** (`prev_hash`, `seq`, ancrage périodique hors
   base), écrite exclusivement par déclencheur, avec l'état avant/après — pas seulement l'événement.
5. **La comptabilité auxiliaire complète** : tiers sur la ligne, lettrage par montant et par groupe,
   balance âgée, échéancier de règlement.
6. **Le multidevise à deux montants**, taux daté, écarts de conversion, décimales par devise.
7. **La dimension analytique** : axe, centre de coût, projet, quantité. Aucune répartition
   analytique n'est possible aujourd'hui — c'est le premier module que réclame une PME qui grandit.
8. **La TVA comme objet de premier plan** : base HT et taxe séparées, taux appliqué figé sur la
   ligne, régime (débit/encaissement), période de déclaration, verrouillage après télédéclaration.
   Aujourd'hui `tax_code text` sans FK ne permet pas de produire une déclaration, seulement de
   l'approximer.
9. **La bitemporalité du référentiel** : ce que le droit disait, et ce que nous croyions qu'il
   disait à la date où nous avons déposé. C'est la question que pose un contrôle dès qu'un paramètre
   a été corrigé depuis.
10. **Le lien dur du paramètre fiscal vers sa source juridique** (`article_version_id`). Le corpus
    existe, il est bien versionné, il porte les SHA-256 de ses sources — il n'est simplement pas
    branché. **C'est le chantier au meilleur rapport valeur/effort du lot.**
11. **Des tests dorés de calcul, datés** : un jeu `(juridiction, code, date, base) → attendu`,
    chaque ligne justifiée par son article, rejoué en CI. Aujourd'hui la seule preuve que l'IRPP est
    juste est que personne ne l'a recalculé à la main.
12. **Un grand livre à double entrée des flux de plateforme** — comptes par participant, écritures
    équilibrées, soldes dérivés — avec séparation brut / frais PSP / commission / net reversé, et
    idempotence de bout en bout sur paiement, remboursement et versement.
13. **Un moteur fiscal de place de marché** : lieu de la prestation, redevable, autoliquidation,
    OSS/IOSS, validation VIES, seuils de vente à distance. Et la question centrale, que le modèle ne
    pose même pas : ALGORIA est-elle vendeur ou intermédiaire transparent ?
14. **La conformité e-facturation** (Factur-X/UBL, Peppol, obligation UE 2028) : ni format, ni
    statut de transmission, ni empreinte de scellement.
15. **Le contrôle de cohérence permanent** : recalcul de balance, équilibre global par tenant et par
    période, réconciliation immobilisations et stocks ↔ écritures, réconciliation disque ↔ base.
    `ref.anomaly_thresholds` et `ref.entry_controls` existent : la place est prête, elle est vide.
16. **Les contraintes d'exclusion `EXCLUDE USING gist`**, utilisées une fois sur onze usages
    nécessaires. Le schéma passe à côté d'un des atouts majeurs de PostgreSQL.

---

## 8. Plan d'action

L'ordre compte : chaque vague rend la suivante vérifiable.

### Vague 0 — Fait aujourd'hui

- `db/local/00_compat_supabase.sql` : coquille `as $` → `as $$` corrigée (lignes 105 et 119).
- **pgvector 0.8.6 compilé et installé** sur PostgreSQL 17 (outils de compilation C++ installés,
  extension créée dans `malica_local` et `malica_verif`).
- **Le dépôt reconstruit désormais la base à l'identique** : rejeu des 49 migrations sur une base
  vierge → **0 erreur**, 88 tables, 54 vues, 220 politiques, et les mêmes 12 comptes de données
  référentielles (626 comptes, 454 paramètres fiscaux, 182 modèles d'écriture…) que la base vivante.
  L'écart de schéma entre base reconstruite et base vivante est **nul**.
- Sauvegarde `db/sauvegardes/`, script d'audit `db/verification/audit_defauts.sql`.

### Vague 1 — Fermer les brèches (avant toute mise en production)

1. `identity.engagements` : refaire les politiques (A1) + déclencheur d'immuabilité des deux clés.
2. Propager `vis` aux douze tables filles par `EXISTS` indexé, et poser le test CI qui l'exige (A2).
3. `revoke insert, update, delete` sur les tables de faits ; passer les fonctions d'écriture en
   `security definer` (§3).
4. Déclencheurs `BEFORE DELETE` sur `socle.ecritures`, `socle.ecriture_lignes`, `stocks.mouvements`
   (B3, B12) et correction de `freeze_lignes` sur `v_status IS NULL`.
5. FK composites : `(pack_version_id, account_code)` et `journal` sur le socle (B4) ; `(piece_id,
page, ordinal)` sur les citations (D1) ; `(id, tenant_id)` sur les lignes d'écriture.
   **Corriger d'abord les trois lignes déjà fautives** (`43661`, `VTE`).
6. `auth.users` : RLS + retrait des droits sur `encrypted_password` (A3). `storage.objects` : activer
   la RLS (A4). `audit.event_log` : retirer l'`INSERT` direct (A5).
7. `sha256 not null` + unicité `(tenant_id, sha256)` sur les pièces (D3) ; gel de `storage_path` (D2).

### Vague 2 — Devenir une comptabilité

8. `socle.exercices` + clôture + refus d'écriture en période close (B1).
9. Numérotation chronologique par journal et exercice (B2).
10. `CONSTRAINT TRIGGER DEFERRABLE` d'équilibre au commit (B7) ; liste blanche de `freeze_booked`
    (B8) ; unicité de `reverses_id` (B10).
11. Ségrégation des tâches : `app.has_org_role` dans les politiques d'écriture du socle (B9).
12. Comptabilité auxiliaire sur la ligne (B6) ; lettrage par groupe et par montant (B13).
13. Multidevise à deux montants (B5) ; index sur `account_code`.
14. Export FEC.

### Vague 3 — Rendre le référentiel rejouable

15. Dater `parametrage.role_bindings` + `EXCLUDE` (C1) ; **une seule** fonction de résolution,
    datée, appelée par tous (C2).
16. `EXCLUDE USING gist` sur les dix tables datées + test qui l'exige (C3).
17. `pack_version_id` dans `plan_comptable_v` et les deux déclencheurs de classe (C4) ; trancher le
    régime de temporalité des trois tables fiscales (C5).
18. `article_version_id` du paramètre fiscal vers le corpus (C11) ; normalisation des références.
19. Cycle de vie du pack + filtrage sur `ratified` (C8) ; retirer `"TN"` et `current_date` du code
    (C9) ; tests dorés de calcul.

### Vague 4 — Tenir la charge et concevoir le commerce

20. `app.visible_orgs()` + réécriture du générateur + test `EXPLAIN` anti-`Seq Scan` (§6.1).
21. Clé naturelle sur `token_plan`, partitionnement, archivage (§6.2).
22. **Reprendre le modèle facturation / commissionnement / paiement** (§5.5) : ALGORIA comme
    organisation, contrepartie sur la facture, tranches de commission, remises, wallet piloté par
    pack, payouts, TVA transfrontalière. C'est une conception, pas un correctif — et rien ne la
    bloque, puisque aucun code ne dépend de l'existant.

---

## 9. Annexes et reproductibilité

- `db/verification/audit_defauts.sql` — audit des défauts structurels, ne sort que les anomalies.
- `db/verification/etat_reel.sql` — état réel de la base, en lecture seule.
- `db/local/charger.ps1 -Recreate` — reconstruit une base complète depuis les migrations. **Depuis
  aujourd'hui, cette commande fonctionne de bout en bout.**
- `docs/etat-de-la-base-2026-08-31.md` — constat initial et détail de la panne de reconstruction.
- Sauvegarde antérieure à toute intervention : `db/sauvegardes/malica_local_20260831_123448.dump`.

Trois vérifications restent ouvertes, faute d'avoir voulu écrire dans la base vivante : le
comportement exact de la cascade `ecritures → ecriture_lignes` face à `freeze_lignes` (déduit du
code, à confirmer par un `BEGIN … ROLLBACK`) ; l'exposition ou non du schéma `socle` dans la
configuration PostgREST, qui détermine si le trou `DELETE` est atteignable depuis l'API publique ;
et l'existence d'un test de charge sous rôle `authenticated` réel — le banc de mesure actuel
(`db/verification/mesure.sql`) s'exécute en tant que `postgres`, donc **contourne la RLS** : il ne
mesure pas le chemin de production.
