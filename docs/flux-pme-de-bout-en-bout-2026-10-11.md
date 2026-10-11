# Le parcours d'un dirigeant, de bout en bout — ce qu'il voit, ce que ça change

11 octobre 2026. Demande : « décris le flux utilisateur end to end PME, et
chaque étape c'est quoi son impact sur l'app et le user voit quoi ? »

Ce document décrit **l'état réel au 11 octobre 2026**. Ce qui n'existe pas
encore est marqué **À CONSTRUIRE**, avec la place exacte qu'il prendra. Rien
n'est décrit comme fait s'il ne l'est pas.

---

## Le parcours en une image

```
   0  Il arrive                     compte, dossier, cabinet
   1  Il photographie               ●  la pièce naît, chez lui seul
   2  Malica lit                    ●  plan de jetons → désignation → relecture
   3  Il vérifie                    ●  le seul moment où il décide des chiffres
   4  Il dit comment c'est payé     ◌  À CONSTRUIRE
   5  Il range                      ●  coffre, ou cabinet
   6  Le reçu                       ◌  À CONSTRUIRE
   7  Le cabinet travaille          ●  supervision, écriture
   8  Il regarde ses chiffres       ●  charges, TVA, échéances
```

---

## 0 · Il arrive

**Ce qu'il voit.** Un écran de bienvenue, une fois. Puis l'accueil.

**Ce que ça change dans l'app.** Un compte, une organisation, et sa **fiche
fiscale** — matricule, régime, clôture d'exercice. Cette fiche n'est pas un
formulaire administratif : elle décide de trois choses, plus tard.

| Ce qu'il saisit    | Ce que ça décide                                      |
| ------------------ | ----------------------------------------------------- |
| Matricule fiscal   | le SENS de chaque pièce, sans rien demander           |
| Clôture d'exercice | les douze mois que montrent tous ses écrans           |
| Juridiction        | le pack : taux, comptes, mentions, moyens de paiement |

**Le piège, déjà rencontré.** Une fiche sans matricule est permise — une
société en cours d'immatriculation doit pouvoir commencer. Mais alors Malica
ne peut plus déduire achat ou vente, et elle le dit au lieu de deviner.

---

## 1 · Il photographie

**Ce qu'il voit.** Le bouton central, l'appareil photo, et c'est tout. La
pièce apparaît dans sa liste en quelques secondes, avec la mention « en cours
de lecture ».

**Ce que ça change.** Une ligne dans `capture.pieces`, les octets chiffrés
dans l'archive, une empreinte scellée sur le flux reçu.

**Et une décision qui a coûté deux défauts** : la pièce naît **chez lui
seul** (`vis = 'personnel'`). Le 4 octobre, rien ne partait et personne ne le
disait ; on a alors transmis d'office, et le 7 une facture rejetée était déjà
chez le comptable. La transmission est depuis un geste, à l'étape 5.

**Hors ligne**, la photo entre dans une file locale et part quand le réseau
revient. Il ne voit rien d'autre qu'une pastille.

### ◌ À CONSTRUIRE, et ça se place ICI

**L'écran « ce que c'est »**, demandé le 10 octobre : facture d'achat, facture
de vente, reçu, extrait bancaire, document de gouvernance, autre.

**Pourquoi avant la lecture et non après** : le type décide de l'invite, et
l'invite décide de la qualité. Lire un extrait bancaire avec une invite de
facture donne une facture ratée plutôt qu'un document reconnu — et un
document de gouvernance n'appelle alors aucun modèle, donc ne coûte rien.

Le référentiel `ref.document_types` porte déjà les six, avec `porte_ecriture`
et `transmissible`. Il attend qu'un écran l'appelle.

---

## 2 · Malica lit

**Ce qu'il voit.** Rien, ou presque : quelques secondes d'attente. C'est
voulu — il n'a rien à faire ici.

**Ce qui se passe réellement**, et c'est la partie dont dépend tout le reste :

1. **Le plan de jetons.** La page est découpée en jetons, chacun avec sa
   position. C'est le seul texte qui existe.
2. **La désignation.** Un modèle reçoit le plan — **jamais l'image des
   montants** — et ne rend que des `page`/`ordinal`. Il DÉSIGNE, il ne lit
   pas.
3. **La relecture.** Les valeurs sont relues dans le plan, jamais dans la
   réponse du modèle. C'est ce qui rend l'invention impossible : un montant
   qui n'est pas sur la pièce n'a pas de jeton à citer.
4. **Le sens.** Le matricule du dossier est comparé aux matricules lus. Côté
   client → achat ; côté émetteur → vente. Une comparaison, pas un jugement.
5. **Le garde arithmétique.** Σ HT + TVA + droits = TTC. S'il ne tombe pas,
   **aucun montant n'est retenu**.

**Ce qu'il voit si ça se passe mal.** Pas un écran blanc : une phrase qui dit
quoi, et le geste qui débloque.

---

## 3 · Il vérifie — le seul moment où il décide des chiffres

**Ce qu'il voit.** « Voici ce que j'ai lu », l'image de la pièce, les montants,
et chaque ligne cliquable pour **situer la valeur sur le papier**. Puis une
question : « Je lis un total de 613,493 TND. C'est bien le bon montant ? »

**Les questions qui n'apparaissent que si besoin :**

- **Achat ou vente**, uniquement quand le matricule n'a pas tranché. Si la
  facture porte le matricule du dossier, la question ne se pose pas — c'est
  la règle « aucune question dont le produit connaît déjà la réponse », et
  c'est pour cela qu'elle ne s'affiche pas sur vos factures.
- **La date**, si elle n'a pas été lue.

**Ce que ça change quand il confirme.** Une proposition d'écriture est
calculée **par le serveur** et enregistrée. Aucune ligne ne vient du
téléphone.

**Quand il ne peut pas confirmer**, le bouton est inactif et la raison est
**au-dessus**, en français clair. Jusqu'au 10 octobre elle était en 12,5 px
en dessous, donc hors de l'écran.

### ◌ À CONSTRUIRE — étape 4 : comment c'est payé

Huit moyens, **déjà en base** depuis le 11 octobre avec leur compte de
trésorerie : espèces, chèque, chèque de banque, carte, virement, traite,
autre, et **pas encore payé**.

Sauf espèces, une photo du justificatif — talon, ticket, avis — rattachée à
la facture et transmise avec elle. Elle **ne bloque pas** : un écran qui
refuse d'avancer se contourne en cochant « espèces », et l'information est
perdue au lieu d'être gagnée.

---

## 5 · Il range

**Ce qu'il voit.** Deux boutons de même poids : « Envoyer à [cabinet] » et
« Garder pour moi ». Aucun n'est présenté comme le bon.

**Ce que ça change, et c'est la décision la plus lourde du parcours :**

|                      | Garder          | Envoyer                              |
| -------------------- | --------------- | ------------------------------------ |
| Qui la voit          | lui seul        | lui et son cabinet                   |
| Date de transmission | aucune          | posée, à la seconde                  |
| Sa TVA               | **compte zéro** | entre dans la déclaration de ce mois |
| Revenir en arrière   | libre           | **demande au cabinet**               |

**La TVA suit l'envoi, et c'est votre règle du 10 octobre.** Une TVA se
récupère sur une déclaration ; le cabinet ne déclare que ce qu'il a reçu. Une
pièce au coffre n'entre dans aucune déclaration, donc pèse zéro — ce n'est
pas une panne, c'est la règle.

**Le retour en arrière se demande.** J'avais livré un rappel unilatéral le 10
octobre ; vous l'avez corrigé le 11. Le cabinet travaille sur ce qu'il a
reçu, et une pièce qui disparaît de sa file sans un mot est pire que l'état
bloqué. Un refus doit porter sa note.

### ◌ À CONSTRUIRE — étape 6 : le reçu

Un PDF qui cite la facture, le paiement, son justificatif, le moyen, la date
et le verdict. Son type existe déjà, à `porte_ecriture = false` : un document
qui ressemble à une pièce justificative serait tôt ou tard comptabilisé, et
la dépense comptée deux fois.

---

## 7 · Le cabinet travaille

**Ce que le cabinet voit.** La pièce dans sa file, l'image, les citations
regroupées par zone, les signalements de lecture groupés par cause, et la
proposition d'écriture.

**Ce qu'il peut faire.** Valider, ou retourner avec un motif **gouverné** —
issu de `ref.rejet_motifs`, traduit, pas une phrase libre.

**Ce que le dirigeant voit alors.** Une pièce retournée remonte en tête de
son accueil, avec le motif et le nom du cabinet.

**Ce qui n'existe pas encore** : le téléchargement d'une pièce partagée par
le cabinet, et la réponse du comptable aux questions posées par Malica. Les
deux sont demandés le 11 octobre et ne sont pas construits.

---

## 8 · Il regarde ses chiffres

Trois écrans, **trois dates différentes**, et chacun le dit maintenant :

| Écran             | Range par                   | Pourquoi                         |
| ----------------- | --------------------------- | -------------------------------- |
| **Vos charges**   | date de la **facture**      | la dépense appartient à son mois |
| **Votre TVA**     | date d'**envoi** au cabinet | il déclare ce qu'il reçoit       |
| **Vos documents** | date de la **facture**      | même règle que les charges       |
| _(cabinet)_       | date d'**écriture**         | c'est son journal                |

**Ce n'est pas une incohérence, c'est quatre questions différentes.** Ce qui
était faux jusqu'au 10 octobre, c'est qu'aucun écran ne disait laquelle il
employait : « Vos charges 222 000 » contre « Votre TVA 0 » le 5 octobre,
« 1 document » contre « 0 document » le 8. Deux défauts, une seule cause.

---

## Ce qui reste à construire, dans l'ordre et avec sa raison

| #   | Quoi                                  | Pourquoi maintenant                           |
| --- | ------------------------------------- | --------------------------------------------- |
| 1   | L'écran « ce que c'est »              | il conditionne la qualité de toute lecture    |
| 2   | L'écran du paiement + la photo        | la base l'attend depuis le 11 octobre         |
| 3   | Le reçu en PDF                        | il clôt le parcours                           |
| 4   | Le téléchargement côté cabinet        | demandé le 11                                 |
| 5   | La réponse du comptable aux questions | demandé le 11                                 |
| 6   | La pile « en attente de date »        | elle existe en base, aucun écran ne la montre |
| 7   | Les documents téléversés              | même tuyau, pas une seconde chaîne            |

---

## Les trois règles qui tiennent tout le parcours

1. **Aucun chiffre sans son jeton.** Un montant pointe vers ce qui le porte,
   ou vaut `null` avec un drapeau. Le modèle désigne, il ne lit pas.
2. **Aucun état que personne n'a choisi.** La transmission, le sens, le
   rangement : chacun est un geste, pas un défaut silencieux. Les trois
   défauts les plus coûteux de ces deux semaines venaient d'un état décidé
   par le produit.
3. **Chaque écran dit de quoi il parle.** Quatre dates coexistent
   légitimement ; les confondre produit des chiffres plausibles et faux, ce
   qui est la pire forme d'erreur.
