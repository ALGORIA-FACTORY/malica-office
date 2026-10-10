# Ce que les écrans disent et que la donnée ne dit pas — relevé et plan

10 octobre 2026. Quatre captures prises sur le téléphone du commanditaire, et
une demande : « il y a beaucoup de manquements, surtout dans l'UI/UX ».

Ce document ne corrige rien. Il établit, pour chaque défaut, **la ligne de code
fautive** et **ce que la capture montre**, puis propose un ordre de correction.
Aucune affirmation ici n'est une impression : chacune a été vérifiée dans le
dépôt avant d'être écrite.

---

## Ce que les quatre captures montrent, mises côte à côte

| Écran             | Ce qu'il affiche                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Accueil           | « Almost. A few invoices are still missing to close October. »                                  |
| Accueil           | _VAT recovered · October_ : **—** TND                                                           |
| Accueil           | _VAT to remit_ · **0 % ready**, et une barre à moitié pleine                                    |
| Accueil           | _Your documents_ · **1** · « Read and filed »                                                   |
| Vos documents     | « **0** documents read and filed in October. »                                                  |
| TVA mois par mois | Nov, Dec, Jan … Oct — douze lignes vides, aucune année                                          |
| Pièce lue         | « One second, and it's filed. » — rien n'est classé                                             |
| Pièce lue         | « Droit de timbre · Code des droits de timbre, tarif » en français, dans une interface anglaise |
| Pièce lue         | Le bouton de confirmation est **gris**, sans raison visible                                     |

**Un fil unique traverse presque tout** : l'écran affirme un état que la donnée
ne porte pas. Ce n'est pas une question d'esthétique — c'est la promesse du
produit, imprimée sur la capture n° 2 : _« Every amount comes from a document
you confirmed. I compute nothing I cannot cite. »_

---

## Défaut 1 — « Presque » est dit à 0 %

`apps/web/src/routes/_authenticated/pme.index.tsx:125`

```ts
const restantes = a.avancement === null ? 0 : Math.round((1 - a.avancement) * 100) === 0 ? 0 : 1;
```

`restantes` ne compte rien : c'est un booléen déguisé en nombre. Il vaut 1 dès
que l'avancement n'est pas exactement 100 %, **y compris à 0 %**. La phrase
choisie est alors `pme.home.voix.manque` :

> « Presque. Il me manque encore quelques factures pour boucler {mois}. »

Sur la capture, la carte d'à côté dit « 0 % ready ». Le produit annonce donc
« presque fini » et « 0 % prêt » à quatre centimètres d'écart.

**Et « quelques factures » n'est connu de personne.** Le produit ne sait pas
combien de factures manquent — il ne peut pas le savoir, puisqu'il ne voit que
ce qu'on lui a donné. La phrase invente une quantité.

---

## Défaut 2 — Deux écrans, deux définitions du mois, et ils se contredisent

`apps/web/src/hooks/use-accueil.ts:237`

```ts
const duMois = liste.filter((p) => p.createdAt.slice(0, 7) === periode);
```

L'accueil compte les pièces par **la date de la photo**. L'écran _Vos documents_
compte par **la date de la facture**. D'où, sur les captures :

- accueil : _Your documents_ · **1**
- documents : « **0** documents read and filed in October »

Les deux ont raison dans leur définition, et aucun ne dit laquelle il emploie.
C'est le **défaut 6 du diagnostic du 5 octobre** — « trois définitions de
charges » — qui reparaît ailleurs, parce qu'on avait corrigé les occurrences et
non la cause : rien dans le dépôt ne désigne une définition unique de « ce mois ».

---

## Défaut 3 — « Lus et classés » posé sur un compte qui n'est ni lu ni classé

`packages/socle/src/messages.ts:465` — `"pme.home.documents.sous": "Lus et classés"`

Ce libellé fixe surmonte `a.documents`, c'est-à-dire `duMois.length` : **toutes
les pièces du mois, tous statuts confondus**, y compris une pièce jamais lue.

Sur la capture, la pièce comptée est précisément celle qui attend encore la
confirmation du dirigeant. Elle n'est ni lue au sens comptable, ni classée.

Ce défaut est **consigné depuis le 4 octobre** (diagnostic, défaut 8) et n'a pas
été corrigé. Je l'avais écrit, pas réparé.

---

## Défaut 4 — « Une seconde, et c'est classé », avant que rien ne soit classé

`packages/socle/src/messages.ts:255` et `:2476`

```
"pme.verifie.titre.1": "Une seconde,"   /  "One second,"
"pme.verifie.titre.2": "et c'est classé." / "and it's filed."
```

Affiché **en titre** de l'écran de vérification — donc avant la question « Is
that the right amount? » et avant tout classement. Le même défaut 8, l'autre
moitié, la même date, le même sort.

---

## Défaut 5 — Des graphiques qui ne représentent aucune donnée

`pme.index.tsx:315-318` — la carte _TVA à reverser_ :

```jsx
<i className="h-[6px] w-[72%] bg-foreground" />
<i className="h-[6px] w-[44%] bg-marigold" />
```

`pme.index.tsx:345-350` — la carte _Vos charges_ :

```jsx
<i className="h-full w-[5px] …" /> <i className="h-[64%] …" />
<i className="h-[44%] …" />        <i className="h-[30%] …" />
```

**72 %, 44 %, 64 %, 30 % sont des constantes d'écriture.** Ces barres ne
bougent jamais, quelle que soit la donnée. Sur la capture, la première est à
moitié pleine au-dessus de « 0 % ready », et la seconde dessine une courbe de
charges décroissante pour un dossier qui porte une pièce.

C'est le défaut le plus grave de la liste, et pas pour sa difficulté : un
chiffre faux se corrige, un graphique décoratif **apprend au dirigeant que les
graphiques de ce produit ne veulent rien dire**. Il contredit mot pour mot la
phrase que le produit imprime lui-même deux écrans plus loin.

---

## Défaut 6 — Deux langues dans le même écran

`db/migrations/20260826133602…:21-22`

```sql
('DROIT_TIMBRE', 'Droit de timbre', 'facture_vente', '4368', 1.000, 'Code des droits de timbre, tarif'),
('DROIT_TIMBRE', 'Droit de timbre', 'facture_achat', '665',  1.000, 'Code des droits de timbre, tarif')
```

`ref.fiscal_charges.label` et `legal_reference` sont **une seule chaîne
française**, sans jointure à `ref.labels` — alors que `ref.labels` porte bien
`mention / TIMBRE_FISCAL` en fr, en et ar (même migration, l. 142). Le
traducteur existe ; cette table ne l'appelle pas. C'est le motif récurrent du
diagnostic : _un outil juste qu'on n'importe pas._

Même famille, côté serveur : **12 phrases françaises écrites en dur** dans
`apps/api/src/scan/controles.ts`, dont celles qui expliquent un blocage —

> « La nature de la pièce n'a pas été déterminée (achat ou vente) : à confirmer. »

Ce sont exactement les phrases dont le dirigeant a le plus besoin, et ce sont
celles qui ne se traduisent pas.

---

## Défaut 7 — Un bouton mort, et sa raison hors de l'écran

`pme.piece.$pieceId.tsx:1003` puis `:1052`

```tsx
disabled={confirm.isPending || !confirmable}
…
) : !confirmable ? (
  <p className="pt-2 text-center text-[12.5px] text-signal-warn">
    {blockReason ?? t("pme.confirm.review")}
```

La raison **est** rendue — mais en 12,5 px, centrée, **sous** le bouton, donc
hors de l'écran sur la capture. Ce que le dirigeant voit : le plus gros élément
de la page, gris, qui ne répond pas.

La hiérarchie est inversée. Quand une action est impossible, **la raison est
l'information principale** et le bouton n'est qu'un rappel de ce qu'on pourra
faire ensuite.

---

## Défaut 8 — Douze lignes vides valent moins qu'une phrase

`pme.tva.tsx:198-237`

Le code est **honnête** : un mois sans écriture n'a pas de barre, et affiche
« — » plutôt que « 0,000 ». C'est juste, et c'est écrit noir sur blanc dans le
fichier.

Mais l'écran rend douze lignes vides, et les mois n'ont **pas d'année** : la
liste commence à « Nov » et finit à « Oct », ce qui se lit comme une erreur
tant qu'on n'a pas deviné qu'il s'agit de douze mois glissants.

Ce n'est pas un défaut de justesse. C'est un défaut d'état vide : la page ne
dit pas ce qu'elle attend.

---

## Défaut 9 — Trois sélecteurs de mois, trois fenêtres, aucune n'est l'année

Relevé en vérifiant la demande du commanditaire du 10 octobre. Trois écrans
proposent de choisir un mois, et chacun porte sa propre constante :

| Écran             | Fichier              | Fenêtre                       |
| ----------------- | -------------------- | ----------------------------- |
| TVA mois par mois | `use-accueil.ts:37`  | `FENETRE = 12` mois glissants |
| Vos charges       | `pme.charges.tsx:36` | `HISTORY_MONTHS = 6`          |
| Vos documents     | `pme.list.tsx:36`    | `MOIS_VISIBLES = 4`           |

Douze, six, quatre. Trois nombres écrits à trois endroits, qui ne se
connaissent pas, et dont aucun n'a de raison d'être ce qu'il est. Le dirigeant
qui cherche mars le trouve sur un écran et pas sur les deux autres.

**Décision du commanditaire, 10 octobre : tous les mois de l'année paraissent,
à partir de janvier.** C'est la bonne réponse, et pas seulement pour la
cohérence : l'exercice comptable tunisien va de janvier à décembre, un dossier
se boucle par année, et une fenêtre glissante ne correspond à aucun objet du
métier. « Nov, Déc, Jan… » ne décrit rien que le comptable connaisse.

### Ce que cela demande, et le piège

1. **Une seule règle, à un seul endroit** : les douze mois de l'exercice
   affiché, de janvier à décembre, pour les trois écrans. Les trois constantes
   disparaissent.
2. **Un choix d'année**, puisque la fenêtre ne suit plus le mois courant. Deux
   écrans portent déjà une bascule _Mois · Année_ — elle devient le sélecteur
   d'exercice.
3. **Les mois à venir existent, et se voient comme tels.** En octobre, novembre
   et décembre sont des lignes de l'exercice ; les montrer vides ferait croire à
   une donnée manquante. Elles doivent se lire « pas encore », et non « — ».
4. **Le piège, et c'est le seul risque de ce changement :** la fenêtre
   d'AFFICHAGE n'est pas la fenêtre de CALCUL. L'accueil compare le mois courant
   au précédent (`use-accueil.ts:209`) et compte les mois de progression
   consécutifs (`:190`). Si la série est coupée à janvier, **janvier perd son
   comparatif** — son mois précédent est décembre de l'exercice d'avant — et la
   progression repartirait de zéro chaque 1ᵉʳ janvier, silencieusement.

   Le calcul garde donc sa fenêtre glissante ; seul l'affichage devient l'année.
   Les confondre produirait exactement la forme d'erreur que R4 nomme la pire :
   plausible, invisible, et fausse une fois par an.

---

## Ce qui n'est pas un défaut, et qu'il faut trancher

**L'interface est en anglais.** Le sélecteur du bandeau dit « EN ». Ce n'est pas
une panne : c'est la langue de l'appareil. Mais un produit destiné aux PME
tunisiennes qui s'ouvre en anglais par défaut est une décision, pas un réglage,
et elle vous revient. Les deux chaînes françaises des défauts 6 ne sont, elles,
pas discutables : elles sont fausses dans toutes les langues sauf une.

---

## Le plan, en trois vagues

L'ordre n'est pas celui de la difficulté. Il est celui de la confiance : tant
qu'un écran affirme ce qui est faux, corriger le reste ne se voit pas.

### Vague A — Ne plus rien affirmer qui ne soit vrai

Cinq corrections, toutes petites, toutes dans les écrans. Aucune migration.

1. **Supprimer les barres décoratives** (défaut 5). Soit elles portent la
   donnée, soit elles disparaissent. Je propose qu'elles disparaissent d'abord,
   et reviennent branchées : une barre vide se voit, une barre fausse non.
2. **« Lus et classés » devient un compte par état** (défaut 3) : _n lus · n en
   attente_, et le mot « classé » n'apparaît que pour ce qui l'est.
3. **Le titre de l'écran de pièce cesse de promettre** (défaut 4) : il annonce
   ce qui reste à faire, pas ce qui serait déjà fait.
4. **La phrase d'accueil repose sur un compte réel** (défaut 1), ou se tait.
   À 0 %, elle ne dit pas « presque ».
5. **Une épreuve par libellé**, qui pose la donnée et vérifie la phrase rendue.
   C'est ce qui manquait : aucun test ne vérifie aujourd'hui qu'un libellé dit
   la vérité sur le chiffre qu'il surmonte.

### Vague B — Une seule définition du mois

6. **Nommer la règle une fois** (défaut 2) : une pièce appartient au mois de sa
   **date de document**, et une pièce sans date lue appartient à « en attente de
   date » — qui existe déjà en base depuis le 5 octobre et qu'aucun écran ne
   montre. L'accueil, _Vos documents_ et _Vos charges_ lisent la même source.
7. **Une épreuve de cohérence entre écrans** : deux écrans qui parlent du même
   mois donnent des chiffres conciliables. Elle manque depuis le 5 octobre et
   elle est nommée dans le diagnostic comme manquante.

### Vague C — Rendre lisible ce qui bloque et ce qui est vide

8. **Inverser la hiérarchie du blocage** (défaut 7) : la raison au-dessus du
   bouton, à la taille du texte courant, avec le geste qui débloque.
9. **Traduire les motifs** (défaut 6) : `ref.fiscal_charges` rejoint
   `ref.labels` par migration datée, et les phrases de `controles.ts` passent en
   motifs structurés — travail déjà nommé comme reste de l'étape 2.
10. **Des états vides qui disent ce qu'ils attendent** (défaut 8, et le « — »
    du bloc d'encre) : une phrase à la place d'une grille vide, et l'année sur
    les mois.
11. **L'exercice remplace les trois fenêtres glissantes** (défaut 9) : janvier
    à décembre partout, une seule règle, un choix d'année, les mois à venir
    marqués comme tels — et la fenêtre de calcul laissée glissante, pour que
    janvier ne perde pas son comparatif.

---

## Ce que ce relevé ne couvre pas, et qui reste ouvert

- **Le mois des pièces.** La pièce CASA-ELECT du 6 octobre s'affichait en
  _juillet 26_ ; la pièce PAPETERIE NOUR porte une date lue au **03/02/2026**.
  Deux pièces, deux mois inattendus. Je n'ai pas diagnostiqué : il faut la
  donnée du staging, et la lecture SQL du staging m'a été refusée par un
  garde-fou. À traiter à part, et probablement en premier si ces dates sont
  fausses — une date fausse déplace une déclaration de TVA.
- **Le flux de paiement et le reçu**, conçu le 7 octobre, toujours en attente de
  vos deux réponses.
- **La catégorie des charges** : corrigée, vérifiée, **mais non déployée** — la
  demande de fusion n° 1 attend votre clic.

---

## Ce que je ne commence pas sans votre feu vert

Rien. Ce document est une note de conception, conformément à la consigne. Je
propose de commencer par la **vague A**, parce qu'elle est la moins risquée —
aucune migration, aucune donnée touchée — et la plus visible sur votre
téléphone.
