# Diagnostic des essais réels n° 2 et 3

Les 4 et 5 octobre 2026, deux factures réelles ont été photographiées depuis
l'application installée depuis le Play Store. Les montants affichés étaient
faux, la date absente, le timbre invisible, et la pièce rejetée pour un motif
qui n'était pas le vrai.

Ce document **ne corrige rien**. Il établit, pour chaque défaut, la
**cause racine**, l'**étape fautive**, et **pourquoi les tests ne l'ont pas vu** —
conformément à la commande de la phase 0. Chaque affirmation est appuyée sur la
charge réellement extraite en base, pas sur une reconstitution.

---

## La pièce à conviction

Dernière extraction de `capture.extractions` sur le staging, en regard de ce que
la facture imprime :

| Champ                                | Imprimé                        | Lu                    |                        |
| ------------------------------------ | ------------------------------ | --------------------- | ---------------------- |
| `articles[0].total_ht`               | 2 800,000                      | `2.000`               | **faux**               |
| `articles[1].total_ht`               | 220,000                        | `220.000`             | juste                  |
| `totals.base_ht`                     | 3 020,000                      | `3.000`               | **faux**               |
| `totals.vat`                         | 573,800                        | `573.800`             | juste                  |
| `totals.ttc`                         | 3 594,800                      | `3.000`               | **faux**               |
| `other_charges` DROIT_TIMBRE         | 1,000                          | `1.000`               | juste — **et bien lu** |
| `document_date`                      | « Tunis, le 1 septembre 2026 » | `null`                | **absent**             |
| `references.matricule_fiscal_client` | 1876543W/A/M/000               | `1876543W/A/M/000`    | juste                  |
| `issuer`                             | Mme Leila BEN SALEM            | `Mme Leila BEN SALEM` | juste                  |

La loi est sans exception : **tout montant imprimé sans espace de milliers est
lu juste ; tout montant qui en porte une est tronqué à l'espace.** « 2 800,000 »
devient « 2 ». « 3 020,000 » devient « 3 ».

Et les contrôles, eux, ont crié :

```
coherence_arithmetique  anomalie  « aucune lecture ne vérifie Σ HT × (1+taux) + autres = TTC »
mentions_obligatoires   réserve   Date, Base HT, Montant TVA, Total TTC
destinataire            REJET     lu 1876543W/A/M/000 ≠ fiche 1856324/A/M/000
coherence_dates         —         « la date n'a pas été lue »
```

Un seul de ces quatre motifs a été montré à l'écran.

---

## Défaut 1 — Les montants à quatre chiffres et plus sont tronqués

**Cause racine.** Une consigne de l'invite de désignation, écrite en toutes
lettres, interdit au modèle de citer plus d'un jeton pour un montant :

> `apps/api/src/malica/lecture/vision.ts:314`
> « Un MONTANT ou une DATE ne porte jamais "ordinal_end" : un seul token. »
>
> `vision.ts:323` — « La quantité et les prix unitaires sont des MONTANTS : un
> seul token chacun, jamais "ordinal_end". »

Or le plan de jetons découpe sur l'espace (`pdf-text.ts:62`, `qwen.ts:154`,
`/\S+/g`) : « 2 800,000 » **est** deux jetons. Le modèle, sommé de n'en choisir
qu'un, choisit le premier. La troncature n'est pas une hallucination du modèle :
c'est l'obéissance à une consigne fausse.

**Étape fautive : la désignation.** Et elle seule. Tout le reste de la chaîne est
correct et prêt :

- `token-plan.ts:117` `texteDeLaPlage` recolle déjà une plage de jetons, et son
  commentaire nomme exactement ce cas — « un montant coupé par l'espace des
  milliers » ;
- `normaliser-montants.ts:185` lit correctement « 2 800,000 » = 2 800 000
  millimes, espace insécable comprise ;
- le schéma `RefSchema` (`vision.ts:50`) **accepte** `ordinal_end` sur tous les
  champs sans distinction. La restriction n'est que dans le texte de l'invite.

La capacité existe. On a interdit de s'en servir.

**Deux maillons aggravants**, à corriger dans le même geste, sans quoi la
correction de l'invite ne tiendra pas :

1. `token-plan.ts:85` `citer()` ne recopie pas `ordinalEnd` dans la citation :
   une plage désignée produit une citation sur un seul jeton ;
2. `capture.citations` porte un `token_id` unique, sans borne de fin
   (`20260824130649`, l. 226). La plage n'est pas stockable.

Conséquence : le rattrapage que `analyse.ts:13-19` **annonce** — « ils se
réunissent ici, par leurs citations » — ne peut pas fonctionner. Le `join(" ")`
de `analyse.ts:148` ne joint jamais rien, puisqu'il n'y a qu'une citation par
champ. C'est une promesse écrite en commentaire qu'aucun code ne tient.

**Pourquoi les tests ne l'ont pas vu.** Le test existe, il décrit le défaut mot
pour mot, et **il le verrouille comme comportement voulu** —
`lecture-incomplete.test.ts:179` :

```ts
it("ne recolle rien de sa propre initiative", () => {
  const r = lireMontantDuPlan(jetons, "totals.ttc", { page: 1, ordinal: 1 }, DINAR);
  assert.equal(r.value, "1.000"); // ← exactement le « 2.000 » observé
});
```

Le test est juste : recoller sans désignation violerait R2. Il n'a simplement
jamais été accompagné d'une épreuve vérifiant que **la désignation, elle, donne
la plage**. Aucun test ne lit une facture tunisienne portant un montant à quatre
chiffres par la chaîne réelle. Le banc `factures.banc.test.ts` vérifie qu'aucun
chiffre n'est inventé — il ne vérifie pas qu'aucun chiffre n'est amputé.

C'est la leçon centrale de ce diagnostic : **un montant tronqué n'est pas un
montant ambigu.** « 2 » est un nombre parfaitement lisible, à lecture unique. Il
franchit donc tous les gardes conçus pour l'ambiguïté :

- `lireMontantDuPlan` (`token-plan.ts:227`) rend la valeur sans drapeau dès
  qu'il n'y a qu'une hypothèse ;
- `montants.ts:286` `resoudreFacture` **sort avant toute vérification de
  contrainte** quand chaque champ n'a qu'une hypothèse. Les contraintes
  `ttc = base_ht + vat` et `base_ht = Σ lignes` sont posées, puis jamais
  évaluées ;
- même quand des doutes existent, `montants.ts:304` ne fait que **compter** les
  contraintes satisfaites : une contrainte violée baisse un score, elle ne lève
  aucun drapeau.

Le garde-fou de R2 protège contre l'invention. Il ne protège pas contre
l'amputation.

---

## Défaut 2 — La date en lettres n'est pas lue

**Cause racine, double.** Les deux verrous sont indépendants, et il faut lever
les deux :

1. **La désignation est interdite.** « 1 septembre 2026 » est trois jetons, et
   `vision.ts:314` interdit `ordinal_end` sur une DATE. Même interdiction
   dupliquée dans `lire-carte.ts:85`.
2. **La relecture ne saurait pas la lire.** `normalizeDate`
   (`token-plan.ts:63-82`) ne connaît que deux formes : `AAAA-MM-JJ` et
   `JJ/MM/AAAA`. **Aucun nom de mois n'existe nulle part dans le code de
   lecture** — vérifié par recherche sur les douze mois, en français et en
   arabe : zéro occurrence hors commentaires.

**Étape fautive : désignation ET normalisation.** C'est le seul défaut du lot qui
touche deux étapes.

**Pourquoi les tests ne l'ont pas vu.** `normalizeDate` est bien testée, et avec
soin — y compris le piège « 45/13/2026 » et le refus de basculer en mois/jour.
Tous ses cas sont **numériques**. Le format « Tunis, le 1 septembre 2026 », qui
est celui de la majorité des factures tunisiennes manuscrites ou bureautiques,
n'apparaît dans aucune épreuve. L'oubli n'est pas dans la rigueur du test, il est
dans le choix du corpus d'exemples — qui ne venait pas de vraies factures.

C'est précisément ce que le jeu de 50 factures réelles de la phase 1 doit
rendre impossible.

---

## Défaut 3 — Le timbre fiscal n'apparaît pas à l'écran

**Il a été lu.** La charge est en base : `other_charges: [{code: "DROIT_TIMBRE",
amount: "1.000"}]`, valeur exacte. La désignation a fonctionné, la relecture a
fonctionné, le référentiel porte bien `DROIT_TIMBRE` avec son montant fixe
(`ref.fiscal_charges`, migration `20260826133602`).

**Étape fautive : l'écran, et de la façon la plus nette possible.** Dans
`pme.piece.$pieceId.tsx`, la chaîne `other_charges` apparaît **exactement une
fois** — à la ligne 76, dans la déclaration de type :

```ts
other_charges?: Array<{ code: string; label: string; amount: string }>;
```

Elle n'est jamais lue, jamais parcourue, jamais rendue. Le timbre est désigné,
relu, stocké, **typé**, et l'écran ne le montre pas. Le traducteur de champs
connaît même son libellé (`champ-lisible.ts:47`, `other_charges →
"cab.champ.droit"`), et ce libellé n'est utilisé que par l'écran du cabinet.

Ce défaut est donc à reclasser en défaut d'affichage pur, et sa correction est
sans risque pour la chaîne de lecture.

**Pourquoi les tests ne l'ont pas vu.** Aucune épreuve ne part d'une extraction
portant une `other_charges` et ne vérifie qu'elle apparaît sur l'écran de pièce.
La couverture s'arrête au contrat (`extract.v1`) et à la base ; elle ne franchit
pas la frontière de l'écran. C'est la même frontière que le plantage du
4 octobre avait déjà révélée — et le même oubli : un champ typé mais jamais
affiché ne casse aucune compilation.

---

## Défaut 4 — « À rejeter : matricule différent », alors que la fiche est fausse

**Le contrôle a eu raison.** Il a lu `1876543W/A/M/000` sur la pièce — ce qui est
**exact**, la facture est bien adressée à ce matricule — et l'a comparé à la
fiche de l'organisation sur le staging, qui porte `ALGORIA FACTORY SARL /
1856324/A/M/000`. L'écart est réel.

**Cause racine : une donnée de référence fausse sur le staging**, pas une erreur
de lecture. La fiche dit SARL et un matricule ; la facture dit SUARL et un autre.
Le contrôle `destinataire` (`controles.ts:224`) a fait exactement son travail.

**Étape fautive : les données du tenant d'essai.** Aucune ligne de code n'est en
cause.

**Pourquoi les tests ne l'ont pas vu.** Un test ne peut pas voir ceci : il
compare une fiche qu'il a lui-même semée à une pièce qu'il a lui-même fabriquée,
donc les deux concordent toujours. C'est la seule classe de défaut de ce
diagnostic qu'aucune épreuve automatique ne peut attraper — elle relève de la
justesse d'une donnée saisie, pas d'une garantie de code.

Ce qui **peut** être testé, et qui manque, est le format : rien ne valide
aujourd'hui qu'un matricule fiscal saisi dans une fiche respecte la forme
tunisienne `0000000X/A/M/000`. La fiche du staging porte `1856324/A/M/000` — sept
chiffres **sans la lettre de clé**. Ce n'est pas un matricule valide, et la
saisie l'a accepté. C'est cela qui est à corriger en phase 1, avec la fiche.

---

## Défaut 5 — Un seul motif de rejet est montré, et ce n'est pas le plus utile

Les quatre contrôles ont rendu leur verdict. L'écran en a montré un :
« matricule différent ». Le classement par gravité (`controles.ts:359`) est
correct — `rejet` l'emporte sur `anomalie` — mais il produit ici le pire des
résultats possibles : il cache l'anomalie arithmétique, qui est le défaut
**réparable** et le seul qui renseigne sur la qualité de la lecture.

**Cause racine : le motif affiché est le plus grave, jamais le plus actionnable.**

**Étape fautive : les écrans**, et le choix de ne rendre qu'un motif.

**Aggravant, qui explique la réserve absurde.** Le contrôle `mentions_obligatoires`
(`controles.ts:163`) déclare absentes la Base HT, le Montant TVA et le Total TTC
— alors que la facture les imprime très lisiblement. La raison est en amont :
quand `normalisation.etat` vaut `incoherent`, `vide()`
(`normaliser-montants.ts:229`) met tous les montants à `null`, et le contrôle des
mentions, qui lit la **sortie** de la normalisation et non la pièce, conclut
qu'elles manquent. Un montant incohérent est déclaré absent. Le message rendu à
l'utilisateur est donc faux sur les faits.

**Pourquoi les tests ne l'ont pas vu.** Les sept contrôles sont testés un par un,
sur des entrées fabriquées pour les exercer isolément. Aucune épreuve ne pose
une pièce déclenchant **quatre** contrôles à la fois et ne vérifie ce que la
personne lit. Le défaut n'est dans aucun contrôle : il est dans leur
composition, et la composition n'est testée nulle part.

---

## Défaut 6 — « Vos charges » dit 222 000, « Votre TVA » dit zéro

**Les deux écrans ont raison, et c'est le problème.** Ils ne lisent pas la même
chose, et aucun des deux ne le dit :

|                 | Source                                                  | Fenêtre de période |
| --------------- | ------------------------------------------------------- | ------------------ |
| « Vos charges » | `piece_articles_v` — les **lectures** (`charges.ts:45`) | colonne `period`   |
| « Votre TVA »   | `ecritures_v` où `status = 'booked'` (`office.ts:181`)  | `date_ecriture`    |

Deux pièces lues et non confirmées donnent donc 222 000 d'un côté et zéro de
l'autre. Il existe même **trois** définitions de « charges » dans le produit : la
tuile d'accueil en ajoute une troisième, via `socle_periode_lignes` (comptabilisé).

**Cause racine, et c'est un défaut d'architecture, pas d'écran** : le produit n'a
pas de notion explicite et affichée de « lu mais pas encore comptabilisé ». Chaque
écran choisit sa définition dans son coin, et aucun n'énonce laquelle.

**Aggravant, à verser au dossier R4.** La projection des articles écrit la
période ainsi (migration `…55a3973b…`, `capture_articles_persist`) :

```sql
v_period text := to_char(coalesce(p_document_date, current_date), 'YYYY-MM');
```

Quand la date du document n'a pas été lue — exactement notre cas, défaut 2 — la
pièce est rangée **au mois du scan**, silencieusement. C'est un repli implicite :
invisible, non surchargeable, et il produit un résultat plausible et faux. C'est
la forme d'erreur que R4 nomme comme la pire. À traiter comme tel en phase 1,
avec la séparation des dates de la phase 3.

**Pourquoi les tests ne l'ont pas vu.** Chaque écran est testé contre sa propre
source, et passe. Aucune épreuve ne pose la question qui compte : _deux écrans
qui parlent du même mois donnent-ils des chiffres conciliables ?_ La cohérence
entre écrans n'est la responsabilité d'aucun test existant.

---

## Défaut 7 — « ISSUER » en capitales anglaises

**Cause racine, en trois lignes.** `pme.piece.$pieceId.tsx:624` :

```tsx
<span className="num ms-auto text-[11px] uppercase tracking-wide …">{zoom.field}</span>
```

`zoom.field` est le **chemin machine** dans l'extraction (`issuer`,
`document_date`, `totals.vat`), et la classe `uppercase` le rend `ISSUER`.

Le dictionnaire est irréprochable : `pme.extract.issuer` existe et vaut
« Émetteur », « Issuer », « المُصدِر ». Le mot anglais ne vient pas de la
traduction — il vient de l'absence de traduction.

Et le traducteur **existe déjà** : `libelleDuChamp` (`champ-lisible.ts:54`), avec
sa table de chemins, est testé, et il est utilisé par l'écran du cabinet
(`cabinet.piece.$pieceId.tsx:435`). L'écran PME ne l'importe pas.

**Étape fautive : les écrans.** Un outil disponible, testé, et non appelé — le
même schéma exact que `texteDeLaPlage` au défaut 1.

**Pourquoi les tests ne l'ont pas vu.** Les deux seules épreuves d'i18n couvrent
les sept statuts de la base et la sélection de pluriel. La parité des clés est
tenue par le compilateur, pas par un test. Et **rien n'interdit d'afficher un
identifiant machine** : ni test, ni règle ESLint (`no-restricted-syntax` absent
de `eslint.config.js`). Un chemin brut rendu à l'écran ne déclenche rien.

À noter pour la même famille : toutes les phrases composées côté serveur
(`proposition.ts:108`, `controles.ts`) sont du **français en dur**, non
traduisible, et s'affichent telles quelles en anglais et en arabe.

---

## Défaut 8 — « Une seconde, et c'est classé », alors que rien n'est classé

Deux libellés affirment un état qui n'existe pas :

- `messages.ts:255` — `pme.verifie.titre` = « Une seconde, / et c'est classé. »,
  affiché **avant** toute écriture ;
- `messages.ts:443` — « Lus et classés », posé sur `duMois.length`, qui compte
  **toutes** les pièces du mois, statuts confondus — y compris `capturee`
  (jamais lue). Le filtre par statut existe juste à côté, dans la même fonction,
  pour la variable `closes` ; il n'est pas appliqué au nombre affiché.

**Cause racine : un texte de façade.** Le libellé décrit l'intention du produit,
pas l'état de la donnée.

**Étape fautive : les écrans.** Aucun moteur n'est en cause.

**Pourquoi les tests ne l'ont pas vu.** Un test vérifie qu'une clé est traduite
dans les trois langues. Aucun ne vérifie qu'un libellé **dit la vérité** sur la
donnée qu'il surmonte. C'est hors de portée d'une épreuve automatique au sens
strict, et c'est précisément ce que la règle « pas de texte de façade » impose de
tenir à la relecture.

---

## Défaut 9 — « Votre cabinet va trancher », et le cabinet n'a rien reçu

Ce défaut est déjà consigné en D40 ; le diagnostic le confirme et le précise.

**Cause racine : aucun écran ne lit `capture.analyses`.** Vérifié : `dossier()`
(`capture.ts:179`) rend `piece / extraction / precisions / citations / tokens` —
pas d'analyse. Aucune méthode `analyse*` n'existe dans `ports/repositories.ts`
ni `ports/malica.ts`. Les sept verdicts sont produits, écrits en base
append-only, et jamais relus par une interface.

Le motif n'atteint l'écran que par un seul chemin, et il est triplement dégradé :

1. `proposition.ts:108` aplatit les motifs structurés dans une chaîne de prose
   française : `raison: "Aucune écriture ne se propose : la pièce est « ${verdict} ». …"` ;
2. l'affichage est en branche `else` de `sensIndetermine`
   (`pme.piece.$pieceId.tsx:932`) — or quand le matricule ne correspond ni à
   l'émetteur ni au destinataire, le sens est typiquement indéterminé, donc
   l'écran pose « achat ou vente ? » **et le motif du rejet n'est jamais rendu** ;
3. rendu, c'est une ligne de 12,5 px centrée sous les boutons (l. 963) : aucun
   titre, aucune citation de la zone source.

Le cabinet, lui, dispose d'un référentiel de motifs gouverné et traduit
(`supervision.ts:266`, `ns = 'rejet_motif'` joint sur `ref.labels`). La PME ne
l'utilise pas.

**Étape fautive : les écrans et les ports.** Il manque un port de lecture des
analyses, et le motif doit voyager structuré, pas en prose.

---

## Défaut 10 — Malica refuse de compter les pièces

**Elle a le chiffre.** `loadMalicaContext` transmet
`pieces: Record<string, number>` (`context.ts:41`), alimenté par un agrégat par
statut (`context.ts:114`). Pour deux pièces lues, le JSON envoyé au modèle
contient littéralement `"pieces":{"lue":2}`.

**Elle a l'interdiction de l'utiliser.** `ask.ts:128`, règle 1 de la consigne
système :

> « Tu ne calcules jamais : aucune addition, aucune conversion, aucun arrondi,
> aucun cumul. Les montants du dossier ont été produits par le Socle ; tu les
> restitues. »

Un comptage **est** un cumul. Et la consigne ne mentionne nulle part la clé
`pieces`, ni le vocabulaire des statuts. Le refus observé n'est pas une
défaillance : c'est l'application exacte de la règle, sur une donnée que la règle
n'avait pas prévue.

**Cause racine : la consigne qui tient R3 ne distingue pas un cumul de valeurs
liantes d'un décompte de pièces.** R3 interdit à la couche agentique d'émettre
une valeur liante — un montant, un solde, une TVA. Un nombre de pièces n'est pas
une valeur liante. La consigne les a confondus.

Les contrôles, eux, ne s'y opposeraient pas :
`controles.test.ts:67` atteste que `chiffresEngageants("il me manque 2 factures")`
rend `[]`. **L'obstacle est entièrement dans la consigne**, pas dans les gardes.

**Aggravant, et c'est ce qui décide de la phase 2.** Il n'y a **aucun mécanisme
d'appel d'outils** : `deepseek.ts:58` envoie `{ model, messages, stream }` et
rien d'autre — ni `tools`, ni `tool_choice`, ni boucle `tool_calls`, et le type
`DeepSeekMessage.role` n'admet pas `"tool"`. L'architecture est un aller-retour
unique sur un contexte figé à 500 pièces (`limit 500`).

Donc la phase 2 n'est pas un réglage de consigne : c'est l'ajout d'un tour
d'outils, exactement comme la commande le prévoit.

**Pourquoi les tests ne l'ont pas vu.** Aucune épreuve ne demande à Malica un
décompte de pièces. L'évaluation existante porte sur le droit et les montants —
là où les gardes sont serrés. Le trou est dans une catégorie de question que
personne n'avait posée, et c'est ce que l'évaluation de 30 + 20 questions de la
phase 2 doit couvrir.

---

## Ce que ce diagnostic change pour la phase 1

Cinq conclusions pèsent sur la correction, et elles n'étaient pas prévisibles
avant d'avoir la charge extraite sous les yeux :

1. **La correction des montants est une correction d'invite, pas de moteur.**
   Lever l'interdiction de `ordinal_end` sur les montants, puis propager la
   plage dans `citer()` et dans `capture.citations` — qui exige une migration
   datée. Le moteur de lecture, lui, est juste.

2. **Un nouveau garde est nécessaire, et il n'existe pas.** Aucun garde actuel ne
   voit un montant tronqué, parce qu'un montant tronqué n'est pas ambigu. Il faut
   que `resoudreFacture` **vérifie** les contraintes qu'il pose, au lieu de sortir
   dès que chaque champ a une lecture unique (`montants.ts:286`). Une contrainte
   violée doit lever un drapeau, pas baisser un score.

3. **Quatre défauts sur dix sont un outil juste qu'on n'appelle pas.** C'est le
   motif récurrent de ce diagnostic, et c'est une bonne nouvelle : `texteDeLaPlage`
   recolle les plages, `libelleDuChamp` traduit les chemins, `champ-lisible`
   connaît déjà le timbre, le référentiel des motifs est gouverné et traduit. Ces
   quatre outils existent, sont testés, et ne sont pas importés par l'écran ou
   l'invite qui en a besoin. La phase 1 est donc davantage un travail de
   raccordement que de construction.

4. **Le jeu de 50 factures réelles n'est pas un supplément de rigueur : c'est le
   seul instrument qui aurait vu ces défauts.** Les tests unitaires sont bons,
   nombreux, et passent tous. Ils ont été écrits sur des exemples fabriqués, et
   c'est ce choix — pas leur qualité — qui a laissé passer la troncature, la date
   en lettres, le timbre invisible et l'empilement de motifs.

5. **Deux garanties manquent et ne sont dans aucune liste de tâches.** Primo, une
   règle qui refuse d'afficher un identifiant machine — `eslint.config.js` n'a
   aucun `no-restricted-syntax`, et c'est ce vide qui a laissé passer `ISSUER`.
   Secundo, une épreuve de **cohérence entre écrans** : chaque écran est juste
   dans sa définition, et aucun test ne demande si deux écrans parlant du même
   mois donnent des chiffres conciliables.

---

## Les dix défauts, et l'étape fautive de chacun

|     | Défaut                        | Étape fautive                          | Nature                           |
| --- | ----------------------------- | -------------------------------------- | -------------------------------- |
| 1   | Montants ≥ 1 000 tronqués     | **désignation** (`vision.ts:314`)      | consigne fausse                  |
| 2   | Date en lettres non lue       | **désignation + normalisation**        | consigne + fonction incomplète   |
| 3   | Timbre invisible              | **écran**                              | champ typé, jamais rendu         |
| 4   | Rejet « matricule différent » | **donnée du tenant**                   | fiche de staging fausse          |
| 5   | Un seul motif montré          | **écrans** (composition des contrôles) | plus grave ≠ plus utile          |
| 6   | Charges 222 000 vs TVA 0      | **architecture**                       | trois définitions de « charges » |
| 7   | « ISSUER »                    | **écran**                              | traducteur non importé           |
| 8   | « Lus et classés » faux       | **écran**                              | texte de façade                  |
| 9   | Retour cabinet absent (D40)   | **écrans + ports**                     | aucun port ne lit les analyses   |
| 10  | Malica ne compte pas          | **consigne** (`ask.ts:128`)            | cumul ≠ valeur liante            |

Aucun de ces dix défauts n'est dans un moteur du Socle. Les moteurs de lecture,
de normalisation et de contrôle sont justes : ils ont tous les trois fait
exactement ce qu'on leur a demandé.

---

## Vérification de ce diagnostic

Chaque affirmation ci-dessus est vérifiable sans rien modifier :

1. `capture.extractions` du staging, dernière ligne → la table de la pièce à
   conviction.
2. `capture.analyses.controles` du staging, dernière ligne → les quatre verdicts.
3. `grep -n "ordinal_end" apps/api/src/malica/lecture/vision.ts` → l. 314 et 323,
   les deux interdictions.
4. `sed -n '63,82p' apps/api/src/malica/lecture/token-plan.ts` → `normalizeDate`
   sans mois en lettres ; recherche sur les douze mois → zéro occurrence.
5. `sed -n '179,184p' apps/api/src/malica/lecture/lecture-incomplete.test.ts` →
   le test qui verrouille `"1.000"`.
6. `sed -n '280,290p' apps/api/src/malica/lecture/montants.ts` → la sortie
   anticipée du solveur.
7. `grep -c "other_charges" apps/web/src/routes/_authenticated/pme.piece.$pieceId.tsx`
   → **1**, la déclaration de type, et rien d'autre.
8. `grep -rn "no-restricted-syntax" eslint.config.js` → aucun résultat.

---

## Ce que ce document n'a pas fait

Aucun code n'est modifié. Aucune migration n'est écrite. Aucun test n'est
ajouté.

La phase 0 s'arrête ici. La phase 1 attend un feu vert.
