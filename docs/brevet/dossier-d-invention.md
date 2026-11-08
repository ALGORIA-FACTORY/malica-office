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

### I-I — La pente de la page lue sur ses propres boîtes, et les rangées par recouvrement

**Problème.** Sur une page photographiée de travers, une ligne d'articles dérive de plus
d'une hauteur de corps entre sa marge et son montant. Le montant ne recouvre plus la
référence, la ligne se coupe en deux et le tableau n'est pas lu (MyTek : 5 articles sur 5
perdus). Une désignation sur deux lignes, chiffres centrés entre elles, perdait sa première
ligne au profit de l'article précédent.

**Ce qui est nouveau.**

- La pente se lit sur les seules boîtes de l'OCR, sans redresser l'image :
  - deux boîtes éloignées en abscisse, dont l'écart vertical tient dans une hauteur de
    corps, votent pour leur pente dy/dx ;
  - la classe la plus peuplée de l'histogramme est la pente ;
  - les vraies paires s'accumulent dans une même classe, les fausses s'étalent.
- Le vote se fait par boîte, pas par mot. Les jetons de mêmes bords (au bit près) sont
  recousus tant que le blanc qui les sépare tient dans deux hauteurs de corps : ce sont
  les mots d'une même ligne de l'OCR. Des cellules de PDF séparées par un large blanc
  restent distinctes et votent pour une page droite.
- Une pente que sa pente miroir égale presque est rejetée. Sur une page droite, deux
  rangées voisines votent autant pour +p que pour −p : c'est leur écart, pas une
  inclinaison.
- Les rangées sont les classes de la relation « se recouvrent de plus de la moitié de la
  plus petite hauteur », de proche en proche, sur les ordonnées redressées. Aucun jeton
  n'est l'ancre, et une cellule à deux lignes de chiffres centrés reste une seule rangée.
- Une désignation se lit ligne par ligne. Une rangée de texte juste au-dessus en est la
  tête si elle rapproche le milieu du texte du milieu des chiffres.
- Un bloc posé à côté du tableau n'en fait pas partie (« MATRICULE FISCAL » d'une colonne
  latérale) :
  - les colonnes extrêmes sont bornées par le plus large couloir blanc jusqu'au bord ;
  - sans en-tête, seuls les mots qui tiennent dans l'étendue de la ligne principale la
    prolongent.

**Effet mesuré** (412 pièces, même cache OCR) :

|       | justes | faux |
| ----- | -----: | ---: |
| Avant |  4 842 |   84 |
| Après |  5 114 |   74 |

- Aucun champ n'est passé de juste à faux.
- MyTek : les cinq articles, leurs taux et leurs désignations sont prouvés.
- Couche de texte des jeux du dirigeant : lignes prouvées de 84 à 91.

**Projet de revendication 6.** Procédé de regroupement en rangées des jetons d'un document
reconnu, dans lequel :

- une pente est estimée par le mode d'un histogramme des pentes de paires de boîtes de
  reconnaissance éloignées horizontalement et voisines verticalement ;
- les boîtes de bords identiques sont fusionnées en deçà d'un blanc proportionnel à leur
  hauteur ;
- une pente est rejetée quand la classe de la pente opposée réunit au moins la moitié de
  ses votes ;
- les rangées sont les composantes connexes de la relation de recouvrement vertical sur
  les ordonnées corrigées de cette pente.

**Antériorité probable.** Le redressement par projection de profils ou par transformée de
Hough est classique, mais il opère sur les pixels. La nouveauté éventuelle tient :

- au vote sur les boîtes déjà reconnues ;
- à la fusion des boîtes de mêmes bords ;
- au rejet par la pente miroir ;
- aux rangées par composantes connexes sans ancre.

### I-J — Un texte qu'aucun calcul ne prouve se lit avec assurance, ou se tait

**Problème.** Les chiffres d'une ligne sont prouvés par q × p = m et par le total. Sa
désignation ne l'est par rien. Sur le banc, toutes les désignations dont un mot était lu
à moins de 0,9 étaient fausses (7 sur 7). Toutes les justes dépassaient 0,95.

**Ce qui est nouveau.**

- Une valeur PROUVÉE se rend quelle que soit la confiance de l'OCR, car c'est
  l'arithmétique qui la garantit.
- Une valeur NON PROUVABLE se rend seulement si chacun de ses jetons dépasse un seuil de
  confiance, `lecture.confiance_du_texte` : un paramètre daté du référentiel.
- Sinon, elle est tue, et la ligne et ses chiffres restent.

**Effet mesuré.** Les 4 désignations arabes mal lues de la pièce 087 sont tues, et 2 autres
désignations fausses aussi. Aucune juste n'est perdue.

### I-L — Une valeur affirmée, ou une piste : la frontière que le moteur ne franchit pas

**Problème.** Un moteur qui rend une valeur sans preuve suffisante produit une erreur
plausible, la pire. Au banc du 4 novembre 2026, 73 valeurs fausses et 16 inventées étaient
rendues comme lues.

**Ce qui est nouveau.** Chaque valeur porte un statut : `prouve` (l'arithmétique),
`conforme` (un format et un libellé qui la désigne seule), `signale` (une piste, montrée,
jamais affirmée), `absent`. Les règles qui font passer une valeur de l'affirmé à la piste
sont générales et ne dépendent d'aucun modèle :

1. **Ancrage.** Une date ou un identifiant n'est conforme que si un libellé du champ le
   désigne, à travers les séparateurs, dans le sens que donne le deux-points, et pour un
   libellé de plusieurs mots, mot pour mot.
2. **Partie.** Le champ d'une partie dont le libellé précède plusieurs valeurs sur la page
   est une piste : le libellé ne dit pas de qui.
3. **Assurance.** Une valeur non garantie par un calcul ou par un domaine fermé est une
   piste si un de ses jetons est douteux : sous le seuil de confiance daté du référentiel,
   ou douteux pour le lexique (point 4).
4. **Doute lexical sans modèle.** Un mot est douteux s'il perd la lettre de son élision,
   s'il met une lettre à la place d'un chiffre dans un petit nombre, s'il est inconnu des
   dictionnaires Hunspell et des listes de mots, ou s'il le devient par une confusion
   classique de l'OCR (l↔i, o↔0, rn↔m, c↔e). Un sigle, un terme à casse mêlée, un composé de
   deux mots connus et une abréviation d'un mot connu ne le sont pas.
5. **Unicité du jeton.** Une valeur imprimée une fois n'est lue que pour un champ. Le champ
   en surnombre est absent, et les contraintes sont réévaluées : une preuve qui ne
   comparait un jeton qu'à lui-même tombe.
6. **Ventilation complète.** Une ventilation par taux n'est affirmée que complète. La part
   exonérée d'une exonération partielle en est une instance, nommée par un taux nul du
   référentiel et vérifiée par la somme des lignes sans taux.
7. **Texte entier.** Un texte non prouvé n'est rendu qu'entier : pas coupé par la borne de
   mots, ni par une cellule trop étroite, ni suivi d'une rangée qui peut en être la suite.

**Effet mesuré.** Mêmes 412 pièces, même OCR : 74 faux et 16 inventés → 0 et 0. 338 pistes
signalées. Un champ juste perdu, qui n'était prouvé que par une preuve sans contenu.

### I-M — L'appariement global d'une colonne de libellés par l'ordre

**Problème.** Le libellé d'un total se cherche sur son voisin. Une pièce photographiée
dont la colonne des montants a glissé d'une demi-rangée met chaque libellé à côté de la
valeur suivante : le TTC à côté du « Total avec timbre ». La preuve arithmétique tient,
mais le HT ne « porte pas son libellé » et la pièce est rendue muette.

**Ce qui est nouveau.**

- Les libellés se reconnaissent en colonne : des suites de mots de même taille, alignées
  à gauche et serrées, dont la majorité finit par « : ». Les bords de la colonne sont des
  libellés à « : ».
- L'ordre vertical se conserve même quand la géométrie glisse. Le i-ème libellé va à la
  i-ème valeur de la suite consécutive de montants imprimés, à sa droite et dans sa
  hauteur, la plus proche rangée par rangée. Les suites presque aussi proches comptent
  toutes, puisque le sens du glissement est inconnu.
- L'appariement ne prouve rien. Il dit seulement qu'une valeur établie par l'arithmétique
  porte bien son libellé, et il restreint les valeurs qu'un champ peut prendre.

**Effet mesuré.** Cinq factures prouvées justes, sans faux nouveau.

### I-N — Une charge proportionnelle annoncée par son taux imprimé

**Problème.** Une charge facultative (le FODEC) n'est cherchée que si son libellé est lu.
Si le libellé est perdu, la base de TVA (HT + FODEC) est prise pour le HT.

**Ce qui est nouveau.** Le taux de la charge, tiré du référentiel daté, imprimé sur une
rangée qui porte un montant et AUCUN mot, l'annonce aussi. Un mot sur la rangée (« Retenue
à la source 1 % ») nomme autre chose au même taux et n'annonce rien.

**Effet mesuré.** Quatre factures prouvées justes, FODEC compris, sans faux nouveau.

### I-O — Le cachet vu sans modèle, et attribué par la grille

**Problème.** La présence d'un cachet décide de la valeur probante d'une pièce. Un
modèle de vision le voit, mais il coûte et il se trompe sans le dire. L'OCR ne le voit pas.

**Ce qui est nouveau.**

- Le cachet se reconnaît sans modèle, par trois propriétés physiques de l'encre : sa
  couleur (saturée, ni noire ni grise), sa compacité (ni trait ni ligne de texte) et son
  creux (un anneau ou un cadre porte peu d'encre pour sa boîte).
- Le détecteur est réglé pour ne rien rendre plutôt que se tromper : une photocopie, qui
  grise le cachet, n'est pas vue.
- Le cachet n'est attribué qu'à un champ que la grille déclare l'attendre
  (`ref.grille_champs.marque`), et seulement si ce champ est le seul à l'attendre. Une
  marque ne dit pas de quelle partie elle est ; la grille le dit, ou rien n'est affirmé.

**Effet mesuré.** 26 cachets justes sur le banc, aucun inventé. Hors banc : 41 sur 81
cachets trouvés, 0 faux sur 80 pièces sans cachet.

### I-P — L'OCR guidé par la contradiction : relire les seules cellules d'un tableau qui ne ferme pas

**Problème.** Sur une photo ou un scan, un chiffre mal lu dans une cellule (« 71.950 » pour
« 73.950 », « T » pour « 1 ») suffit pour que la somme des lignes ne ferme pas. Relire la
page entière coûte toute la lecture et rend souvent la même erreur, parce que le modèle
voit la cellule dans le même contexte.

**Ce qui est nouveau.**

- La contradiction désigne la zone. La relecture ne se demande que si les totaux de la
  pièce sont prouvés et que ses lignes ne ferment pas. Elle ne vise que les cellules des
  rangées d'articles : les rangées au-dessus du total qui portent au moins deux montants
  décimaux, moins la rangée du total. Les cellules relues sont courtes (au plus 12 signes)
  et portent un chiffre, ou ont au plus 2 signes.
- Chaque cellule est découpée seule, avec une marge réglable (`OCR_RELECTURE_MARGE`), et
  reconnue hors de sa ligne (`POST /relire`).
- Une relecture ne remplace un jeton que si son texte diffère et que sa confiance est plus
  haute. Le moteur déterministe juge ensuite, une seconde fois : une relecture fausse ne
  ferme pas la somme et ne devient rien.

**Effet mesuré** (412 pièces) : 18 cellules de lignes deviennent justes (a028, s032).
Aucun champ juste n'est perdu ; 0 faux et 0 inventé avant comme après.

**Limites, dites.**

- Seul le banc l'emploie ; le pipeline de production ne l'appelle pas encore.
- Seules les pièces image sont relues ; les PDF ne le sont pas.
- Une lecture mal rangée (désignation et chiffres d'un article sur deux rangées visuelles)
  ne se corrige pas en relisant. C'est un défaut de structure du tableau, traité à part.

### I-Q — Le tableau prouvé qui tait la cellule perdue : la rangée partielle

**Problème.** Sur une photo ou un scan, l'OCR perd un petit nombre isolé (la quantité
« 1 »). Si la quantité ne peut pas se déduire (un tableau à remise), la rangée bloque, et
TOUT le tableau se tait — des dizaines de cellules lues justes avec elle.

**Ce qui est nouveau.**

- Une rangée dont le montant est lu, et qui porte un nombre dans la colonne des
  quantités ou un prix, reste une ligne du tableau même si elle ne ferme pas seule. La
  somme EXACTE des montants au total prouvé est sa preuve.
- La cellule perdue est tue : la sortie l'omet, elle n'est ni lue ni déduite. Le prix
  n'est rendu que si une quantité entière le ferme avec le montant (une lecture fausse
  du prix ne ferme presque jamais) ; la quantité absente, jamais.
- Un tableau qui porte une rangée partielle ou une remise lue renonce à toute déduction
  et se relit sans elle : la cause du silence (une remise perdue) pourrait fausser une
  cellule déduite ailleurs.
- La même règle de fermeture (prix HT, ou TTC au seul taux imprimé) sert la stratégie
  rangée par rangée et la lecture du milieu.

**Effet mesuré** (412 pièces) : 5 472 → 5 936 champs justes, 0 faux, 0 inventé.

### I-R — Ce qui n'est pas la désignation : le repère d'un autre champ de la ligne

**Problème.** La cellule d'une désignation porte souvent d'autres champs de la ligne : un
numéro de série, une référence. Lue d'un bloc, la désignation est fausse.

**Ce qui est nouveau.** Une ligne de texte de la cellule qui commence par le repère d'un
AUTRE champ de la parcelle des lignes (lu dans la grille, `ref.grille_champs`), suivi
d'une valeur chiffrée ou de rien, n'est pas la suite de la désignation. Un mot qui ne
fait que commencer comme un repère court (« U-shaped ») reste dans la désignation. Deux
mots d'une même ligne de texte ne se recouvrent pas : un jeton posé sur un mot vient
d'une autre ligne.

### I-S — Le caractère le moins sûr d'un mot, et non la moyenne de sa ligne

**Problème.** L'OCR rend une confiance par ligne, moyenne des probabilités de ses
caractères. Un mot sous une tache s'y noie : « sans fil » lu « sans fi », la ligne à 0,98,
le i à 0,69. Une seconde lecture par le même modèle redit l'erreur.

**Ce qui est nouveau.** Le décodeur de la reconnaissance garde la probabilité de chaque
caractère, sans changer le texte rendu. Chaque mot porte celle de son caractère le moins
sûr. Sous un seuil daté du référentiel (`lecture.confiance_du_caractere`), le mot est
incertain : un texte qu'aucun calcul ne prouve (une désignation, un nom) qui le porte
n'est pas rendu, ou il est signalé.

**Effet mesuré.** Les deux désignations fausses de la mesure se taisent ; 15 justes sur
162 aussi (le prix de la règle).

### I-T — Le sens déclaré par la personne, vérifié par la pièce, et le tiers par le matricule de celui qui scanne

**Problème.** Une facture ne dit pas toujours qui l'émet : achat ou vente, le lecteur doit
le deviner, et une erreur échange fournisseur et client — donc l'écriture comptable.

**Ce qui est nouveau.**

- Le sens est une DONNÉE de la personne (déclarée à la capture, corrigeable après), pas
  une conclusion du lecteur. Le matricule de celui qui scanne, connu de sa fiche, place le
  dossier ; l'autre matricule de la pièce est le tiers.
- La pièce vérifie la déclaration : des indices unanimes contre elle (étiquettes du
  client, grappe légale de l'émetteur) la font signaler au lieu de la recopier.
- Le matricule du tiers n'est affirmé que corroboré (texte exact, deux occurrences, tiers
  connu, chaque caractère lu avec assurance) ; deux lectures à un chiffre près se
  contredisent et rien n'est affirmé.

**Effet mesuré** (412 pièces, sens déclaré) : 6 052 champs justes, 0 faux ; sens des
parties 193 justes sur 348, aucune pièce échangée.

### I-U — Le redressement à la pente locale d'une page gauchie

**Problème.** Une photo de page courbée n'a pas une pente, mais une pente qui varie du haut
en bas. Une seule pente estimée (ou nulle, faute d'accord) coupe les rangées.

**Ce qui est nouveau.** Chaque jeton se redresse à la pente que votent les paires de jetons
voisines en hauteur (fenêtre paramétrée), retenue par le même pic d'accord que la pente de
la page ; la pente de la page n'est qu'un repli. Aucune transformation de l'image, aucun
modèle.

**Effet mesuré** (412 pièces, sens déclaré) : 6 495 champs justes contre 6 410, 0 faux,
0 inventé.

### I-K — La lecture en deux temps : le tableau d'abord, rien de sauté

**Problème.** La preuve a besoin du tableau et des totaux. Les longues mentions servent à
d'autres champs : matricules, montant en lettres, mode de règlement. Tout lire avant de
prouver fait attendre la preuve. Sauter le reste quand les totaux ferment perdait 243
champs justes (mesuré).

**Ce qui est nouveau.**

- La page est détectée une fois. La géométrie seule désigne le premier temps : les rangées
  d'au moins quatre boîtes, du premier au dernier rang, et les boîtes courtes.
- Ces boîtes sont reconnues d'abord et rendues aussitôt, dans un flux (une ligne JSON par
  temps). Le moteur de preuve, déterministe, les juge pendant que le reste se lit.
- Le second temps est la lecture complète, relue en arabe là où il le faut. Elle est
  identique à celle du pipeline d'un seul tenant, et c'est la seule que l'API garde.
- Le service fait lui-même les gestes du pipeline (détecter, trier, découper, reconnaître),
  avec ses modules et ses réglages lus dans sa configuration, jamais recopiés.

**Effet mesuré** (412 pièces, OCR frais, deux processeurs) :

- 78 pièces sont prouvées dès le tableau, en 1,8 s médianes.
- La lecture complète passe de 4,5 s à 3,9 s médianes. Le gain vient surtout de l'image
  contiguë : OpenCV recopiait l'image entière à chaque découpe de ligne.
- 5 116 champs justes contre 5 114, 73 faux contre 74 : aucun champ perdu, aucun nouveau
  faux.

### I-H — À venir : l'OCR guidé par la contradiction, et l'appariement global des libellés

L'appariement global est fait (I-M). L'OCR guidé par la contradiction est fait pour les
cellules d'un tableau qui ne ferme pas (I-P). La relecture d'un identifiant dont la clé
échoue reste à faire.

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
   Les plus fortes à ce jour : I-B, I-E, I-I, I-A, puis I-H une fois faite.
2. Garder le secret jusqu'au dépôt : ni démonstration publique, ni code public.
3. Les mesures sur des pièces réelles (le banc a une pièce réelle, MyTek) : elles
   renforcent les effets techniques revendiqués.
