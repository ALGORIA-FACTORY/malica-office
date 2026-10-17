# Retour, correction, suppression — la règle unique

*17 octobre 2026, annoté le 18 après audit du dépôt*

## La règle

> Tant que personne ne l'a reçu, c'est libre.
> Dès que quelqu'un l'a reçu, il faut son accord.

Deux récepteurs seulement, dans cet ordre : **le propriétaire** (pour ce qu'un
siège lui envoie) puis **le cabinet** (pour ce que l'entité lui transmet). Rien
d'autre ne verrouille — ni l'ancienneté, ni le fait que Malica ait lu, ni la
clôture du mois.

| État | Corriger | Supprimer |
|---|---|---|
| **Chez vous** — rien n'est sorti | libre, daté | libre, sans trace |
| **Chez le propriétaire** — un siège a envoyé | libre (c'est votre saisie) | demande au propriétaire |
| **Chez le cabinet** — transmis | renvoie la pièce en « à revalider » | demande au cabinet, décision au journal |

> **Note d'audit, 18 octobre.** Ces trois états exigent trois valeurs de
> `app.vis_t`, et le dépôt n'en avait que deux. `20261018100000` ajoute `entite`.
> Sans elle, l'état du milieu — « parti chez le propriétaire, pas chez le
> cabinet » — était inexprimable en base.

## L'exception : le paiement ne se corrige pas

Un règlement est un fait, pas un champ. R7 interdit la réécriture : on **ajoute
une annulation datée et motivée**, et les deux lignes restent lisibles. Le
référentiel `ref.paiement_motifs_annulation` existe déjà, ainsi que
`annule_paiement_id` et l'index partiel « une seule annulation par paiement ».
L'écran ne propose donc jamais « Modifier » mais « Corriger un règlement » →
motif → *annulation inscrite*.

Ce n'est pas un accord à demander : c'est une mécanique. Elle vaut avant comme
après la transmission.

## Le relevé, écran par écran

| Objet | Où | Retour | Supprimer | Verrou |
|---|---|---|---|---|
| Photo non lue | capture | Refaire | Supprimer | — |
| Lecture faite, non transmise | capture · fin | Revoir ce que j'ai lu | Supprimer une pièce | — |
| Pièce, non transmise | dossier | Corriger la lecture | Supprimer la pièce | — |
| Pièce, chez le propriétaire | dossier · siège | Corriger la lecture | Demander la suppression | propriétaire |
| Pièce, transmise | dossier | Corriger et la renvoyer | Demander la suppression | cabinet |
| Règlement | dossier | **annulation motivée** | idem | mécanique (R7) |
| Document de l'espace privé | privé · capture | — | libre, toujours | — |
| Pièce société → espace privé | privé | retour libre vers la société | — | sortir : accord |
| Rubrique renommée | rubriques | nom d'origine, autant de fois | non : les pièces y perdraient leur compte ; vide, elle disparaît seule | propriétaire |
| Collection | rubriques | renommer | libre — elle ne porte aucun compte | propriétaire |
| Fil de discussion | chat | — | libre, sauf avis rendu | cabinet si avis |
| Document déposé par le cabinet | cabinet | signaler une erreur | non — ce n'est pas à nous de retirer ce qu'il nous remet | cabinet |

## Les deux refus assumés

1. **Une rubrique du référentiel ne se supprime pas.** Les pièces rangées dedans
   perdraient leur compte comptable. Elle se renomme, et disparaît d'elle-même
   quand elle est vide.
2. **Un document déposé par le cabinet ne se supprime pas depuis l'app PME.** Il
   est à nous, mais c'est lui qui l'a remis ; on peut le lui signaler, pas le
   retirer.

## État de la règle dans le dépôt, au 18 octobre

| | avant l'audit | après `20261018120000` |
|---|---|---|
| Suppression libre avant transmission | **échoue** dès qu'un paiement existe | fonctionne |
| `objet = 'suppression'` | admis par le CHECK, jamais produit ni consommé | produit par la PME, tranché par le cabinet |
| `capture_piece_supprimer` | aucun paramètre d'accord | `p_par_accord`, que seul `piece_repondre` passe |
| Rappel d'une pièce transmise | fonctionnait déjà | inchangé |
| Annulation d'un règlement | fonctionnait déjà | inchangé |

**Reste ouvert** : une correction après transmission doit repasser la pièce en
`à revalider` et prévenir le cabinet. Le statut n'existe pas — `capture.pieces.status`
admet `retournee`, qui en est proche mais n'a pas la même signification. À
trancher avec Mondher avant d'écrire la migration.
