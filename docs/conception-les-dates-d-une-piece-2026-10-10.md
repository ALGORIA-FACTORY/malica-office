# Les quatre dates d'une pièce — note de conception

10 octobre 2026. Le commanditaire photographie en octobre une facture datée du
3 février, et pose la bonne question : « elle sera transmise au comptable en
octobre pour la constater ? Je crois qu'il faut bien concevoir ce volet. »

Il a raison, et ce n'est pas une question d'écran. C'est la cause d'un défaut
déjà constaté.

---

## Ce que ce volet a déjà coûté

Le 5 octobre, _Vos charges_ affichait 222 000 et _Votre TVA_ zéro, pour le même
mois. Les deux écrans avaient raison : l'un lisait la **date de la facture**,
l'autre la **date de l'écriture**. Aucun ne disait laquelle.

Le 8 octobre, l'accueil affichait « 1 document » et _Vos documents_ « 0 en
octobre ». Même cause, autre couple d'écrans : la **date du scan** contre la
**date de la facture**.

Deux défauts, une seule question non tranchée. Chaque écran l'a tranchée dans
son coin, et c'est ainsi qu'on obtient un produit qui se contredit sans mentir.

---

## Les quatre dates, et ce que chacune décide

| Date                   | Ce qu'elle décide                      | Qui la fixe    |
| ---------------------- | -------------------------------------- | -------------- |
| **Datée du** (facture) | à quel mois appartient la **charge**   | le fournisseur |
| **Reçue le** (scan)    | quand la pièce est arrivée chez la PME | la PME         |
| **Envoyée le**         | quand le cabinet l'a eue               | la PME         |
| **Comptabilisée le**   | quand elle entre au **journal**        | le comptable   |

Quatre dates ne sont pas un défaut : ce sont quatre faits distincts, et ils
existent tous. Le défaut est de laisser un écran en afficher une sans le dire.

**Les noms comptent.** Quatre mots courants, pas un de vocabulaire comptable :
_datée du_, _reçue le_, _envoyée le_, _comptabilisée le_. Jamais « période »,
jamais « date d'imputation ».

---

## La règle, en une phrase

> **La pièce vit à la date de sa facture. Tout le reste est un fait
> d'acheminement : visible, jamais classant.**

La date de la facture est la seule qui soit une propriété de **la dépense**.
Les trois autres sont des propriétés de **sa manutention**. Classer une dépense
par la façon dont elle a été acheminée, c'est ce que faisait le repli au mois
du scan corrigé le 5 octobre — et c'était faux.

---

## Ce qui rend le cas de février inoffensif, et ce qui reste vrai

**Février 2026 et octobre 2026 sont le même exercice.** Le comptable passe
l'écriture en octobre — c'est la date de son journal — et l'impute à février.
Le résultat annuel est juste. Il n'y a aucun conflit à résoudre.

Deux choses seulement changent :

1. **La déclaration de TVA de février est déposée.** La récupération se fera
   sur une déclaration encore ouverte, et l'écran doit le dire.
2. **Les écrans par mois** : la facture pèse sur février, pas sur octobre.

Le seul cas réellement difficile est **la facture d'un exercice antérieur**.
Elle ne se range pas toute seule : elle part en « à trancher avec le cabinet ».

---

## Les trois mécanismes que je propose

### 1. Une seule date classe, et c'est celle de la facture

Tous les écrans de la PME — charges, documents, TVA récupérée — lisent la même
source et la même date. Les trois définitions concurrentes disparaissent.

L'écran du cabinet, lui, affiche la **date d'écriture** : c'est son journal, et
c'est ce qu'il doit voir. Chaque écran porte la mention de la date qu'il
emploie. C'est cette mention, et non la règle, qui empêche les deux chiffres de
se contredire en silence.

### 2. Le retard devient un objet nommé, pas un effet de bord

Quand le mois de la facture n'est pas le mois de la réception, Malica ne se
contente pas de ranger : elle **le dit, et le compte**.

- sur la pièce : « Datée du 3 février · reçue le 9 octobre »
- dans une liste que le dirigeant peut ouvrir : les pièces arrivées en retard
- sur l'écran de TVA : sur quelle déclaration encore ouverte la récupération
  est proposée

**Il est dérivé, pas stocké** : deux dates que la pièce porte déjà suffisent à
le calculer. Rien de nouveau à maintenir, et le jour où le référentiel change
ce qui compte comme « en retard », il suit sans migration.

Pourquoi un objet et pas une simple étiquette : parce qu'un objet se compte, se
teste, et se transmet. « Voici 6 pièces en retard dans cet envoi » est
exactement la phrase qui évite une discussion entre la PME et son cabinet.

### 3. La transmission porte un bordereau daté

Quand le dirigeant envoie en octobre, le cabinet reçoit un en-tête :

> Transmis le 9 octobre — 4 pièces : 3 d'octobre, 1 de février (exercice
> courant), 0 d'exercice antérieur.

Le comptable sait en une ligne ce qu'il va devoir imputer ailleurs que dans le
mois courant. C'est peu de travail et c'est ce qui fait tenir la relation.

---

## Le point délicat, et ma réponse

Si tout se classe à la date de la facture, **le mois que le dirigeant est en
train de vivre paraît vide** alors qu'il vient d'envoyer quatre factures. Pour
quelqu'un qui n'est pas comptable, c'est décourageant et cela ressemble à une
panne.

La tentation serait de reclasser au mois du scan « pour que ça se voie ». C'est
exactement l'erreur du 5 octobre.

**Ma réponse : deux lectures sur le même écran, et le défaut est la comptable.**

- _Vos charges — octobre_ montre les charges **d'octobre**, par date de facture.
- Et dessous, une ligne permanente : « **+ 3 factures d'autres mois reçues en
  octobre** › », qui mène à la liste d'arrivée.

Rien n'est caché, rien n'est mal rangé. Le dirigeant voit **son vrai octobre**
et **son travail d'octobre**, nommés séparément. C'est la distinction que le
produit doit lui apprendre, et c'est celle que Dext et Pennylane laissent
floue.

---

## La quatrième pile, invisible aujourd'hui

Une pièce dont la date n'a pas été lue n'a **aucun mois** depuis le 5 octobre —
c'était la correction du repli silencieux. Mais **aucun écran ne montre cette
pile**. Une pièce en attente de date est aujourd'hui invisible : elle n'est plus
mal rangée, elle a disparu.

Le dépôt porte déjà le nécessaire : `charges.enAttenteDeDate` compte les
articles, les pièces et leur total. Rien ne l'appelle. C'est, une fois de plus,
un outil juste qu'aucun écran n'importe.

---

## Ce que je n'écrirai pas moi-même

Deux valeurs sont réglementaires, donc elles vivent dans le référentiel, datées
et surchargeables (R4), et c'est l'expert-comptable qui les arrête :

1. **Jusqu'à quand une TVA tunisienne reste récupérable** — c'est elle qui
   désigne « la première déclaration encore ouverte ».
2. **Le traitement d'une charge sur exercice antérieur.**

À poser à Mondher Chaouech. Tant qu'elles ne sont pas arrêtées, Malica
**signale** ces pièces au lieu de les ranger : un référentiel silencieusement
faux produit un résultat plausible, et c'est la pire forme d'erreur.

---

## Ce qui rend cette conception vérifiable

Trois épreuves, et la troisième manque depuis le 5 octobre :

1. Une pièce dont le mois de facture diffère du mois de scan apparaît dans
   **exactement un** mois de _Vos charges_ : celui de la facture.
2. La somme de _Vos charges_ sur l'exercice égale la somme des pièces par date
   de facture — aucune pièce perdue, aucune comptée deux fois.
3. **Deux écrans qui parlent du même mois donnent des chiffres conciliables.**
   C'est l'épreuve de cohérence nommée comme manquante dans le diagnostic du
   5 octobre, et c'est elle qui aurait attrapé les deux défauts cités en tête.

---

## Ce que cela coûte

Des écrans, un port de lecture, aucune migration de données, **aucun appel de
modèle** — donc aucun coût par pièce. Le « retard » est dérivé de deux dates
déjà présentes. La seule migration éventuelle est celle du référentiel, quand
l'expert aura arrêté les deux valeurs ci-dessus.

Je ne commence pas sans votre feu vert.
