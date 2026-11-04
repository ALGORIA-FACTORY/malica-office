# Dossier d'invention — la lecture prouvée sans apprentissage

**Statut : projet de travail, à remettre à un conseil en propriété industrielle.**
Ce dossier n'est pas une demande de brevet. Les revendications sont des projets. La
recherche d'antériorité est **INCERTAINE** : une recherche rapide seulement (voir
« Antériorités repérées »), à refaire par le conseil avant tout dépôt. Rien ne doit être
publié avant le dépôt : une divulgation publique (article, démonstration ouverte, dépôt
public du code) peut détruire la nouveauté.

Déposant pressenti : ALGORIA FACTORY SARL. Date de conception consignée : novembre 2026
(historique Git de la branche `feat/banc-sans-ia`, commits datés, à conserver comme
preuve d'antériorité).

## 1. Le problème

Lire une pièce comptable — facture, avoir, relevé, bulletin, déclaration — et en sortir
des valeurs **sûres** : chaque valeur citée sur la page, juste, ou rien. Les lecteurs du
marché s'appuient sur des modèles appris (vision, langage) : ils lisent beaucoup, mais
peuvent se tromper avec assurance (« halluciner »), coûtent du calcul (GPU), et ne disent
pas pourquoi.

Le procédé décrit ici n'utilise **aucun modèle appris pour décider d'une valeur**. Un OCR
léger sur processeur donne des jetons (texte et position) ; un moteur de contraintes
(« Sudoku ») ne rend une valeur que si elle est **prouvée** par une relation de la grille
du document (somme, taux, lettres, ordre, identité des parties), ou lue par un expert
sous des invariants qui l'empêchent d'être fausse. Tout ce qui fait varier la lecture —
grilles, repères, formats, domaines de valeurs, rôles des parties, taux, charges — est
une **donnée** du référentiel, versionnée, et jamais du code.

## 2. Le banc qui mesure

Le banc sans IA (`apps/api/src/malica/lecture/banc-sans-ia.ts`) fait passer 412 pièces par
la chaîne de production et compte chaque concept imprimé :

- **juste** ;
- **faux** ;
- **silence** (non lu) ;
- **inventé** (non imprimé, et pourtant lu).

Les pièces viennent de quatre corpus :

- 161 pièces fictives du jeu d'ALGORIA, de 25 types ;
- 100 factures synthétiques ;
- 150 pièces des jeux du dirigeant ;
- une pièce réelle, MyTek.

Mesures du 4 novembre 2026, sur les mêmes pièces :

|                      | Faux + inventés |    Justes | Sens des parties dit | Inversions acheteur/vendeur |
| -------------------- | --------------: | --------: | -------------------: | --------------------------: |
| Avant les inventions |             489 |     4 014 |                   62 |           6 (pièces arabes) |
| Après                |         **100** | **4 842** |              **131** |                       **0** |

Chaque invention ci-dessous a été mesurée seule. Aucune n'a été gardée si elle créait un
faux nouveau.

## 3. Les inventions

### I-A — Le côté d'un libellé, décidé par vote, quelle que soit l'écriture

**Problème.** Sur une page arabe, le libellé est à droite de sa valeur. Sur une page
bilingue écrite de gauche à droite, un libellé arabe peut être à sa gauche (« Client /
الحريف : Société… »). Le côté n'est donc fixé ni par l'écriture du libellé, ni par celle
de la page. Les lecteurs supposent un sens de page, ou s'appuient sur un modèle
d'agencement appris.

**Ce qui est nouveau.** Le côté que désigne un libellé est voté par des indices pondérés :

- 3 : le deux-points collé au bord du libellé lui-même ;
- 2 : un séparateur entre le libellé et une **valeur**, c'est-à-dire un jeton qui n'est
  ni une ponctuation ni le libellé d'un champ de la grille. Un séparateur suivi d'un
  second libellé (paire bilingue) ne vote pas ;
- 1 : la valeur la plus proche ;
- en cas d'égalité : la direction Unicode du libellé.

Le bloc qu'un libellé de partie ouvre s'étend du côté voté. Toute relation géométrique du
moteur (avant/après, bloc, nom de la partie) se calcule dans ce sens.

**Effet mesuré.** Les 6 inversions acheteur/vendeur sur les pièces arabes ont disparu, et
le sens est dit sur 8 pièces de plus.

**Projet de revendication 1.** Procédé de liaison d'un libellé à sa valeur dans un
document lu par reconnaissance de caractères, comprenant :

- (a) la détermination, pour un libellé reconnu, de deux côtés candidats sur sa ligne ;
- (b) le calcul, pour chaque côté, d'un score combinant :
  - la présence d'un séparateur attaché au libellé ;
  - la présence d'un séparateur entre le libellé et un jeton qui n'appartient à aucun
    libellé connu de la grille du document ;
  - la proximité de ce jeton ;
- (c) le choix du côté de score maximal, et à égalité de celui donné par la classe
  bidirectionnelle Unicode du libellé ;
- (d) la restriction de toute valeur et de tout bloc de partie ouverts par ce libellé au
  côté choisi.

### I-B — La triangulation des parties par l'identité connue et la grappe légale

**Problème.** Dire qui émet et qui reçoit une pièce, sans libellé « Client : » ni
« Fournisseur : », et sans base de fournisseurs connus.

**Ce qui est nouveau.** Trois invariants et un indice, tous issus du référentiel (rôles des
champs de la grille, identité du dossier) :

1. L'identité du dossier — clé de son identifiant fiscal, mots de sa raison sociale sans
   forme juridique — ne remplit **qu'un seul rôle** par pièce :
   - quand un rôle du dossier est prouvé, toute valeur portant cette identité dans un autre
     rôle est retirée ;
   - sans rôle prouvé, si cette identité apparaît dans deux rôles, aucun des deux ne la
     garde.
2. Le nom de l'autre partie n'est jamais celui du dossier, ni les jetons d'un identifiant.
3. **La grappe légale** : chaque libellé d'un champ que la grille réserve à un seul rôle
   (registre de commerce, RIB, téléphone, capital de l'émetteur) est affecté à
   l'identifiant fiscal le plus proche, l'écart entre colonnes pesant double. La partie
   dont la grappe porte les libellés de l'émetteur, l'autre n'en portant aucun, vote
   « émetteur ».
4. Les proclitiques arabes collés à un nom défini (« للحريف », « بال… ») se ramènent à
   l'article pour reconnaître la partie nommée dans un libellé.

**Effet mesuré.** Le sens est dit sur 131 pièces au lieu de 62, sans aucune inversion.
17 faux « fournisseur = ALGORIA » ont disparu.

**Projet de revendication 2.** Procédé d'attribution des rôles de parties dans un
document, dans lequel :

- (a) l'identité d'un titulaire connu est recherchée sous des formes normalisées ;
- (b) les libellés des champs que la grille du document associe à un seul rôle sont
  affectés à l'identifiant le plus proche selon une distance pondérée par colonne ;
- (c) le rôle d'émetteur est attribué à la partie dont l'ensemble affecté contient des
  libellés exclusivement associés à l'émetteur, l'autre partie n'en contenant aucun ;
- (d) toute valeur portant l'identité du titulaire est retirée des champs d'un rôle
  autre que celui prouvé pour le titulaire.

### I-C — Les identifiants lus par leur grammaire déclarée, à travers les jetons

**Problème.** Un identifiant imprimé (RIB, IBAN, identifiant fiscal) est coupé en groupes
par l'imprimé, et en jetons par l'OCR : « 99 340 9403398267119 10 » sortait « 99 ».

**Ce qui est nouveau.** Chaque format d'identifiant est une donnée du référentiel. Le
concept porte le format, donc tous les champs du concept le nomment, dans toutes les
grilles. Le lecteur lit tout format déclaré sur la forme **compacte** d'une suite de
jetons de la même rangée, sans espaces ni séparateurs. Le motif doit couvrir la suite
entière, et la suite la plus courte qui le fait est retenue. La forme collée de
l'identifiant fiscal se reconnaît à partir des groupes décrits par le pack, sans aucun
séparateur.

**Effet mesuré.** 55 RIB coupés sont désormais justes, et 20 RIB de pièces arabes sont
lus.

**Projet de revendication 3.** Procédé de lecture d'identifiants dans lequel :

- un format déclaré par concept dans un référentiel versionné est confronté à la forme
  compacte de suites de jetons contigus d'une rangée ;
- la suite retenue est la plus courte qui satisfait entièrement le format ;
- tout champ du concept hérite du format, dans toutes les grilles de documents.

### I-D — Les valeurs de liste lues dans leur domaine trilingue

**Problème.** Pour un champ « liste » (mode de règlement, devise, titre), les repères
mêlent libellés et valeurs. Résultat : « règlement: » ou « (DT) » rendus comme valeurs.

**Ce qui est nouveau.**

- Un concept nomme son **domaine**. Le domaine donne, pour chaque code, toutes ses formes
  imprimables : ses libellés dans les trois langues du référentiel, ses marques, et des
  formes de pratique versionnées (`ref.formes_des_valeurs`).
- Le moteur ne rend qu'un **code** du domaine. Il préfère les formes ancrées par un
  libellé du champ, et signale quand il trouve deux codes.
- Une forme prise dans le libellé d'un autre champ n'est pas une valeur (« Reçu le »),
  sauf si elle est un repère du champ lui-même. Un champ liste sans domaine ne rend
  aucune valeur.

**Effet mesuré.** Les faux sur ces champs passent de 61 à 6 environ, avec 71 lectures
justes de plus.

**Projet de revendication 4.** Procédé dans lequel :

- la valeur d'un champ à liste fermée est rendue sous la forme d'un code d'un domaine du
  référentiel ;
- le code est reconnu par correspondance avec l'ensemble multilingue des formes du code ;
- une correspondance incluse dans le libellé d'un autre champ est écartée.

### I-E — Les colonnes textuelles d'un tableau déduites de l'en-tête et des rangées prouvées

**Problème.** La désignation avalait la référence, le code-barres et l'unité imprimés à
côté : 307 désignations fausses.

**Ce qui est nouveau.**

- Les rangées prouvées par l'arithmétique (q × p = m, somme fermant le total) fixent les
  colonnes chiffrées.
- L'en-tête du tableau **nomme** les colonnes : c'est la rangée au-dessus de la première
  ligne prouvée qui porte au moins deux repères des champs de la parcelle des lignes.
- Les rangées **placent** les frontières : c'est le plus large couloir blanc commun à
  toutes les rangées prouvées, entre deux intitulés.
- Une désignation ne garde que les jetons de sa colonne, de part et d'autre des chiffres.
  Elle se prolonge sur la rangée suivante seulement si elle touchait le bord de sa
  colonne et que la rangée suivante ne porte ni étiquette ni numéro.

**Effet mesuré.** Les désignations fausses passent de 307 à 29, sans régression.

**Projet de revendication 5.** Procédé de segmentation des colonnes textuelles d'un
tableau, dans lequel :

- les rangées du tableau sont d'abord validées par une contrainte arithmétique de
  rangée et de total ;
- les colonnes sont nommées par appariement des cellules d'en-tête avec les repères des
  champs de ligne ;
- les frontières entre colonnes nommées sont placées au milieu du plus large intervalle
  horizontal non occupé par les jetons de l'ensemble des rangées validées.

### I-F — L'assiette prouvée

**Problème.** La base de TVA rendue était le HT, dans des pièces pourtant « prouvées » à
FODEC.

**Ce qui est nouveau.** La base d'un taux est la **somme prouvée** de tout ce que le pack
met dans son assiette : base des lignes et charges d'assiette présentes. Elle ne cite un
jeton que si la page imprime cette somme. À plusieurs taux, la charge ne se répartit pas
sans les lignes, donc la base n'est pas rendue.

**Effet mesuré.** 9 bases fausses sont désormais justes.

### I-G — L'OCR mixte, mot par mot, chacun dans son écriture

**Problème.** Une ligne « المعرف الجبائي : 1399012W/A/M/000 » : le modèle latin y perd
l'identifiant, le modèle arabe y perd les lettres latines. Choisir un modèle par ligne
perd toujours une des deux écritures.

**Ce qui est nouveau.**

- Une ligne que les deux reconnaissances disent bi-scripte est coupée à ses blancs (profil
  d'encre). Chaque morceau est lu par les deux modèles et garde la lecture de son
  écriture.
- Les morceaux voisins de même écriture sont relus ensemble, pour le contexte. Chaque
  morceau sort avec sa propre boîte, dans l'ordre logique.
- Une ligne dont le texte est trop court pour sa boîte (densité de caractères) est relue,
  même si ce sont des chiffres.

**Effet mesuré.** Les identifiants fiscaux, RIB, RC et libellés des pièces arabes sont lus.
Coût : la médiane OCR CPU passe de 2,3 s à 5,5 s par image. À optimiser, voir I-H.

**Antériorité probable** : l'identification de l'écriture par mot existe dans l'OCR
multilingue. La nouveauté éventuelle tient à l'arbitrage par confiance entre deux
reconnaisseurs, au déclencheur par densité, et au regroupement pour relecture. Revendiquer
en dépendance, pas seul.

### I-H — À venir : l'OCR guidé par la contradiction, et l'appariement global des libellés

Ces deux inventions ne sont pas encore faites. Elles sont décrites pour dater leur
conception.

**L'OCR guidé par la contradiction.** Le moteur désigne à l'OCR les seules zones à relire :

- une preuve qui ne ferme pas ;
- un identifiant dont la clé échoue ;
- une cellule déduite (la cellule porte déjà sa case, `case`).

La relecture se fait avec l'autre modèle ou à une autre échelle. L'OCR ne lit plus la
page entière : il relit la contradiction.

**L'appariement global des libellés aux valeurs.** C'est un couplage un-à-un, contraint
par le type, l'ordre de lecture et la cohérence avec les sommes prouvées. Il remplace le
voisin immédiat. Il doit rendre leur preuve aux mises en page dont étiquettes et valeurs
sont décalées d'une rangée (type MyTek).

## 4. Revendication de système (projet)

Système de lecture de documents comptables comprenant :

- un reconnaisseur de caractères sur processeur général ;
- un référentiel versionné décrivant, par type de document, une grille de champs (repères
  multilingues, rôle de partie, format, domaine de valeurs) et des preuves (sommes, taux,
  charges d'assiette, lettres, ordre, identité des parties) ;
- un moteur de contraintes qui ne rend une valeur que si elle est prouvée ou lue sous
  les invariants I-A à I-F, et qui rend une abstention motivée dans tout autre cas ;
- l'absence de tout modèle appris dans la décision de chaque valeur.

## 5. Antériorités repérées (recherche rapide, INCERTAINE)

- _Neurosymbolic Information Extraction from Transactional Documents_, arXiv 2512.09666
  (décembre 2025) : vérification arithmétique des extractions par un composant
  symbolique. À comparer à la preuve par contraintes et aux invariants ci-dessus.
- Continia Document Capture : identification du fournisseur par ses identifiants
  d'entreprise (n° de TVA, IBAN) connus. Elle diffère de I-B, qui traite un tiers inconnu
  par exclusion de l'identité du titulaire et grappe légale.
- US 11 798 301 : données synthétiques pour l'extraction des lignes de facture.
- L'identification de l'écriture par mot dans l'OCR multilingue (voir I-G).

À chercher par le conseil :

- couplage ordonné d'en-tête de tableau et couloirs blancs (I-E) ;
- côté d'un libellé dans les documents bidirectionnels (I-A) ;
- domaines de valeurs multilingues dans l'extraction (I-D).

## 6. Ce qui reste à faire avant dépôt

1. Une recherche d'antériorité professionnelle, puis le choix des inventions à déposer.
   Les plus fortes à ce jour : I-B, I-E, I-A, puis I-H une fois faite.
2. Garder le secret jusqu'au dépôt : ni démonstration publique, ni code public.
3. Les mesures sur des pièces réelles (le banc a une pièce réelle, MyTek) : elles
   renforcent les effets techniques revendiqués.
