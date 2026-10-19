# Générer une recette, et décider de sa vie

*20 octobre 2026. Écrit avec le code, pas après.*

La fabrique de lecteurs fonctionnait sans que **aucune recette ne puisse
naître** : il fallait les écrire à la main. Ce document dit comment une
recette se fabrique, ce qui la fait avancer dans son cycle, et ce que chaque
étape exige.

---

## Le parcours, en une ligne

```
exemples qualifiés → candidate → évaluation → observation → active
                                      ↑            ↓
                                      └──── suspendue ────→ retirée
```

Les transitions permises, l'exigence d'une évaluation et les seuils sont
tenus par la **base** (`fabrique.verifier_promotion()`), pas par
l'application : un écran se contourne, un déclencheur non.

---

## ① Qualifier des exemples

`fabrique.qualifierUnExemple` écrit un exemple : une pièce, une clé de
signature, une provenance, une **qualification**, un **usage**, et des
désignations attendues — `page` / `ordinal`, jamais une valeur.

Deux choses à ne pas confondre :

- **une validation humaine FOURNIT un exemple ; elle n'autorise aucune
  promotion.** Ce sont deux faits distincts, et tout passage à `evaluee`,
  `observation` ou `active` exige une **évaluation** ;
- **une décision comptable n'est pas une règle de lecture.** Un expert qui
  impute un droit de timbre ailleurs n'enseigne rien sur la forme du papier.
  La colonne calculée `nourrit_une_recette` la met hors de portée de
  l'apprentissage, et la clé étrangère de `fabrique.recette_version_exemples`
  l'y maintient.

L'**apprentissage** et l'**évaluation** sont séparés par construction. On ne
complète jamais l'un par l'autre, même « parce qu'il y en a peu » : une
recette mesurée sur ce qui l'a produite rend toujours 1,00, et ce 1,00
franchit tous les seuils.

---

## ② Proposer une recette

Un modèle **propose** une structure ; il n'émet aucune valeur liante (R3).
Quatre portes, dans cet ordre, et aucune ne se saute.

**① Assez d'exemples DISTINCTS.** Deux au moins — le minimum vient de
`EXEMPLES_MINIMUM_POUR_UNE_OSSATURE`, et ce n'est pas un seuil de
paramétrage : à un seul exemple, l'ossature n'est pas plus permissive, elle
**n'existe pas**. Deux exemplaires du même document ne comptent que pour un :
ils sont dédupliqués sur l'empreinte de leur signature, parce que
l'intersection de quelque chose avec lui-même ne fait rien tomber.

**② Le vocabulaire commun.** Tout texte écrit dans un motif de la recette
proposée doit être un mot **sans chiffre** que **tous** les exemplaires
portent. `cleDAncre` refuse les jetons qui portent un chiffre, donc aucun
montant, aucune date, aucun numéro n'y entre ; l'intersection fait tomber ce
qui varie, donc le nom d'un client qui change. C'est la barrière R3, posée du
côté de la génération.

**③ Le validateur strict**, appelé et non recopié. Ses refus remontent tels
quels — on doit savoir quoi corriger.

**④ La recette redonne ses propres exemples.** Une recette qui échoue ici n'a
rien appris, et la faire évaluer coûterait une évaluation pour rien.

Ce que la proposition rend s'accompagne d'une **provenance** : générateur,
version du langage, version de la forme des signatures, modèle et rôle
appelés, pièces retenues, ossature et vocabulaire. Elle est stockée sur la
version (`fabrique.recette_versions.provenance`), parce qu'une recette qu'on
ne peut pas rattacher à ce qui l'a produite n'est pas auditable.

---

## ③ Évaluer

`fabrique.evaluerUneVersion` interprète la recette sur le jeu **d'évaluation
seul**, et compte :

| mesure | ce qu'elle compte |
|---|---|
| `exactitude_champs_critiques` | champs désignés là où l'exemple les attend, sur le nombre attendu |
| `montants_faux_acceptes` | totaux désignés **ailleurs** que là où l'exemple les attend, sans abstention |
| `taux_abstention` | abstentions sur le nombre attendu |

**Une mesure sans observation n'est pas une bonne mesure : elle est absente.**
Zéro montant faux sur zéro montant observé vaut 0, et 0 franchit le seuil
« au plus 0 ». Quand le dénominateur est nul, la mesure n'est pas écrite —
l'évaluation l'est quand même, avec sa **réserve en clair**, la recette peut
passer en observation, et la base refuse l'activation.

---

## ④ Promouvoir

`fabrique.promouvoir` inscrit une décision, **sans aucun `if`**. La
transition, l'évaluation exigée, les seuils du référentiel et le droit de
décider (dirigeant ou expert) sont tenus par la base.

Toute recette naît en **observation** : elle s'exécute, on compare, on ne la
croit pas. Ce n'est pas une excuse pour un cycle incomplet — l'activation, la
suspension, le retrait et le retour arrière existent et s'éprouvent
(`src/fabrique/cycle.test.ts`).

---

## ⑤ Surveiller, et suspendre

`fabrique.surveillerUneVersion` compte les exécutions **depuis la dernière
décision** — une recette reprise après correction ne traîne pas les
abstentions de sa vie précédente — et compare le taux d'abstention au seuil
`taux_abstention` du référentiel : **le même** que celui de l'activation, pas
un quatrième jeu.

Au-delà, elle inscrit une dérive et suspend. Le nom de la dérive dépend du
signal : `DESIGNATION_AMBIGUE` dit qu'il y avait **plusieurs** candidats là où
la recette en attendait un, donc qu'un **format a changé** — c'est
`signature_changee`, et pas `abstention_en_hausse`. Les deux appellent des
suites différentes.

**Suspendre suffit à rétablir le chemin existant** :
`contexteDeDesignation` ne rend que les versions `observation` et `active`,
donc la pièce suivante repart vers le modèle. Rien n'est perdu — ni les
pièces, ni les exécutions, ni les décisions : tout est en ajout seul, et la
reprise `suspendue → observation` est une transition permise.

---

## La borne d'ancre livrée, et pourquoi un cabinet la change

Le pack livre `fabrique.seuil.recette.ancre_texte_min = 3`, et la migration le
dit elle-même : « un point de départ à mesurer, pas un relevé ».

**Mesuré au banc** : avec ce défaut, aucune recette ne peut désigner le total
hors taxe d'une facture française ordinaire. Trois lignes du pied portent le
mot « Total » ; ce qui les sépare — « HT », « TTC » — fait deux caractères, et
le validateur les refuse comme « trop courtes pour discriminer ».

Ce n'est pas un défaut du code, c'est exactement ce que R10 prévoit : le
cabinet arrête sa borne à 2 dans `parametrage.fabrique_seuils`, **sans
déploiement**, et la décision se lit (`arrete_par_le_cabinet`). Le socle
montrait déjà cette surcharge pour les factures arabes, où une mention de deux
caractères porte le sens.

---

## L'épreuve manuelle, qui coûte

Aucune épreuve de `npm test` n'appelle un fournisseur : le générateur y reçoit
un adaptateur **simulé**. Ce qu'un adaptateur simulé ne dit pas, c'est si le
modèle **sait** écrire une recette dans un langage déclaratif qu'il découvre
dans sa consigne. Cela se mesure à la main :

```bash
cd apps/api
MALICA_API_URL=http://localhost:3000 \
MALICA_EMAIL=... MALICA_MOTDEPASSE=... \
DEEPSEEK_API_KEY=... \
FABRIQUE_TENANT=<uuid de l'organisation> \
FABRIQUE_SIGNATURE=<la clé de signature du format> \
node --experimental-strip-types tests/real/fabriquer-une-recette.ts
```

Sans `FABRIQUE_INSCRIRE=1`, le script **propose et affiche**, il n'écrit
aucune candidate. La ligne de journal de la génération, elle, part dans tous
les cas — réussite ou refus : un appel refusé a coûté autant qu'un appel
retenu.

---

## Ce que le journal doit montrer, et pourquoi

Le générateur appelle le **raisonneur**, sous un rôle qui lui est propre :
`generateur`. `agents.model_pricing` cherche un tarif par le **couple**
(modèle, rôle), et un organe sans ligne de tarif **ne se journalise pas, en
silence** — ce défaut a été nommé quatre fois dans ce dépôt, la première fois
pendant dix jours.

Loger la génération sous `reasoner` aurait tenu dans la même case du journal
que la désignation, alors que le plan demande le coût **total** par document,
« génération, observation, évaluation et secours compris ». Deux dépenses
qu'on ne peut pas séparer sont deux dépenses qu'on ne sait pas attribuer.

Pour relever ce qu'une génération a coûté :

```sql
select agent, model, cost, tokens_in, tokens_out, latency_ms, status, created_at
  from public.agent_runs_v
 where agent = 'fabrique.generateur'
 order by created_at desc;
```
