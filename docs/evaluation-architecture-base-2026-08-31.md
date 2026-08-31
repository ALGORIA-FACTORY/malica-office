# Évaluation d'architecture — base Regalica Office

**Date** : 31 août 2026
**Objet** : `regalica_local`, PostgreSQL 17.11 — 27 schémas, 88 tables, 54 vues, 220 politiques RLS
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

**Le rôle de connexion de l'API ne peut pas contourner l'isolation par héritage.** `regalica_api`
est `NOINHERIT`, sans `BYPASSRLS` ; `service_role`, qui porte `BYPASSRLS`, est `NOLOGIN` et n'a
aucun membre. `anon` n'a strictement aucun privilège de table dans toute la base.

**L'immuabilité est réellement outillée** : quinze déclencheurs `app.deny_mutation` sur les tables
de faits, plus `freeze_booked`, `freeze_lignes`, `freeze_issued`.

**Le lettrage bancaire est event-sourcé.** `banque.lettrages` est un journal immuable d'actions
(`lettre` / `delettre`, `seq >= 1`), `banque.lettrage_etat` en est la projection. C'est le meilleur
choix de conception du schéma.

**La séparation du plan officiel et des extensions.** `ref.accounts.is_official` + `source_ref`
distinguent les 611 comptes NC 01 verbatim des 15 extensions Regalica, chacune portant sa
justification en clair (« Extension Regalica sous 437. NC 01 ne subdivise pas 437. Le timbre n'est
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

| L'invariant | Où il est écrit | Ce que `authenticated` détient sur la table |
|---|---|---|
| Une citation pointe le token qui porte le montant (R2) | `public.capture_read_persist`, `security invoker` | `INSERT, UPDATE, DELETE` sur `capture.citations` |
| Une écriture comptabilisée est immuable (R7) | `socle.freeze_booked`, `BEFORE UPDATE` seulement | `DELETE` sur `socle.ecritures`, politique ouverte |
| Le journal d'audit dit la vérité | `app.deny_mutation` sur UPDATE/DELETE | `INSERT` libre, `actor` non contraint |
| Un tenant ne dépasse pas son budget d'agents | nulle part | `UPDATE` sur sa propre table `agents.budgets` |
| Le paramétrage du cabinet est cohérent | `parametrage.verifier_compte_cabinet` | `INSERT/UPDATE` direct |

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

| # | Blocage | Domaine | Ce qui se produit concrètement |
|---|---|---|---|
| 1 | Un expert s'auto-attribue un mandat sur n'importe quelle organisation | Isolation | Lecture complète des dossiers d'un client qui ne l'a jamais mandaté |
| 2 | La confidentialité `vis` n'est pas propagée aux tables filles | Isolation | Le texte OCR intégral d'une pièce « personnelle » reste lisible par le cabinet |
| 3 | Aucune clôture d'exercice, aucune numérotation chronologique | Comptabilité | Le résultat d'un exercice signé reste modifiable ; aucun FEC produisible |
| 4 | `DELETE` non protégé sur le grand livre ; la cascade contourne le gel | Comptabilité | Une écriture comptabilisée disparaît sans trace |
| 5 | Aucune clé étrangère sur `account_code` ni `journal` | Comptabilité | **Déjà arrivé** : compte `43661` inexistant, journal `VTE` inexistant, montants évaporés |
| 6 | La citation peut désigner le token d'un autre tenant ; la pièce est substituable | Capture | R2 tombe : le montant cité ne prouve plus rien |
| 7 | RLS produit un parcours séquentiel intégral | Performance | 2 083 blocs lus pour 0 ligne rendue ; ~1,7 Go par requête à l'échelle cible |
| 8 | Le modèle de facturation ne porte aucune des règles commerciales | Facturation | Ni seuil de commission, ni réduction, ni wallet, ni versement, ni Europe |

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

**A3 — SÉRIEUX. `regalica_api` lit et écrit `auth.users.encrypted_password`, table sans RLS.**

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
lignes disparaissent, et `audit.event_log` ne journalise aucune suppression. *(Mécanisme déduit du
code, non exécuté — mandat de lecture seule ; l'absence de tout déclencheur `BEFORE DELETE` et
l'ouverture de la politique sont, elles, des faits.)*

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

**Manque de fond** : aucun index sur `account_code` — or *toute* requête comptable filtre sur le
compte ; et `ref.journals` est global, sans `tenant_id` et sans journal d'à-nouveaux, ce qui rendra
la réouverture d'exercice impossible sans migration.
