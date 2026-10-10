# Le parcours d'une pièce, de la photo au reçu — note de conception

10 octobre 2026. Le commanditaire décrit le parcours qu'il attend :

> Normalement après le scan un écran apparaît pour que l'utilisateur choisisse
> autre document, achat ou vente, extrait bancaire, gouvernance. Et après le
> choix Malica lit le document sur cette base.
> Aussi Malica génère le reçu de dépense ou de revenu et le moyen de paiement.
> Concernant le moyen de paiement il doit être choisi entre la liste suivante
> dans un écran qui suit la lecture : espèce, chèque, carte bancaire, traite,
> chèque de banque, virement ou autre.
> À l'exception d'espèces les autres on doit prendre une photo et le rattacher
> à la facture. Et qui doit être transmis au comptable avec la photo.

Et : « check the current process ».

---

## Le parcours d'aujourd'hui, relevé

```
  photo  →  lecture  →  écran de vérification  →  [confirmer]
                              ├─ achat / vente, SI le matricule n'a pas tranché
                              └─ envoyer au cabinet / garder
```

Quatre manques, et ils ne sont pas de même nature.

**1. Rien ne demande ce qu'est le document.** La lecture part en aveugle sur
une invite de facture. Un extrait bancaire, un PV d'assemblée, un contrat sont
lus comme des factures, et le résultat est une facture ratée plutôt qu'un
document reconnu.

**2. La question achat/vente n'est posée que si la déduction échoue.** C'est
voulu — « aucune question dont le produit connaît déjà la réponse » — mais
elle arrive APRÈS la lecture, alors qu'elle devrait l'orienter.

**3. Le moyen de paiement n'existe nulle part.** Ni écran, ni donnée, ni
référentiel. Conçu le 7 octobre, jamais construit.

**4. Le reçu n'existe pas davantage.** Même date, même état.

---

## Ce que je propose, et pourquoi dans cet ordre

```
  photo
    │
    1  CE QUE C'EST            une question, avant la lecture
    │
    2  LECTURE                 l'invite suit le type choisi
    │
    3  CE QUE J'AI LU          vérification, et achat/vente si non déduit
    │
    4  COMMENT C'EST PAYÉ      + la photo du justificatif, sauf espèces
    │
    5  OÙ ÇA VA                mon coffre · mon comptable
    │
    6  LE REÇU                 produit sans rien demander
```

### 1 · Ce que c'est — avant la lecture, et c'est nouveau

Six choix, et ils viennent du **référentiel** (`ref.document_types` existe
depuis le 2 septembre et porte déjà `porte_ecriture`), jamais d'une liste
écrite en TypeScript (R4) :

| Choix                       | Ce que ça change                                |
| --------------------------- | ----------------------------------------------- |
| **Facture d'achat**         | invite de facture, sens imposé, imputation 6xx  |
| **Facture de vente**        | invite de facture, sens imposé, imputation 7xx  |
| **Reçu / ticket**           | invite courte : pas de matricule client attendu |
| **Extrait bancaire**        | lecture en lignes d'opérations, pas en articles |
| **Document de gouvernance** | archivé et indexé, **aucune écriture**          |
| **Autre document**          | archivé, lu en texte, aucune imputation         |

**Pourquoi avant la lecture, et pas après.** Le type décide de l'invite, et
l'invite décide de la qualité. Lire un extrait bancaire avec une invite de
facture produit un résultat plausible et faux — la forme d'erreur que R4 nomme
la pire. Et cela coûte moins cher : un document de gouvernance n'appelle aucun
modèle de vision.

**Le coût d'une question de plus est réel.** Il se paie une fois, en deux
secondes, et il évite une lecture ratée qui en coûte trente. Mais le défaut
doit être le cas courant — _Facture d'achat_ présélectionné, et un seul geste
pour valider.

**Et la déduction garde le dernier mot sur le sens.** Si la personne dit
« achat » et que son matricule est du côté émetteur, la comparaison gagne et
le dit. Une déclaration n'est pas une preuve ; c'est une intention.

### 2 · Lecture — un seul moteur, plusieurs invites

Rien de nouveau dans la chaîne : le plan de jetons, la désignation, la
relecture, le garde arithmétique restent identiques (R2). Seule l'invite
change, et elle est **choisie par le type**, pas devinée.

### 3 · Ce que j'ai lu — inchangé

L'écran existe. La question achat/vente n'apparaît que si ni le matricule ni
le choix de l'étape 1 n'ont tranché.

### 4 · Comment c'est payé — l'écran qui manque

Les sept moyens demandés, plus un huitième que j'ajoute et que je défends :

| Moyen               | Justificatif       | Compte de trésorerie                 |
| ------------------- | ------------------ | ------------------------------------ |
| Espèces             | aucun              | caisse                               |
| Chèque              | photo du talon     | banque                               |
| Chèque de banque    | photo              | banque                               |
| Carte bancaire      | photo du ticket    | banque                               |
| Traite              | photo de la traite | effets à payer                       |
| Virement            | photo de l'avis    | banque                               |
| Autre               | photo              | **à déclarer**                       |
| **Pas encore payé** | aucun              | _aucun_ — la pièce reste « à payer » |

**Le huitième est indispensable.** Sans lui, une facture à trente jours
n'aurait aucune réponse possible et la personne choisirait n'importe quoi pour
avancer. C'est aussi la question la plus rentable du lot : elle donne les
échéances fournisseurs sans aucune saisie.

**Les comptes de trésorerie vivent dans le pack**, datés et surchargeables
(R4). Un moyen de paiement écrit en dur donnerait une écriture fausse dans la
première juridiction suivante.

**La photo du justificatif est une pièce à part entière** : même capture, même
archive couleur, même chiffrement. Elle est **rattachée** à la facture, jamais
autonome, et son type porte `porte_ecriture = false` — sans quoi le comptable
la passerait une seconde fois et la dépense serait comptée deux fois.

**Ce que je ne ferai pas :** bloquer l'avancement si la photo manque. Un
dirigeant qui n'a pas son talon sous la main doit pouvoir continuer, avec la
pièce marquée « justificatif manquant » et la liste qui le lui rappelle. Un
écran qui refuse d'avancer se contourne en choisissant « espèces », et on perd
l'information au lieu de la gagner.

### 5 · Où ça va — deux boutons de même poids

Existe déjà. Le classement est automatique dans les deux cas : famille de
charge et mois de la pièce. On ne choisit pas un dossier, on choisit qui voit.

### 6 · Le reçu — produit, jamais comptabilisable

Un PDF, rattaché à la pièce et à son justificatif, qui cite : l'émetteur, la
date, le total, la TVA, le moyen de paiement, la date de paiement, et le
verdict de lecture. Aucun chiffre n'y est calculé : tous viennent du Socle et
portent leur citation (R3).

**Dépense ou recette selon le sens de la pièce** — c'est la même machine, et
en faire deux les ferait diverger en six semaines.

**Son type porte `porte_ecriture = false`.** C'est le point sur lequel je ne
céderai pas sans que vous le disiez explicitement : un PDF qui arrive chez le
comptable et ressemble à une pièce justificative sera tôt ou tard comptabilisé.

---

## Les trois risques, nommés avant de commencer

**La retenue à la source croise ce flux.** Sur des honoraires ou un loyer, ce
qui est payé n'est pas ce qui est facturé. L'écran du paiement doit accepter
que le montant payé diffère du TTC et le dire — sinon il fera croire à un
écart de lecture là où il y a une retenue légale.

**Un paiement partiel existe.** Un acompte, puis le solde. Le modèle doit donc
porter _des_ paiements rattachés à une pièce, pas _un_ moyen de paiement dans
une colonne. Faire l'inverse est facile aujourd'hui et coûte une migration
pénible dans deux mois.

**Une question de plus est une occasion d'abandonner.** Quatre écrans font
quatre occasions. Ils descendent donc dans UNE page qui défile, avec les
réponses déjà connues pré-remplies, et chaque étape franchissable en un geste.

---

## Ce que cela demande, dans l'ordre, et ce que chaque lot coûte

| #   | Lot                                                  | Base      | Modèle | Visible |
| --- | ---------------------------------------------------- | --------- | ------ | ------- |
| 1   | Le type de reçu, `porte_ecriture = false`            | migration | —      | non     |
| 2   | Les moyens de paiement au pack, avec leur compte     | migration | —      | non     |
| 3   | Les paiements d'une pièce (table, append-only R7)    | migration | —      | non     |
| 4   | L'écran « comment c'est payé » + la photo            | —         | —      | **oui** |
| 5   | L'écran « ce que c'est », et l'invite qui en découle | —         | invite | **oui** |
| 6   | Le reçu en PDF                                       | —         | —      | **oui** |
| 7   | Les documents téléchargés entrent dans le même tuyau | —         | —      | oui     |

Le point 7 n'est pas une seconde chaîne : c'est un raccordement. Deux chaînes
divergeraient en six semaines.

**Aucun appel de modèle supplémentaire par pièce**, sauf le point 5, qui en
retire plutôt qu'il n'en ajoute : un document de gouvernance n'appelle plus la
vision.

---

## Les deux questions qui restent, et elles sont à vous

**1. Le reçu de dépense, à quoi sert-il exactement ?** Posée le 7 octobre,
toujours ouverte, et elle ne donne pas le même document :

- une **pièce de caisse** — la preuve interne que la dépense a été payée, pour
  le comptable ;
- un **récapitulatif** pour vous, qui rassemble facture + paiement en un seul
  fichier à classer.

Je penche pour la première, parce que c'est elle qui manque au comptable.

**2. « Autre » comme moyen de paiement : qu'attendez-vous qu'il se passe ?**
Un champ libre, ou une liste que le cabinet complète ? Je propose la seconde :
un champ libre produit vingt orthographes du même moyen et aucune statistique.

Je ne commence pas sans votre feu vert, et je commencerais par les lots 1 à 3
— invisibles, sans risque, et ils conditionnent tout le reste.
