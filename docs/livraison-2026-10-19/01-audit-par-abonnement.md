# Audit : Malica Office fonctionne-t-il par abonnement, sans résidus ni orphelins ?

**18 octobre 2026 — dépôt `ALGORIA-FACTORY/malica-office`, HEAD `7eb55e8` (PR #50)**
139 migrations, 23 schémas, ~120 tables, 190 politiques RLS, 21 dépôts RPC, 41 routes web.

---

## Méthode

Rien ici n'est supposé. Le dépôt a été cloné, les **139 migrations jouées sur un
PostgreSQL 16 neuf** (seule adaptation locale : `pgvector` indisponible sur la
machine d'audit, les trois index HNSW du corpus juridique ont été neutralisés —
aucun rapport avec le périmètre audité), puis les quatorze migrations correctives
livrées ici jouées par-dessus. Chaque affirmation de ce document qui porte la
mention **« mesuré »** a été exécutée contre ce schéma réel.

---

## Le verdict, en une page

**Malica Office ne fonctionne pas par abonnement. Il ne fonctionne par rien du
tout : la notion n'existe pas dans le code.**

Recherche exhaustive sur les 139 migrations, `apps/api`, `apps/web`,
`packages/socle` et `contrat/rpc.json` : aucune table, colonne, fonction,
contrainte ou route ne porte la notion d'abonnement, d'offre, de formule, de
palier, de quota, de plafond client ou de siège utilisateur. Les mots `basic`,
`solo`, `premium` n'apparaissent nulle part dans le code — une seule occurrence,
dans une vieille maquette HTML statique.

Ce que cela veut dire concrètement :

| Ce que l'offre promet | Ce que le code fait aujourd'hui |
|---|---|
| Basic : 65 lectures | lectures illimitées |
| Team : 3 sièges inclus, puis 8 DT | invitations illimitées, gratuites |
| Premium : 2 organisations, puis 29 DT | organisations illimitées |
| Le plafond arrête la lecture | rien n'arrête rien |
| Espace privé invisible de vos sièges | **le dirigeant voit tout** (mesuré) |
| Suppression libre avant transmission | **échoue dès qu'un paiement existe** (mesuré) |

Trois pièges à éviter en lisant le dépôt, parce qu'ils portent les mêmes mots :

- **`pricing`, `billing`, `catalog`, `commissions`** ne sont pas la facturation
  de Malica : ce sont les ventes **du client**, les factures que la PME émet à
  ses propres clients. Toutes en `references identity.organizations`.
- **`collab.mandats_honoraires`, `collab.factures_honoraires`** sont les
  honoraires **du cabinet** à ses clients PME. Le mot « forfait » du dépôt vient
  de là.
- **`agents.budgets.monthly_cost_cap`** est un plafond **en dollars**, qui borde
  ce qu'ALGORIA dépense chez Alibaba. Il protège l'éditeur d'une facture, pas le
  client d'un dépassement.

---

## Les défauts, par gravité

### ① Le bogue de suppression — *en production aujourd'hui*

`capture_piece_supprimer` vérifie quatre choses, les passe toutes sur une pièce
personnelle jamais transmise, puis **lève une erreur technique** :

```
R7 : DELETE interdit sur capture.paiements
     — une correction est une ecriture nouvelle
```

La cause : `capture.pieces` cascade vers `capture.paiements`,
`capture.paiement_justificatifs` et `collab.demandes_sur_piece`, et ces trois
tables portent le garde **strict** `app.deny_mutation()`, qui ignore le drapeau
`malica.piece_effacable`. Le garde permissif a été écrit le 3 septembre pour les
cinq tables qui existaient alors ; les trois autres sont nées les 11 et 12
octobre, par le helper, qui pose le garde strict. Personne n'a relu la liste.

**Portée : toute pièce sur laquelle un règlement a été saisi est
insupprimable.** Or saisir le règlement est exactement ce que le produit demande
de faire juste après la lecture. Le chemin le plus fréquent de l'application est
celui qui condamne la pièce, et l'utilisateur reçoit un message de contrainte
PostgreSQL.

> **Mesuré.** Pièce `personnel` / `capturee` + un paiement.
> Avec le dépôt tel quel : `REFUS -> R7 : DELETE interdit sur capture.paiements`.
> Avec `20261018120000` : `la piece est supprimee`.

### ② L'espace privé n'est privé que du cabinet

L'écran promet mot pour mot : *« Invisible pour votre cabinet, vos sièges et la
vue consolidée »*. Les deux derniers tiers sont faux.

`app.enable_tenant_rls(..., p_visibility => true)` produit :

```sql
(tenant_id in (select app.member_orgs())
 or (vis = 'partage' and tenant_id in (select app.engaged_orgs()))
 or app.is_platform())
```

La première ligne ne regarde pas `vis`. **Et sur les 190 politiques du dépôt,
aucune ne filtre par `auth.uid()` ou `created_by`** : il n'existe aujourd'hui
aucune dimension personnelle dans l'isolation. `vis` ne cache qu'au cabinet.

> **Mesuré.** Un collaborateur photographie une ordonnance, la garde en
> `personnel`. Le dirigeant interroge `capture.pieces` :
> dépôt actuel → **1 ligne vue**. Avec `20261018103000` → **0**, et 1 pour son auteur.

Ce n'est pas une fuite entre clients — R6 tient, les tenants sont étanches.
C'est une promesse d'écran que la base ne tient pas, sur la seule fonctionnalité
du produit dont l'argument est la confidentialité.

### ③ Il manque un lieu : la société

`app.vis_t` ne connaît que `personnel` et `partage`. Team et Premium exigent un
troisième état : la pièce d'un siège doit quitter son espace **sans partir chez
le cabinet**, parce que c'est le propriétaire qui transmet.

Sans lui, deux issues, toutes deux fausses : soit la pièce part directement au
cabinet et le propriétaire perd le contrôle qu'on lui a vendu, soit elle reste
`personnel` et **quitte l'entreprise avec le collaborateur qui part** — ce qui
contredit la règle 1.

### ④ Les orphelins : 46 clés étrangères sans clause, et une porte ouverte

Relevé exhaustif sur les 223 clauses `references` du dépôt :

| | CASCADE | SET NULL | RESTRICT | NO ACTION |
|---|---|---|---|---|
| total | 129 | 35 | 3 | 46 |

Les 46 `NO ACTION` sont presque toutes des pointeurs vers du référentiel
versionné (`jurisdiction_packs`, `rejet_motifs`, `account_roles`) ou des
auto-références de correction (`reverses_id`, `annule_paiement_id`). Elles
agissent en RESTRICT de fait, ce qui est cohérent avec R4 et R10.

**Le vrai orphelin est ailleurs : `identity.entities`.** Dix colonnes
`entity_id` pointent vers elle en `ON DELETE SET NULL`, dont une sur une table
en ajout seul. Résultat : supprimer un établissement est **mi-bloquant,
mi-destructeur** — bloqué par accident dès qu'un paiement y est rattaché (par
le garde R7, pas par une règle métier nommée), et réussi ailleurs en détruisant
silencieusement l'affectation analytique de toutes les pièces, écritures,
factures et immobilisations. Aucun test, aucune contrainte, aucun commentaire
ne traite ce cas.

**Le second : les identités.** `created_by`, `decided_by`, `auteur`, `actor`,
`updated_by` sont des `uuid` nus, sans aucune clé étrangère. Supprimer une
`identity.memberships` — ce que la politique `memberships_del` autorise — révoque
instantanément tout accès sans rien casser, et laisse toutes les traces de la
personne attribuées à un uuid que plus rien ne résout. **Aucune reprise, aucun
transfert de propriété.** Combiné au correctif ②, les pièces personnelles d'un
partant deviennent invisibles de tous : payées, conservées, inatteignables.

### ⑤ La moitié manquante de la règle du retour

`collab.demandes_sur_piece.objet` admet `'rappel'` et `'suppression'`.
**`'suppression'` n'est jamais produit, jamais consommé** : `piece_repondre`
n'agit que sur `'rappel'`, `capture_piece_supprimer` n'a pas de paramètre
d'accord et refuse inconditionnellement toute pièce transmise. La règle « après
transmission, sur accord » n'existe que dans une contrainte CHECK.

### ⑥ Du mort dans le dépôt — R9

- le rôle **`assistant`** est admis par deux CHECK et **attribué par aucun
  chemin** du dépôt ;
- le statut **`'confirmee'`** est admis et jamais posé ;
- `capture.pieces.doublon_de` **n'est pas exposée par `pieces_v`** : la détection
  de doublon strict du 18 septembre est invisible de l'application ;
- une clé étrangère vers `legal.versions` porte sur une colonne supprimée depuis ;
- `20260826143655` contient des **données nominatives en dur**
  (`w.barouni@algoria-factory.com`, `ALGORIA CABINET`).

---

## Ce qui marche déjà, et qu'il ne faut surtout pas refaire

L'audit a trouvé beaucoup plus d'acquis que prévu. À ne pas réécrire :

- **Le multi-organisation fonctionne déjà.** `app.member_orgs()` rend un
  ENSEMBLE, et il n'existe pas de « tenant courant » : l'API pose l'identité,
  la base déduit les tenants. La vue consolidée Premium traverse les
  organisations sans mécanisme nouveau.
- **Le cabinet ne lit que `partage`**, et cette règle est répliquée sur les
  paiements et les justificatifs en interrogeant la pièce, pas leur propre
  colonne (`20261012200000`).
- **Une seule porte pour la visibilité**, signature à trois arguments, l'ancienne
  droppée pour empêcher le contournement par surcharge.
- **L'annulation d'un paiement existe** : `ref.paiement_motifs_annulation`,
  `annule_paiement_id`, index partiel « une seule annulation ».
- **Le rappel d'une pièce par accord du cabinet existe**, inscrit et daté.
- Les épreuves nomment déjà les règles : `rien-ne-part-sans-autorisation`,
  `une-piece-partie-revient-par-accord`, `garder-chez-soi-est-une-decision`,
  `un-paiement-se-corrige`, `le-justificatif-arrive-parfois-apres`.

---

## Les quatorze migrations livrées, et ce qu'elles prouvent

Jouées dans cet ordre, sur le schéma réel, après les 139.

| Fichier | Objet |
|---|---|
| `20261018090000_une_licence_porte_le_forfait_et_ses_places` | `ref.offres` (grille versionnée), `facturation.licences`, rattachement des organisations, `droits_v` |
| `20261018093000_une_lecture_est_un_fait_qui_se_compte` | `facturation.lectures` (ajout seul), `consommation_v`, `lecture_autorisee`, `lecture_consommer` |
| `20261018100000_la_societe_est_un_troisieme_lieu` | `app.vis_t` += `entite` *(seule, PostgreSQL l'exige)* |
| `20261018103000_personnel_veut_dire_a_moi_pas_a_la_societe` | RLS à trois lieux, `app.piece_lisible`, la porte apprend `entite` |
| `20261018110000_un_siege_est_une_place_et_les_places_se_comptent` | plafond de sièges, `pieces_orphelines_v`, `siege_reprendre_sa_place` |
| `20261018120000_la_suppression_libre_l_est_vraiment` | **correctif ①**, et `objet='suppression'` enfin consommé |

### Les cinq scénarios publiés, recalculés par la base

> **Mesuré**, `facturation.droits_v` :

| | prix | lectures | attendu |
|---|---|---|---|
| Team · 1 org · 4 sièges | 45,000 DT | 210 | 45 / 210 ✓ |
| Team · 1 org · 6 sièges | 61,000 DT | 260 | 61 / 260 ✓ |
| Team · 1 org · 10 sièges | 93,000 DT | 360 | 93 / 360 ✓ |
| Premium · 2 org · 5 sièges | 57,000 DT | 265 | 57 / 265 ✓ |
| Premium · 3 org · 8 sièges | 110,000 DT | 460 | 110 / 460 ✓ |

La 11ᵉ place sur Team est refusée : *« cette offre porte 10 place(s) ; elles
sont prises »*.

### Le plafond, mesuré sur une licence Basic

```
65e piece  -> autorisee=true   motif=dans_le_forfait      restantes=1
66e piece  -> autorisee=false  motif=plafond_atteint      restantes=0
relecture  -> autorisee=true   motif=relecture_gratuite   restantes=0
pieces en base = 66 , dont lues = 65
```

Les deux règles du modèle tiennent : **le plafond arrête la lecture, jamais la
capture** — la 66ᵉ pièce existe, non lue, et rien n'est perdu quand le client
régularise ; et **une relecture est gratuite**, parce que si corriger coûtait,
le client apprendrait à ne pas corriger, et Malica cesserait d'apprendre de ses
corrections.

---

## Ce qui reste à faire, et que ces migrations ne font pas

**Côté base** — trois décisions à prendre, aucune n'est technique :

1. **`identity.entities`** : interdire la suppression (archivage comme
   `organizations`), ou exiger une réaffectation préalable. Aujourd'hui, c'est
   ni l'un ni l'autre.
2. **La reprise d'un partant** : `siege_reprendre_sa_place` refuse tant qu'il
   reste des pièces personnelles à trancher, et c'est volontaire — la machine ne
   peut pas distinguer « facture de la société rangée au mauvais endroit » de
   « papier qui m'appartient ». Il faut l'écran qui les fait trancher une par une.
3. **Le mort de R9** : `assistant`, `'confirmee'`, `doublon_de`, la FK morte.
   `knip` ne voit pas le SQL.

**Côté API** — le contrat RPC est gelé et `contrat.test.ts` échoue sur toute
divergence, donc chaque ajout est un acte délibéré. Il manque :

- un dépôt `facturation` : `monForfait`, `consommation`, `sieges`, `inviterSiege` ;
- `capture.supprimer` doit passer le second argument ;
- `collab.demanderSurPiece` doit pouvoir porter `'suppression'` ;
- `read-flow.ts` doit appeler `lecture_autorisee` **avant** le modèle et
  `lecture_consommer` **après** une lecture réussie — une lecture qui échoue ne
  se facture pas.

**Côté web** — les écrans construits les 16 et 17 octobre (capture, bibliothèque
à quatre axes, dossier, chat, paramètres, cabinet) n'ont **aucune route**
correspondante dans `apps/web/src/routes`. Le dépôt a 14 routes PME ; les
maquettes en décrivent une douzaine d'autres. C'est le plus gros écart, et il
n'est pas dans la base.

---

## Le seul risque que ce travail ne lève pas

La grille entière — 65 / 120 / 160 / 360 lectures — repose sur un volume mensuel
de factures d'achat que **Mondher Chaouech n'a jamais confirmé**. Les règles du
16 octobre le disent elles-mêmes : c'est « le seul paramètre que la réponse de
Mondher peut encore invalider ». Les migrations livrées ici rendent ce paramètre
modifiable par une ligne de `ref.offres`, sans déploiement. C'est tout ce qu'on
peut faire tant que la réponse n'est pas là.
