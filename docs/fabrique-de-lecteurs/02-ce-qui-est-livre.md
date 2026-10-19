# La fabrique de lecteurs — ce qui est livré, et ce qui ne l'est pas

_19 octobre 2026. Écrit après la livraison, avec les mesures sous les yeux._

Chaque format documentaire suffisamment éprouvé devient un **lecteur spécialisé
réutilisable**. Pour un document récurrent, Malica cesse d'appeler un modèle
distant pour la désignation — **sans rien perdre des citations ni des
contrôles**.

---

## Ce qui fonctionne réellement

### La promesse, mesurée

Sur une même facture, une recette lue **sans aucun appel de modèle** rend :

|                            | recette       | modèle     |
| -------------------------- | ------------- | ---------- |
| jetons désignés            | identiques    | identiques |
| citations                  | **14**        | **14**     |
| drapeaux                   | identiques    | identiques |
| contrat / validité         | identiques    | identiques |
| `extract`                  | **identique** | —          |
| `field_confidence.overall` | `1`           | `0,9`      |

Le seul écart est le dernier, et il est **voulu** : une recette ne produit
**aucun** score. Le neutre est passé explicitement au point d'appel, et l'écran
n'affiche **aucun pourcentage** pour ces pièces.

### Les sept briques

|                     | ce qu'elle fait                                                                                                                                                                                                                            | où                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **le langage**      | 39 opérateurs en 12 familles **closes**, non récursif, aucune expression régulière, validateur strict rendant la liste **complète** des refus                                                                                              | `fabrique/recette*.ts`                 |
| **la signature**    | ancres normalisées (casse, accents, hamza, vocalisation, tatweel), relations **dans le sens de lecture**, colonnes, pages, empreinte. Tout **relatif à la boîte de contenu** : recadrage, échelle et inclinaison rendent la même empreinte | `fabrique/signature*.ts`               |
| **le socle**        | neuf tables en ajout seul, RLS forcée, index menant par `tenant_id`, cycle complet en base                                                                                                                                                 | `20261020090000`                       |
| **la file durable** | prise par **fait nouveau**, index unique partiel, verrou consultatif, abandon **dérivé**, trois natures d'échec                                                                                                                            | `fabrique/travaux*.ts`                 |
| **l'interprète**    | reconnaissance, interprétation, **abstention**                                                                                                                                                                                             | `fabrique/interprete*.ts`              |
| **le générateur**   | un modèle propose, le validateur refuse, le cycle décide                                                                                                                                                                                   | `fabrique/generateur*.ts`, `cycle*.ts` |
| **le branchement**  | point d'insertion **unique**, entre le plan de jetons et la désignation                                                                                                                                                                    | `malica/lecture/par-recette.ts`        |

### Les garanties qui tiennent par construction, pas par discipline

- **une recette produit une DÉSIGNATION, jamais une valeur.** Le type ne laisse
  aucun endroit où écrire un montant, le schéma de stockage refuse toute clé
  `valeur`/`value`/`montant`/`amount` **à n'importe quelle profondeur**, et une
  épreuve inspecte la sortie **sérialisée**. Tout le reste — recollage des
  milliers, relecture du plan, normalisation, citation, contrôles — est
  **partagé** avec la chaîne existante ;
- **la non-régression est structurelle** : le branchement est un `if` sur un
  paramètre optionnel. Sans recette applicable, le code exécuté est **exactement**
  celui d'avant. _« Il n'y a rien à désactiver. »_ ;
- **une décision comptable ne devient jamais une règle de lecture** : trois
  verrous en base — une colonne calculée, un `check`, une clé étrangère composée.
  _« Mentir échoue sur le check, dire vrai échoue sur la FK. »_ Délibérément
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
déterministe des seuils) · `20261020170000` (la génération est une nature de
travail) · `20261020180000` (le seuil de déclenchement, la proposition, le
preneur qui dit ce qu'il sait faire) · `20261020190000` (l'expert engagé
inscrit).

**Migration du 19 octobre, après mesure** : `20261020200000` (le défaut
`ancre_texte_min` passe de 3 à 2 — voir la limite n° 4).

**Contrat** : 23 dépôts, **219** méthodes. La 219ᵉ est
`fabrique.codesDuReferentiel`, ajoutée le 20 octobre : le générateur donne au
modèle la liste des codes de droit et de taux du pack de l'organisation, comme
l'invite du désignateur le fait déjà. Une organisation sans juridiction **lève**
au lieu de se voir attribuer un pack par défaut (R4, corollaire). Chaque ajout
délibéré, relevé par `npm run contrat`.

---

## Les commandes de vérification, et leurs résultats

```bash
npm test            # api 1 059 (1 051 passées, 8 sautées) · web 540 · socle 260 · racine 53
                    # 0 échec, 0 todo
npm run typecheck   # muet
npm run code-mort   # muet
npm run contrat     # 23 dépôts, 219 méthodes
node --test db/reproductibilite.test.mjs   # 14/14
node --test db/registre.test.mjs           # 8/8
```

`npm run lint` échoue sur des **scripts d'atelier non commités** d'autres
sessions (`.entetes/*`, `.tmp-reparation/*`,
`db/sauvegardes/diag-lignes-2026-10-19/*`). Ils ne sont pas du code livré ; ils
doivent partir ou être formatés avant livraison. Les fichiers de la fabrique
sont vérifiés isolément, et propres.

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

> **Il manque deux pièces réelles distinctes du même format.** C'est le seul
> ingrédient. Deux factures du même fournisseur à la même PME, où seuls les
> montants, les dates et les numéros changent, suffisent — c'est le cas
> ordinaire d'une facture d'achat, et c'est mesuré
> (`fabrique/une-facture-d-achat-se-genere.test.ts`). Ce qui ne suffit pas, et
> ne suffira jamais, ce sont **deux dépôts du même papier** : leur plan de
> jetons est le même, et l'intersection de quelque chose avec lui-même ne fait
> rien tomber.
>
> Une version de cette ligne, écrite le 20 octobre au matin, exigeait « au moins
> deux clients différents ». C'était la trace d'un défaut, pas une exigence :
> voir la limite n° 9.

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

|                                                                       | distance   |
| --------------------------------------------------------------------- | ---------- |
| même format — autres valeurs, six lignes, autre client, autre cadrage | **0,0000** |
| **format voisin et incompatible**                                     | **0,1542** |
| deux pages contre une référence d'une page                            | 0,1529     |

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
des mesures absentes, qui portent leur nom, le mot _absente_ et leur raison. Un
tiret dans une colonne de chiffres se lit comme un zéro, et **zéro franchit « au
plus zéro »**.

---

## Les limites, nommées

1. ~~**`other_charges` vide par recette.** Le langage n'exprime pas un droit
   hors TVA.~~ **LEVÉE le 19 octobre 2026**, et mesurée. Le langage a une
   section `droits` : une recette **nomme** le code — il vient de
   `ref.fiscal_charges`, elle ne le lit pas sur la pièce, exactement comme le
   modèle à qui l'invite donne la liste — et **désigne** le jeton qui porte le
   montant. La règle n° 1 ne bouge pas : la valeur se relit dans le plan, par la
   chaîne partagée.

   **Ce qui est mesuré**, sur le pack tunisien réel et sans aucun appel de
   modèle (`fabrique/une-recette-lit-une-facture-a-timbre.test.ts`) : une
   facture à timbre lue par une recette sort en `extract.v1` **valide**, le
   droit porte sa **citation** (`other_charges[0].amount`), et l'écriture est
   **proposable** — aucun motif bloquant, aucun résidu à attribuer, débit égal
   au crédit au millime.

   **Ce que la limite coûtait exactement**, et c'est plus précis que « partiel » :
   un timbre **au barème** était rattrapé par le moteur d'équilibre, qui
   retrouvait le résidu et l'imputait au `fixed_amount` du pack
   (`RESIDUAL_MATCHED_PACK_CHARGE`, en _info_) — l'écriture passait, mais le
   montant venait du **pack** et **aucune citation** ne le portait. Un timbre
   **hors barème** — deux dinars là où le pack en porte un, ou toute charge que
   le pack ne fixe pas, comme le FODEC — **bloquait** sur
   `RESIDUAL_UNEXPLAINED`. Les deux cas sont au banc.

   ~~**Ce qui reste ouvert**~~ — **les quatre points nommés le 19 octobre sont
   levés le 20, et mesurés.**

   - ~~Le **générateur** ne proposait jamais de section `droits`.~~ **LEVÉE.**
     Sa consigne énumérait les clés de premier niveau et terminait par « Aucune
     autre clé n'est acceptée » : la section était **interdite par l'invite même
     qui devait l'apprendre**, donc une recette à timbre s'écrivait à la main —
     sur un marché où la quasi-totalité des factures en portent un. L'invite
     porte désormais la section, l'observation du droit sous son **code**, et la
     liste des codes du pack (`fabrique.codesDuReferentiel`, R4 : aucun code
     en TypeScript). **Mesuré** dans
     `fabrique/le-generateur-propose-une-recette-a-timbre.test.ts` : une
     recette **proposée par le générateur**, passée au branchement puis au
     moteur d'équilibre sur le pack tunisien réel, rend une écriture
     **proposable**, droit **cité**, pied qui boucle, débit égal au crédit.

   - ~~`cycle-mesures.ts` ne mesurait pas les droits.~~ **LEVÉE.** Une recette
     pouvait être **promue** en désignant mal son timbre : `mesurer()`
     parcourait `obtenu.champs`, et les droits vivent dans `obtenu.droits`. Un
     droit attendu compte maintenant **comme un champ critique ET comme un
     montant** — un montant de timbre faux entre dans une écriture au même
     titre qu'un total, et la distinction `champs` / `droits` est une commodité
     de structure du langage, pas une hiérarchie d'importance. Le compte est
     écrit **une seule fois** et appelé deux, pour qu'aucune copie ne dérive.
     L'écart porte le nom que la **chaîne** cite — `other_charges[<rang>].amount`.

   - ~~Le code de **taux** d'une ligne restait une désignation.~~ **LEVÉE**, et
     c'était bien le même cas — pour une raison qui ne se lisait pas dans le
     langage : **dans le chemin du modèle, `tax_code` n'est déjà pas une
     désignation.** L'invite de `vision.ts` écrit `"tax_code":"<un code de la
     liste fournie>"` ; le modèle **nomme** un code du référentiel sans le lire,
     comme il nomme un code de droit. C'était le chemin de la **recette** qui
     était l'anomalie. `tax_code` sort donc des colonnes et un tableau porte
     `code_de_taux`, nommé depuis `ref.tva_rates`. **Et le plan de banc a perdu
     son contournement** : il imprimait « TVA19 » et son commentaire le disait ;
     il imprime « 19% ». **Mesuré** dans
     `fabrique/une-recette-nomme-le-code-de-taux.test.ts` : désigné, le taux
     imprimé est inconnu du pack et **bloque** l'écriture sur
     `MISSING_TAX_RATE`.

     **Ce qu'un code nommé coûte quand il est faux, et c'est la question qu'il
     fallait trancher avant de nommer** : une déclaration unique pour N lignes
     ne sait pas exprimer un récapitulatif à **plusieurs taux**. Elle ne se tait
     pas pour autant — `computePivot` vérifie `base × taux ≈ TVA` **ligne par
     ligne** et bloque sur `TAX_RATE_MISMATCH`. Un format à plusieurs taux lu
     par une recette rend donc la main, **visiblement**, au lieu de ventiler de
     travers : c'est exactement l'erreur trouvée chez un expert le 11 octobre,
     équilibrée au millime et sans trace de son origine.

   - ~~Deux commentaires affirmaient `ancre_texte_min` livré à 3.~~ **Corrigés**
     (`fabrique/generateur.test.ts`, `fabrique/cycle.test.ts`). Leurs
     assertions passaient — elles passent 3 explicitement — et leur prose
     mentait depuis la migration `20261020200000`.

   **Ce qui reste ouvert après ce travail, et c'est plus étroit** : rien ne
   **dérive** les droits ni les codes de taux d'un exemple. Celui qui qualifie
   un exemple les déclare, dans l'enveloppe `attendu` (sections `droits` et
   `codes_de_taux`, entrées sans migration — un `jsonb` accepte une clé de
   plus). Un exemple muet n'apprend rien, et c'est juste : rien ne l'ayant dit,
   aucune section ne sera proposée. Un code de taux **deviné** par un modèle
   serait un taux deviné, donc une valeur liante — R3 le refuse nommément
   (`CODE_HORS_DES_EXEMPLES`), et l'autorité de ce refus est l'**exemple**, pas
   le référentiel : le juge du code au pack reste en aval, là où la date de la
   pièce existe.

   **Et le défaut le plus grave de la livraison, trouvé en écrivant ce banc, et
   corrigé le même jour** — voir la limite n° 9, qui le porte en entier.

2. **La marge de 0,0742 est mesurée sur des plans fabriqués.** Elle quadruple,
   elle ne devient pas confortable. Il faudrait un corpus réel de **couples** de
   formats voisins.
3. **La tolérance aux accidents de mise en page est mesurée, pas
   confortable** : un accident pèse ~0,03 ; à 0,08, deux passent, trois font
   échouer la reconnaissance.
4. **La borne d'ancre portait sur la mauvaise grandeur.** Le défaut livré passe
   de 3 à **2** (migration `20261020200000`, date de validité en littéral), et
   la raison n'est pas que 3 refusait le banc : c'est que **la longueur ne
   prédit pas ce qu'une ancre attrape**. Mesuré sur le pied de la facture
   française de banc (`fabrique/interprete.test.ts`), en comptant les jetons
   réellement attrapés : « HT » (2) → 1 jeton, « TVA » (3) → 1, « TTC » (3) → 1,
   « Qte » (3) → 1, « Total » (5) → **3**, « FACTURE » (7) → **2**,
   « Designation » (11) → 1. **À 3, la borne refusait quatre ancres qui ne
   désignent qu'un jeton, et aucune des deux qui en désignent plusieurs.**

   Ce qui discrimine est le **genre** du motif : « HT » en `exact` attrape un
   jeton, le même « HT » en `contient` en attrape trois — « HT », « P.U.HT »,
   « BaseHT ». Une borne de longueur refuse les deux ou accepte les deux. Et la
   garde qui tient réellement est `prendre: unique`, qui **s'abstient** au lieu
   de choisir : mesuré sur « Total », cinq caractères et trois jetons.

   **Ce qui s'ouvre à 2** : un motif `contient` de deux caractères associé à un
   `prendre` qui choisit (`premier`, `dernier`, `nieme`) désignerait un jeton
   sans le dire. Ce trou n'est pas ouvert par ce changement — il existait à
   **toute** longueur, et « Total » en `exact` avec `premier` en est la preuve.
   Une ancre d'**un** caractère reste refusée, donc le cas arabe « ت » reste
   surchargeable par cabinet (R10) et non livré.

   **La garde juste, et elle n'est pas posée** : le nombre de jetons qu'une
   ancre attrape **sur les exemples de la recette**. Elle ne se tient pas dans
   le validateur, qui est pur et ne voit aucune pièce par construction ; elle se
   tient là où les plans existent — à la **génération** et à l'**évaluation**,
   donc dans `fabrique/generateur*` et `fabrique/cycle*`. La forme exacte est
   écrite dans `.superpowers/sdd/fabrique/limites-langage-report.md`.

5. **Le coureur n'est pas un démon, et ce n'est plus une limite ouverte : c'est
   une réponse.** Il tourne sous l'identité de l'appelant, un travail abandonné
   redevient prenable seul, et il **attend un prochain appel de cette
   organisation**. La question posée était : une reprise automatique peut-elle
   se faire sans violer R6, puisqu'un travail abandonné appartient au système
   et non à un client ? **Non**, et la base le démontre plutôt que de
   l'affirmer :

   - un opérateur de plateforme **ne voit pas la pièce** — `capture_pieces_sel`
     passe par `app.plateforme_requise(tenant_id)` depuis
     `20261019090000`, qui exige une réquisition **approuvée et ouverte**. Une
     reprise par la tour devrait donc ouvrir une réquisition par dossier pour
     relire une facture : ce n'est pas une porte, c'est le contraire du contrat
     qu'on vend ;
   - et quand bien même : la politique d'écriture de `fabrique.travail_faits`
     exige l'appartenance, `app.is_platform()` n'y figure pas, donc **la
     plateforme n'inscrit pas la prise d'un travail**.

   Les deux refus sont éprouvés sous identité réelle dans
   `fabrique/un-expert-engage-inscrit.test.ts`. Rendre la reprise automatique
   exigerait une identité de service écrivant dans les tables de tenant d'un
   client — exactement ce que R6 interdit, et ce qu'aucune épreuve ne pourrait
   rattraper. **La limite reste, assumée** : elle est le prix de R6, et le prix
   est juste. Ce qui l'adoucit est ailleurs — le coureur **draine** la file de
   l'organisation (jusqu'à vingt travaux par appel), donc un travail abandonné
   repart au premier appel suivant, le sien ou celui d'un autre membre.

6. ~~**Rien ne déclenche une génération en production.**~~ **Levée.** Une
   génération est désormais un **travail de la file**
   (`fabrique.travail_nature_t = 'generation_recette'`), proposé par
   `fabrique.generation_proposer` au moment où un exemple est qualifié — le
   seul fait qui change le compte d'un format — et exécuté par le coureur,
   comme une lecture, avec les mêmes bornes et le même journal.

   Le nombre est tranché, et c'est un **défaut R10** : `fabrique.seuil.
generation.pieces_min = 3`, daté en littéral dans `ref.socle_params`,
   surchargeable par cabinet dans `parametrage.fabrique_seuils` **sans
   déploiement**. Trois, parce que **deux est le plancher technique**
   (`EXEMPLES_MINIMUM_POUR_UNE_OSSATURE` ; à un exemple l'ossature porte le nom
   du client, mesuré 0,0000 → 0,0960), que déclencher _au_ plancher ferait
   payer un appel pour une ossature qui retient tout ce que deux documents
   partagent par hasard, et qu'attendre **plus** est une perte sèche : une
   génération coûte 0,0024 $, une désignation 0,0035 $ par pièce — le retour
   est atteint dès la première pièce lue par la recette.

   Trois garde-fous, tous tenus par la base : **jamais deux fois pour le même
   format** (l'index unique `(tenant_id, cle_idempotence)` sur
   `generation_recette:<signature>`, et zéro ligne rendue veut dire « déjà
   proposée ») ; **jamais pour un format qui a déjà un lecteur** ; et
   **toujours journalisée** par son couple (modèle, rôle), réussite **ou
   refus** — un appel refusé a coûté autant qu'un appel retenu.

   Ce qui reste ouvert est plus étroit, et c'est écrit dans
   `10-ce-qui-reste-ouvert.md` : **rien ne qualifie un exemple tout seul.** Le
   déclenchement part d'un exemple qualifié, et aujourd'hui c'est un humain qui
   le qualifie. Faire d'une désignation du modèle une vérité terrain sans
   validation est une décision de qualité, pas d'orchestration.

7. ~~**Un expert de cabinet ne peut pas inscrire une recette pour son
   mandat.**~~ **Levée.** Il peut, pour un dossier sous **mandat ACTIF** —
   cohérence avec une décision déjà en base : la lecture d'un expert engagé se
   compte sur la licence du client, et celui qui lit les pièces est celui qui
   sait quel format revient.

   `app.engaged_orgs_as_expert()` est plus étroite que `app.engaged_orgs()` de
   deux crans : le **rôle** expert, et le fait que rôle et mandat se lisent sur
   **la même ligne** d'engagement — sans quoi un expert du cabinet A verrait
   son rôle servir un mandat porté par le cabinet B. Un mandat _proposé_, un
   mandat _échu_ et un _collaborateur_ du cabinet engagé sont refusés **par la
   base**, éprouvés sous identité réelle.

   **Inscrire n'est pas promouvoir** : l'expert engagé n'écrit que la naissance
   (`etat = 'candidate'`, dans le prédicat de la politique). Le cycle reste au
   dirigeant et à l'expert du dossier. Et il **propose** une génération sans
   l'exécuter : `public.agents_run_log` exige l'appartenance, donc un expert
   engagé ne peut pas journaliser un appel payant — la file du client exécute
   et paie. Ce n'est pas une ligne écrite pour l'occasion, c'est la base qui
   tenait déjà la frontière.

8. **Six lignes orphelines dans la base d'atelier locale**, résidus d'un semis.
   Inertes pour les écrans (jointure interne), mais l'intégrité référentielle est
   rompue. Leur suppression exige de désactiver **tous** les déclencheurs, clés
   étrangères comprises : le garde-fou de l'atelier l'a refusée, et **elle n'a pas
   été contournée**.

9. ~~**Aucun format de facture d'ACHAT ne pouvait être généré.**~~ **LEVÉE le
   20 octobre 2026**, et c'était le défaut le plus grave de la livraison — il
   n'avait rien à voir avec un corpus manquant.

   Le générateur dédupliquait ses exemples sur l'**empreinte de signature**. Or
   cette empreinte dit un **format**, et rien d'autre : ses clés d'ancre
   écartent délibérément tout jeton portant un chiffre, parce qu'un montant ne
   décrit pas la forme du papier. S'en servir pour **rejeter** un exemple lui
   faisait dire autre chose — deux documents de même empreinte sont le même
   **format**, jamais le même **exemplaire**.

   **Ce que cela coûtait, mesuré** (`fabrique/une-facture-d-achat-se-genere.test.ts`) :
   ce que Malica lit est une facture d'achat, le modèle du fournisseur reçu tous
   les mois, et sur toutes ces factures **le client est la même PME**. Son nom
   est du texte, sans chiffre, donc il entrait dans l'empreinte. Deux factures
   du même fournisseur à la même PME portaient donc la **même** empreinte et
   comptaient pour **une** — le générateur refusait sur
   `EXEMPLES_INSUFFISANTS`. Les trois réponses étaient oui : même empreinte,
   dédupliquées, refus. Et un dirigeant ne reçoit pas la même mise en page de
   deux fournisseurs différents.

   **Le critère juste est l'empreinte de l'EXEMPLAIRE** : le plan de jetons
   lui-même, texte compris. Deux dépôts du même papier portent les mêmes mots
   dans le même ordre ; deux factures distinctes n'en portent pas. Ce n'est pas
   lire une valeur — rien n'en sort qu'un condensé, et le module lit déjà le
   texte de tous les jetons pour en tirer le vocabulaire commun.

   **Ce n'est pas `pieceId`** : deux dépôts du même papier sont deux pièces,
   donc l'identifiant les compterait pour deux. Mesuré : sous ce critère, les
   deux épreuves qui tiennent « un même document ne fait pas deux exemples »
   tombent.

   **Ce que la déduplication fermait reste fermé**, et c'était la condition :
   deux exemplaires du même document font toujours **un** exemple, dans ce banc
   et dans celui du générateur.

   **La borne du nouveau critère, dite** : la comparaison est mot pour mot, donc
   deux relevés du même papier qui différeraient d'un seul jeton — un accident
   d'OCR — compteraient pour deux, et l'ossature garderait alors le nom du
   client. Ce prix est assumé, **et il repose sur une condition vérifiée** : ce
   nom est sans conséquence tant qu'une recette reste privée à l'organisation,
   puisque le client y est toujours le même. La **mutualisation est éteinte**,
   et pas par discipline : `fabrique.recettes.portee` existe, et **aucune
   politique ne lit cette valeur** — marquer une recette `mutualisee` ne la
   partage pas. C'est éprouvé sous identité réelle dans
   `fabrique/socle-de-donnees.test.ts`. Le jour où la mutualisation s'allume,
   **ce compromis doit être rouvert** : une recette partagée dont l'ossature
   porte le nom d'un client ne reconnaîtrait rien chez un autre cabinet.

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
