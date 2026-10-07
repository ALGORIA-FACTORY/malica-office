# Après la lecture : le paiement, le classement, le reçu — note de conception

7 octobre 2026. Une page, avant d'écrire.

Ce que vous demandez : qu'après la lecture, Malica pose les questions qui
manquent — le sens de la pièce, le moyen de paiement, son justificatif — puis
range la pièce et produise un reçu de dépense qui arrive chez le comptable,
rattaché à toutes les pièces de la transaction. Et que les documents
**téléchargés** suivent le même chemin que les photos.

---

## La suite d'écrans, telle que je la propose

Un seul écran, qui descend. Pas quatre écrans : quatre écrans font quatre
occasions d'abandonner.

**1 · Ce que j'ai lu.** Ce qui existe déjà, avec la TVA et le total désormais
visibles. Rien à faire ici que vérifier.

**2 · Achat ou vente ?** Posé **seulement** quand la déduction n'a pas tranché.
Depuis aujourd'hui, le sens se déduit de la position de votre matricule sur la
pièce : quand il est lisible d'un côté, la question ne se pose pas. Elle se pose
pour la facture CASA-ELECT, qui n'imprime que le matricule du fournisseur — et
c'est le cas le plus courant.

**3 · Comment avez-vous payé ?** Quatre choix, et un cinquième qui compte :

|                     | justificatif                          |
| ------------------- | ------------------------------------- |
| Espèces             | aucun                                 |
| Chèque              | photo du talon                        |
| Traite              | photo de la traite                    |
| Carte bancaire      | photo du ticket du terminal           |
| **Pas encore payé** | aucun — et la pièce reste « à payer » |

J'ajoute « pas encore payé » parce que sans lui, une facture à trente jours
n'aurait aucune réponse possible, et la personne choisirait n'importe quoi pour
avancer. C'est la question la plus utile du lot : elle donne les échéances
fournisseurs sans aucune saisie.

**4 · Où je la range.** Deux boutons de même poids — « Envoyer à [cabinet] » et
« Garder dans mon coffre » — et dans les deux cas le classement est automatique :
famille de charge et mois de la pièce. Vous ne choisissez pas un dossier, vous
choisissez qui la voit.

**5 · Le reçu.** Produit sans rien demander, et consultable tout de suite.

---

## Trois risques que je ne veux pas découvrir après

**Le reçu ne doit pas être comptabilisable.** Un PDF qui arrive chez le
comptable et qui ressemble à une pièce justificative sera tôt ou tard
comptabilisé — et la dépense serait comptée deux fois. Le mécanisme existe déjà :
`ref.document_types.porte_ecriture`. Le reçu sera donc un type à
`porte_ecriture = false`, rattaché à la pièce d'origine, jamais une pièce
autonome. C'est le point sur lequel je ne céderai pas sans que vous le disiez
explicitement.

**Le moyen de paiement est une valeur liante.** Espèces, chèque, carte : chacun
désigne un compte de trésorerie différent (caisse, banque…). C'est du
paramétrage réglementaire, donc il vit dans le pack, daté et surchargeable — pas
dans le code (R4). Un moyen de paiement écrit en dur donnerait une écriture
fausse dans la première juridiction suivante.

**La retenue à la source croise ce flux.** Sur des honoraires ou un loyer, ce
qui est payé n'est pas ce qui est facturé : il y a une retenue. L'écran du
paiement doit donc accepter que le montant payé diffère du TTC, et le dire — sinon
il fera croire à un écart de lecture là où il y a une retenue légale.

---

## Ce que cela demande, dans l'ordre

1. **Le type de document « reçu de dépense »** et son lien à la pièce : une
   migration datée, `porte_ecriture = false`.
2. **Les moyens de paiement au pack**, avec leur compte de trésorerie, datés.
3. **L'écran unique** (étapes 2 à 4), et la photo du justificatif — qui réemploie
   la caméra et l'archive couleur existantes, sans rien de neuf.
4. **Le reçu en PDF** : il ne porte que des valeurs déjà calculées par le Socle
   et citées (R3 — la couche agentique n'émet aucun chiffre liant). Il cite la
   facture, le justificatif de paiement, le moyen, la date, et le verdict.
5. **Les documents téléchargés** entrent dans le même tuyau : même lecture, même
   questions, même reçu. C'est un raccordement, pas une seconde chaîne — deux
   chaînes divergeraient en six semaines.

---

## Ce que je ne ferai pas sans votre réponse

**« Ticket du monument »** — je lis « justificatif de paiement » : talon de
chèque, ticket de terminal de carte, avis de virement. Dites-moi si vous
entendiez autre chose.

**Le reçu de dépense, à quoi sert-il exactement ?** Deux lectures possibles, et
elles ne donnent pas le même document. Soit c'est une **pièce de caisse** — la
preuve interne que la dépense a été payée, pour le comptable. Soit c'est un
**récapitulatif** pour vous, qui rassemble facture + paiement en un seul fichier
à classer. Je penche pour la première, parce que c'est elle qui manque au
comptable. Dites-moi.

**Le classement automatique** range par famille de charge et par mois. Les
familles livrées sont neuf, et il en manque deux évidentes : **l'énergie et
l'eau**. La STEG et la SONEDE n'ont aujourd'hui aucune famille qui leur
convienne. En ajouter touche aussi le plan comptable — c'est une décision de
référentiel, et elle vous revient.

---

## Et l'UI/UX

Vous demandez quelque chose d'intuitif et de clair. Ce que je propose tient en
trois règles, et elles sont vérifiables :

- **Une question par écran, jamais deux.** Celui qui tient son téléphone d'une
  main répond à une chose à la fois.
- **Aucune question dont le produit connaît déjà la réponse.** Le sens ne se
  demande que lorsqu'il ne se déduit pas. Chaque question évitée est gagnée.
- **Aucun état qu'on n'a pas choisi.** C'est ce qui a coûté deux défauts en
  trois jours : la transmission d'office le 4 octobre, puis la facture rejetée
  déjà partie le 7. Un écran ne doit jamais laisser une pièce dans un état que
  personne n'a décidé.

Je ne commence pas avant votre feu vert, et je commencerai par le point 1 — le
reçu non comptabilisable — parce que c'est celui qui, mal fait, mettrait une
dépense deux fois dans vos comptes.
