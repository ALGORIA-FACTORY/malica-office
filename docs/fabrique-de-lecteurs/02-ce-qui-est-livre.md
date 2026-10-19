# La fabrique de lecteurs — ce qui est livré, et ce qui ne l'est pas

*19 octobre 2026. Écrit après la livraison, avec les mesures sous les yeux.*

Chaque format documentaire suffisamment éprouvé devient un **lecteur spécialisé
réutilisable**. Pour un document récurrent, Malica cesse d'appeler un modèle
distant pour la désignation — **sans rien perdre des citations ni des
contrôles**.

---

## Ce qui fonctionne réellement

### La promesse, mesurée

Sur une même facture, une recette lue **sans aucun appel de modèle** rend :

| | recette | modèle |
|---|---|---|
| jetons désignés | identiques | identiques |
| citations | **14** | **14** |
| drapeaux | identiques | identiques |
| contrat / validité | identiques | identiques |
| `extract` | **identique** | — |
| `field_confidence.overall` | `1` | `0,9` |

Le seul écart est le dernier, et il est **voulu** : une recette ne produit
**aucun** score. Le neutre est passé explicitement au point d'appel, et l'écran
n'affiche **aucun pourcentage** pour ces pièces.

### Les sept briques

| | ce qu'elle fait | où |
|---|---|---|
| **le langage** | 39 opérateurs en 12 familles **closes**, non récursif, aucune expression régulière, validateur strict rendant la liste **complète** des refus | `fabrique/recette*.ts` |
| **la signature** | ancres normalisées (casse, accents, hamza, vocalisation, tatweel), relations **dans le sens de lecture**, colonnes, pages, empreinte. Tout **relatif à la boîte de contenu** : recadrage, échelle et inclinaison rendent la même empreinte | `fabrique/signature*.ts` |
| **le socle** | neuf tables en ajout seul, RLS forcée, index menant par `tenant_id`, cycle complet en base | `20261020090000` |
| **la file durable** | prise par **fait nouveau**, index unique partiel, verrou consultatif, abandon **dérivé**, trois natures d'échec | `fabrique/travaux*.ts` |
| **l'interprète** | reconnaissance, interprétation, **abstention** | `fabrique/interprete*.ts` |
| **le générateur** | un modèle propose, le validateur refuse, le cycle décide | `fabrique/generateur*.ts`, `cycle*.ts` |
| **le branchement** | point d'insertion **unique**, entre le plan de jetons et la désignation | `malica/lecture/par-recette.ts` |

### Les garanties qui tiennent par construction, pas par discipline

- **une recette produit une DÉSIGNATION, jamais une valeur.** Le type ne laisse
  aucun endroit où écrire un montant, le schéma de stockage refuse toute clé
  `valeur`/`value`/`montant`/`amount` **à n'importe quelle profondeur**, et une
  épreuve inspecte la sortie **sérialisée**. Tout le reste — recollage des
  milliers, relecture du plan, normalisation, citation, contrôles — est
  **partagé** avec la chaîne existante ;
- **la non-régression est structurelle** : le branchement est un `if` sur un
  paramètre optionnel. Sans recette applicable, le code exécuté est **exactement**
  celui d'avant. *« Il n'y a rien à désactiver. »* ;
- **une décision comptable ne devient jamais une règle de lecture** : trois
  verrous en base — une colonne calculée, un `check`, une clé étrangère composée.
  *« Mentir échoue sur le check, dire vrai échoue sur la FK. »* Délibérément
  **pas** une ligne de référentiel : un seuil se surcharge, cette frontière ne
  doit pas pouvoir se retourner ;
- **aucune recette ne naît d'un exemple unique** : à un exemple, l'ossature porte
  le nom du client et deux articles — mesuré, 0,0000 devient 0,0960 chez un autre
  client. Trois verrous : comptage, déduplication sur l'empreinte, vocabulaire
  commun ;
- **une recette suspendue rend la main au modèle** sans perdre pièces,
  exécutions ni historique ;
- **l'isolation est éprouvée sous identité `authenticated` réelle** — 15 verdicts,
  dont un intrus à **zéro ligne** même en nommant la version d'un autre par son
  identifiant. Aucune requête en superutilisateur.

---

## Les fichiers et les migrations

**Code** : `apps/api/src/fabrique/` (langage, validateur, signature, distance,
relations, écriture, tableau, interprète, reconnaissance, réglages, travaux,
exécution, générateur, cycle, mesures) · `apps/api/src/malica/lecture/par-recette.ts`,
`coureur.ts` · `apps/api/src/depots/fabrique.ts` · `packages/socle/src/sens-de-la-piece.ts`
· `apps/web/src/routes/_authenticated/cabinet.lecteurs.tsx`.

**Migrations** : `20261020090000` (socle) · `20261020100000` (réglages de
signature) · `20261020120000` (file durable) · `20261020130000` (rôle et tarif
`recette`) · `20261020140000` (tarif du générateur) · `20261020150000` (ordre
déterministe des seuils).

**Contrat** : 23 dépôts, 218 méthodes. Chaque ajout délibéré, relevé par
`npm run contrat`.

---

## Les commandes de vérification, et leurs résultats

```bash
npm test            # api 994 (986 passées, 8 sautées) · web 538 · socle 260 · racine 53
                    # 0 échec, 0 todo
npm run typecheck   # muet
npm run code-mort   # muet
npm run contrat     # 23 dépôts, 218 méthodes
node --test db/reproductibilite.test.mjs   # 14/14
node --test db/registre.test.mjs           # 0 écart / 5 108 objets
```

`npm run lint` échoue sur **cinq scripts d'atelier non commités** d'une autre
session (`.entetes/*.mjs`, `db/sauvegardes/diag-lignes-2026-10-19/*`). Ils ne
sont pas du code livré ; ils doivent partir ou être formatés avant livraison.

---

## Le scénario démontrable

**Ce qui est démontré, sur données synthétiques identifiées comme telles** :
format inconnu → signature → ossature sur plusieurs exemples → recette
candidate → validation stricte → évaluation → observation → activation →
document suivant **traité par le lecteur spécialisé, sans appel de modèle**, avec
le même résultat que le modèle. Puis dérive → suspension → retour au chemin IA,
historique conservé.

**Ce qui n'est PAS démontré sur du réel, et le blocage est nommé** :
`jeu-d-or.ts` porte **une seule** facture réelle avec vérité terrain, et le
générateur refuse — **doit** refuser — un exemple unique.

> **Il manque deux pièces réelles du même format.** C'est le seul ingrédient.

Une fois obtenues, la comparaison côté lecture est **gratuite** (plan et
désignation attendue déjà en place) ; seule la génération coûte un appel :

```bash
cd apps/api
MALICA_API_URL=… MALICA_EMAIL=… MALICA_MOTDEPASSE=… DEEPSEEK_API_KEY=… \
FABRIQUE_TENANT=<uuid> FABRIQUE_SIGNATURE=<clé> FABRIQUE_INSCRIRE=1 \
node --experimental-strip-types tests/real/fabriquer-une-recette.ts
```

puis `fabrique.evaluerUneVersion` : **les mesures rendues sont la réponse.**

---

## Les mesures disponibles

**La séparation des formats**, écrite dans le banc et non seulement dans un
rapport :

| | distance |
|---|---|
| même format — autres valeurs, six lignes, autre client, autre cadrage | **0,0000** |
| **format voisin et incompatible** | **0,1542** |
| deux pages contre une référence d'une page | 0,1529 |

Seuil livré **0,08**, marge **0,0742**. Elle valait 0,019 avant correction de la
dilution : trois couples contredits sur quatre-vingt-onze, parce que la
quasi-totalité des couples d'une page **s'accordent gratuitement** — que
l'en-tête soit au-dessus du pied est vrai de toute facture du monde. Le défaut
était le **dénominateur**, pas les poids.

**Le coût**, journalisé par couple (modèle, rôle), coût nul et souverain pour la
recette, tarifé pour le générateur :

```
        agent        |       model       |    cost    | tokens_in | tokens_out
 fabrique.generateur | deepseek-reasoner | 0.00238560 |      2400 |        620
```

Pour mémoire, la chaîne entière mesurée : **18 à 21 s** par pièce, dont **3 s** de
désignation, pour ≈ **0,0035 $**. Une recette économise la **désignation**, pas
le relevé — et c'est ce qu'il faut mesurer.

**Ce qui n'est pas mesuré reste absent.** L'écran sépare les mesures calculées
des mesures absentes, qui portent leur nom, le mot *absente* et leur raison. Un
tiret dans une colonne de chiffres se lit comme un zéro, et **zéro franchit « au
plus zéro »**.

---

## Les limites, nommées

1. **`other_charges` vide par recette.** Le langage n'exprime pas un droit hors
   TVA. Sur une facture à timbre — c'est-à-dire la plupart en Tunisie — le
   contrat sortira **partiel** et la chaîne reprendra la main. **Cela borne
   l'économie réelle de la fabrique**, et c'est la limite la plus importante de
   cette livraison.
2. **La marge de 0,0742 est mesurée sur des plans fabriqués.** Elle quadruple,
   elle ne devient pas confortable. Il faudrait un corpus réel de **couples** de
   formats voisins.
3. **La tolérance aux accidents de mise en page est mesurée, pas
   confortable** : un accident pèse ~0,03 ; à 0,08, deux passent, trois font
   échouer la reconnaissance.
4. **`ancre_texte_min = 3` rend impossible une recette désignant un total HT de
   facture française ordinaire** — « HT » fait deux caractères. R10 : le cabinet
   le change sans déploiement, mais le défaut livré n'est probablement pas 3.
5. **Le coureur n'est pas un démon** : il tourne sous l'identité de l'appelant
   (R6 — aucun chemin utilisateur n'emprunte un rôle privilégié). Un travail
   abandonné redevient prenable seul, mais **attend un prochain appel**.
6. **Rien ne déclenche une génération en production.** La forme juste est un
   travail de la file, à côté de la lecture. La vraie question est commerciale :
   **au bout de combien de pièces d'un même format Malica propose-t-elle ?**
7. **Un expert de cabinet ne peut pas inscrire une recette pour son mandat** :
   la politique d'insertion exige l'appartenance. Aucun écran ne le propose
   aujourd'hui ; le jour où il le proposera, c'est une décision de droits.
8. **Six lignes orphelines dans la base d'atelier locale**, résidus d'un semis.
   Inertes pour les écrans (jointure interne), mais l'intégrité référentielle est
   rompue. Leur suppression exige de désactiver **tous** les déclencheurs, clés
   étrangères comprises : le garde-fou de l'atelier l'a refusée, et **elle n'a pas
   été contournée**.

---

## La procédure de mise en service

1. **Jouer les six migrations.** Elles sont rejouables ; `db/registre.test.mjs`
   le vérifie.
2. **Vérifier les réglages du référentiel.** Trente et un seuils vivent sous
   `fabrique.seuil.*`, datés en littéral et surchargeables par cabinet
   (`parametrage.fabrique_seuils`). **Toutes les fonctions qui les lisent lèvent
   si une seule borne manque** plutôt que d'en rendre une partie : c'est
   volontaire, et cela veut dire qu'une migration incomplète **arrête** la
   fabrique au lieu de la faire tourner de travers.
3. **Vérifier les tarifs.** Le générateur et la recette ont chacun leur ligne,
   par couple (modèle, rôle). **Un couple absent fait refuser l'écriture du
   journal en silence** — ce défaut a coûté dix jours de mesures à ce dépôt, et
   s'est manifesté **quatre fois**. Et une ligne datée **du lendemain** n'existe
   pas encore.
4. **Démarrer en observation.** Toute recette naît ainsi : elle s'exécute, on
   compare, **on ne la croit pas**. Ce n'est pas une excuse pour un cycle
   incomplet — activation, suspension, retrait et retour arrière existent et sont
   éprouvés.
5. **Retour arrière** : suspendre suffit. `contexteDeDesignation` ne rend que les
   recettes en observation ou actives, donc une suspension renvoie la pièce
   suivante vers le modèle, **immédiatement**, sans perdre pièces, exécutions ni
   historique.

Aucun réglage d'environnement nouveau n'est requis. Aucun secret n'apparaît dans
cette documentation.
