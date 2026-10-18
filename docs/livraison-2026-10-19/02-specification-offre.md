# La grille, et les quatre règles d'interaction

*17 octobre 2026 — supersède la section 4 de `malica-office-regles-et-scenarios-2026-10-16`*

## La grille

| | HT / mois | TTC | Organisations | Sièges | Lectures |
|---|---|---|---|---|---|
| **Basic** | 9 DT | 11,71 | 1 | vous seul | 65 |
| **Solo** | 19 DT | 23,61 | 1 | vous seul | 120 |
| **Team** | 29 DT | 35,51 | 1 | vous **+ 2 inclus**, puis **+8 DT**, max 10 | 160, +25 par siège |
| **Premium** | 49 DT | 59,31 | 2 incluses, +29 DT, max 10 | vous **+ 4 inclus**, puis **+8 DT**, max 20 | 120 par organisation, **mises en commun** |

Elle vit dans `ref.offres`, versionnée par `effective_from`. Changer un prix est
une ligne de migration, jamais un déploiement — et une pièce lue en octobre
reste explicable avec la grille d'octobre.

### Pourquoi la grille du 16 octobre ne tenait pas

**Team et Premium se croisaient à 49 DT.** Team à 6 sièges = 29 + 4×5 = 49 DT /
260 lectures / 1 société. Premium = 49 DT / 240 lectures / 6 sièges / 2 sociétés
+ vue consolidée. Pour vingt lectures, le client prenait Premium.

**Un cas courant n'avait aucune offre** : deux sociétés et cinq collaborateurs
dans l'une. Premium plafonnait à 3 sièges par organisation, Team à une
organisation.

**Le quota par organisation créait un mur absurde** : 200 lectures nécessaires
chez El Manar, bloquées à 120, pendant que 230 dormaient chez les deux autres.

Trois changements, et trois seulement :

1. **Le siège passe de 5 à 8 DT, au même prix partout.** Il portait 25 lectures
   (1 DT de coût) mais aussi l'isolation, la chaîne de validation et le journal.
2. **La règle « 3 sièges par organisation » disparaît.**
3. **Le propriétaire ne consomme pas de place.** Il détient la licence.

### Le croisement est mort — recalculé par la base le 18 octobre

| Besoin | Team | Premium | Retenu | `droits_v` |
|---|---|---|---|---|
| 1 société, 4 sièges | **45 DT** · 210 | 57 DT | Team | 45,000 / 210 ✓ |
| 1 société, 6 sièges | **61 DT** · 260 | 65 DT | Team | 61,000 / 260 ✓ |
| 1 société, 10 sièges | **93 DT** · 360 | 81 DT + orgs inutiles | Team | 93,000 / 360 ✓ |
| 2 sociétés, 5 sièges | impossible | **57 DT** · 265 | Premium | 57,000 / 265 ✓ |
| 3 sociétés, 8 sièges | impossible | **110 DT** · 460 | Premium | 110,000 / 460 ✓ |

**L'échelle ne s'inverse nulle part.** Marges (coût modèles 0,04 DT la lecture) :
71 % → 75 % → 78 % → 80 % → 82 % → 85 %. Elles montent toujours.

## Les quatre règles d'interaction

**La licence porte le forfait et ses places ; un siège est une place, pas une
licence.** D'où `facturation.licences` au-dessus du tenant, et non un abonnement
par organisation — qui rendrait Premium inexprimable.

**Le quota se calcule par organisation et se consomme en commun.** 120 × 3 = 360
pour le groupe.

**Perdre sa licence n'arrête pas la caméra.** Trente jours de capture restent
ouverts au détachement d'un cabinet uniquement. Sur impayé, l'entité devient
inactive — sinon le plafond cesse d'être un levier.
→ `lecture_autorisee` rend `licence_suspendue` et la capture n'est jamais bloquée.

**Compte personnel gratuit, 0 DT.** Celui qui quitte l'organisation garde son
espace personnel en consultation et export, sans dépôt ni lecture.

## Bibliothèque et espace privé : deux propriétaires

**La bibliothèque appartient à l'entité. L'espace privé appartient au compte.**

**B6 renforcé** — une pièce personnelle n'est jamais lue, donc la question se
pose AVANT la lecture. La poser après, c'était débiter le quota de la société
pour un papier qui ne la regarde pas.
→ `lecture_autorisee` rend `piece_personnelle` et ne consomme rien.

**B7 resserré** — un siège ne peut marquer « personnel » qu'au moment de la
capture. Après, sortir une pièce de la société relève du propriétaire — sinon
la facture qu'un collaborateur glisse dans son espace privé quitte l'entreprise
avec lui.
→ `capture_piece_set_vis` lève *« sortir une piece de la societe releve du
proprietaire »*.

## Ce que l'audit du 18 a dû ajouter pour que tout cela existe

| Règle | Existait ? | Où elle vit maintenant |
|---|---|---|
| La grille | non | `ref.offres` |
| La licence au-dessus du tenant | non | `facturation.licences` + `licence_organisations` |
| Le quota mis en commun | non | `facturation.droits_v` |
| Le compteur de lectures | non | `facturation.lectures`, ajout seul |
| Le plafond qui mord | non | `lecture_autorisee` / `lecture_consommer` |
| Le plafond de sièges | non | déclencheur sur `identity.memberships` |
| Une relecture gratuite | — | `unique (piece_id)` sur `facturation.lectures` |
| L'espace privé vraiment privé | **non** | politique à trois lieux + `app.piece_lisible` |
| Le troisième lieu | non | `app.vis_t` += `entite` |

## Les règles de cohérence que la base tient désormais

- une organisation appartient à **exactement une** licence (`unique (tenant_id)`) ;
- le titulaire d'une licence doit être **dirigeant** de chaque organisation qu'il
  y rattache ;
- la même personne siégeant dans deux sociétés du groupe occupe **une** place ;
- un dirigeant et un expert n'occupent **aucune** place ;
- une pièce ne se compte **qu'une fois**, même relue, même corrigée ;
- supprimer une pièce **ne rend pas** la lecture (`ON DELETE RESTRICT` sur
  `facturation.lectures.piece_id`) — sinon le quota du mois se rouvrirait à
  chaque suppression, et la suppression est libre avant transmission.
