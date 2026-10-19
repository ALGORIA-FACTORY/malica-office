# Ce qui reste ouvert, et qui doit remonter à Wissem

Ce document se tient **pendant** la livraison, pas après. Chaque ligne y entre
le jour où elle est trouvée, avec ce qu'elle coûte si on l'oublie. Il n'y a
aucune ligne ici qui soit « en cours » : ce qui est en cours est dans le
registre de l'atelier.

Trois familles, et elles ne se traitent pas de la même façon :

- **un arbitrage commercial** — j'ai tranché pour ne pas arrêter le travail,
  et c'est Wissem qui décide en dernier ;
- **une dette technique datée** — le défaut est connu, borné, et attend sa
  tâche ;
- **une donnée de mise en service** — rien à coder, quelque chose à saisir.

---

## Les arbitrages commerciaux, tranchés par défaut, à confirmer

### A-1 · La lecture d'un expert-comptable se compte sur la licence du client

_Trouvé le 17 octobre, ronde 4 de la tâche 0._

Un expert de cabinet engagé qui lit une pièce `partage` recevait le feu vert,
puis l'inscription de sa lecture échouait. Dès que le compteur sera branché sur
la lecture, chacune de ces lectures serait **payée et jamais comptée**.

**Tranché :** elle se compte sur la licence **du client**. Le cabinet travaille
pour le client, et le client paie ses propres pièces — quel que soit celui qui
déclenche la lecture. C'est déjà ce que la base répondait au verdict ; la
politique d'écriture dit maintenant la même chose.

**L'autre branche**, si Wissem la préfère : refuser la lecture à l'expert. Elle
casse la promesse du produit — le cabinet ne pourrait plus lire ce qu'on lui
partage. Une troisième existe : un forfait propre au cabinet. Elle demande une
offre, pas une migration.

**Se renverse** par une politique, sans toucher aux données.

**La réserve qui vient avec, et elle est juste.** Le client ne choisit ni qui
lit, ni combien. Un cabinet qui tient trente dossiers consomme des forfaits sans
que le titulaire le voie passer. L'arbitrage reste tenable — c'est le client qui
tire le bénéfice de la lecture de ses propres pièces —, mais il demande une
contrepartie : **le client doit voir qui a consommé ses lectures.** Une colonne
« consommée par », lisible côté client. Ce n'est pas une décision à prendre,
c'est un affichage à poser, et il conditionne l'honnêteté de A-1.

La seule branche qui donne un vrai contrôle au payeur est la troisième : un
forfait propre au cabinet. Elle demande une offre.

### A-3 · Un membre d'un cabinet engagé vaut l'expert, quel que soit son rôle

_Trouvé le 17 octobre, relecture de la ronde 5._ La porte d'accès du dépôt ne
distingue pas les rôles au sein d'un cabinet : un collaborateur du cabinet lit et
compte comme l'expert-comptable.

**Tranché :** accepté. C'est le modèle de tout le dépôt, et en faire une
exception à cet endroit serait une règle locale que personne ne retrouverait.
Si Wissem veut que seul l'expert consomme le forfait du client, c'est une
distinction à poser **partout**, pas ici.

### A-2 · Un opérateur de plateforme sous réquisition reste bloqué par le plafond du client

_Trouvé le 17 octobre, même ronde._

**Tranché :** on n'y touche pas. C'est fermé, donc sans danger, et une
réquisition est rare. Une porte fermée qu'on ouvrira le jour où l'on connaîtra
son prix vaut mieux qu'une porte ouverte aujourd'hui.

**À rouvrir** si une réquisition doit pouvoir lire chez un client au plafond —
auquel cas il faudra dire **qui paie** cette lecture, et ce n'est pas une
question technique.

---

## Les dettes techniques datées

### D-1 · Onze tables de `capture` acceptent une imputation forgée

_Trouvé le 17 octobre, ronde 4._ Elles portent un `tenant_id` et un `piece_id`
que nulle politique ne lie entre eux. Une ligne peut donc désigner la pièce d'un
autre dossier.

**Pourquoi ce n'est pas urgent, et pourquoi ce n'est pas rien :** aucune de ces
onze n'est lue comme **preuve d'un droit**. C'est exactement ce qui distinguait
`facturation.lectures`, où le même défaut permettait de contourner le plafond et
de dépenser le quota d'un tiers. Ici, l'imputation forgée est invisible et sans
effet. À refermer avant la première facture adressée à un tiers.

### D-2 · Aucun garde ne refuse une fonction privilégiée sans porte nommée

_Trouvé le 17 octobre, relecture de la ronde 3._ Le dépôt refuse désormais
toute **vue** accordée à `authenticated` qui contourne l'isolation, et toute
fonction privilégiée sans `search_path` fixé, avec un droit d'exécution trop
large, ou qui écrit dans la facturation sans porte de plateforme.

Ce qu'il ne refuse pas : une fonction privilégiée dont le **corps** ne porte
aucune porte d'autorisation. C'est le garde le plus utile des quatre, et c'est
pourquoi il n'a pas été écrit dans une ronde de correction : il demande une
liste blanche de soixante fonctions, et une liste blanche qu'on n'a pas examinée
une par une est un garde qui ment.

**Ce qu'il coûte en attendant :** les soixante fonctions ont toutes leur
`search_path` et aucune n'écrit dans la facturation. Le trou est celui de la
PROCHAINE élévation de droits, pas d'une existante.

### D-3 · Les trois reçus déjà en base gardent leur classement en vente

_Trouvé le 13 octobre._ Déposés puis envoyés à la lecture comme n'importe quelle
photo, ils en revenaient classés `facture_vente` — et un reçu compté comme une
vente **double le chiffre d'affaires**. La cause est corrigée à deux étages. Les
trois lignes déjà écrites, elles, ne se réécrivent pas (R7) : il faut une
précision, pas une correction.

### D-4 · `facturation.emettre` refuse une licence sans organisation rattachée

_Trouvé le 17 octobre, à l'entrée de la livraison._ La contrainte de la table
exige le rattachement ; l'émission ne le vérifie pas avant d'essayer. Le message
rendu n'aide pas à comprendre.

### D-5 · Une offre antérieure au 17 octobre rend « licence introuvable »

_Même jour._ Le référentiel des offres est daté du 17 octobre. Une licence dont
la date de début est antérieure ne trouve aucune offre en vigueur, et le message
parle d'une licence absente au lieu d'une offre absente. Un message faux sur la
cause est plus coûteux qu'un message absent.

### D-6 · Les fonctions privilégiées appartiennent à `postgres`, donc elles traversent les politiques

_Trouvé le 17 octobre, ronde 6 de la tâche 0, et c'est la plus grosse dette de
la journée._

Une fonction `security definer` s'exécute avec les droits de son propriétaire.
Tant que ce propriétaire est `postgres`, qui traverse toutes les politiques
d'isolation, **une fonction privilégiée qui écrit une table de tenant contourne
la politique au lieu de s'y soumettre**.

Ce n'est pas un trou ouvert aujourd'hui : la seule écrivante de la table des
lectures tient ses garanties **par construction** — le tenant est lu sur la
pièce, la licence sur le rattachement de ce tenant, la pièce est l'argument, et
aucune valeur ne vient de l'appelant. Et la politique reste en place, exercée
par trois épreuves qui se rendent le droit d'écrire dans une transaction
annulée.

**Ce qu'il faut faire, et pourquoi c'est structurel :** donner à ces fonctions
un propriétaire qui n'est **pas** superutilisateur. La politique redeviendrait
alors opposable à la fonction elle-même, et les garanties ne reposeraient plus
sur la discipline de qui l'écrit. Cela porte sur le dépôt entier, pas sur cette
livraison : le traiter dans une ronde de correction le ferait mal.

**Ce qu'il coûte en attendant :** la prochaine fonction privilégiée naît avec le
même défaut. C'est pour cela que c'est écrit, et daté.

### D-7 · Un garde d'architecture s'est affaibli en même temps qu'il a servi

_Même ronde._ Le garde refuse, pour toute fonction privilégiée exécutable par
un utilisateur connecté, l'absence de `search_path` fixé, un droit d'exécution
trop large, et l'écriture dans la facturation sans porte de plateforme.

Ce dernier point est devenu faux le jour même : la seule écrivante légitime de
la facturation a pour porte l'autorisation de lire la pièce, pas la plateforme.
Le garde est donc passé de « sans porte de plateforme » à « sans porte
**nommée** », la liste des portes étant énumérable. C'est un affaiblissement
réel, et il est dit ici plutôt que caché derrière un garde qu'on croirait
intact.

Il se recoupe avec **D-2** : le même travail les ferme tous les deux.

### A-4 · Un dépassement d'une ou deux lectures à la frontière du forfait est accepté

_Trouvé le 17 octobre, tâche 2._ Trois chemins mènent au même endroit : deux
pièces lues en parallèle à 64 lectures sur 65 passent toutes deux l'autorisation
et paient le modèle ; deux instances du serveur sur la même pièce paient deux
fois ; un processus qui meurt entre l'écriture du résultat et le comptage offre
la lecture.

**Tranché : la tolérance est assumée.** La seule façon de fermer ces trois-là
serait de **réserver** la lecture avant d'en connaître le résultat — ce qui
contredit la règle qui gouverne tout ce travail : _une lecture qui échoue ne se
facture pas, parce que le client n'a rien reçu._

Un client peut donc consommer une ou deux lectures de plus que son forfait, à la
frontière. Je préfère cela à un client facturé pour un échec. **C'est un
arbitrage de prix**, et il revient à Wissem : si le dépassement doit être
impossible, il faut accepter qu'une lecture ratée soit parfois comptée, et le
dire aux clients.

### D-8 · Une seconde lecture d'une pièce ne peut pas s'écrire, alors que R7 dit qu'elle devrait

_Trouvé le 17 octobre, tâche 2._ Une pièce déjà lue obtient bien le droit d'être
relue **gratuitement** — c'est voulu, une relecture ne doit pas coûter une
lecture au client. Mais l'écriture du second résultat est refusée, et le modèle
avait déjà été payé.

Le refus arrive maintenant **avant** la dépense, avec son propre motif : plus
personne ne paie pour rien. Mais ce n'est que la moitié de la réponse.

**La vraie réponse, et elle est différée :** R7 dit qu'une correction est une
écriture **nouvelle**. Une seconde lecture d'une pièce est un fait nouveau,
daté, et devrait pouvoir s'ajouter à côté du premier — c'est donc la
persistance qui est trop stricte, pas la relecture qui est illégitime.

**Pourquoi ce n'est pas fait ici :** cela touche la chaîne de lecture, donc R2,
et R2 ne se modifie pas dans une ronde de correction. Le jour où une pièce mal
lue devra être relue — et ce jour viendra, c'est le cœur du produit —, c'est
cette dette qu'il faudra payer.

---

## Les données de mise en service

### M-1 · Une ligne d'émetteur doit exister avant la première facture

_Trouvé le 17 octobre._ Sans une ligne dans `facturation.emetteurs`, aucune
facture ne peut être émise. Ce n'est pas un défaut de code : c'est une saisie à
faire le jour de la mise en service, et elle n'est écrite nulle part ailleurs.

### M-2 · La fiche de l'organisation d'essai porte un matricule invalide

_Trouvé le 5 octobre, toujours vrai._ La fiche du staging porte sept chiffres
**sans la lettre de clé** — ce n'est pas un matricule tunisien valide, et la
saisie l'a accepté. C'est ce qui a produit le rejet « matricule différent » sur
une facture pourtant bien lue : le contrôle avait raison, la fiche avait tort.

Deux choses à faire, et elles sont distinctes : corriger la fiche, et **refuser
la saisie** d'un matricule qui n'a pas la forme attendue.

---

## La chaîne de lecture, après la correction de l'amputation (18 octobre)

### L-1 · Un code de drapeau que l'écran ne sait pas encore nommer

`MONTANT_PEUT_ETRE_AMPUTE` est émis par la chaîne depuis le 18 octobre.
`apps/web/src/lib/champ-lisible.ts` porte la table des codes traduits ; il n'y
est pas, donc l'écran le rend par le libellé générique `cab.code.autre`. Ce
n'est pas un blocage — le montant est `null`, la pièce est partielle, rien ne
s'écrit — mais la personne lit « autre » là où il faudrait lire « ce montant
semble coupé en deux, confirmez-le ». `ARITHMETIQUE_INCOHERENTE` manque à la
même table, depuis le 5 octobre.

Non fait ici parce que `apps/web/` est tenu par un autre agent.

### L-2 · Le TEXTE tronqué n'a toujours aucun garde

« MEUBLES » pour MEUBLES EL AMEN, mesuré deux fois le 18 octobre. Le garde posé
porte sur les montants : il se décide sur la forme d'un nombre. Un mot collé à
un mot n'a aucune forme particulière, et un garde qui refuserait tout texte
ayant un voisin collé refuserait tous les textes. Il faudrait un autre
dispositif — le banc le verrouille comme trou ouvert
(`factures.banc-amputation.test.ts`), il ne le referme pas.

### L-3 · Le plafond des bandes est posé à deux, sans mesure

`BANDES_MAX` passe de 4 à 2 le 18 octobre, parce que le chemin des bandes
devient atteignable pour la première fois (voir `withRetry`) et qu'il n'avait
donc jamais coûté un centime. Le pire par page passe de SEPT appels de relevé
payants à TROIS. Ce que cela perd — la page si dense que deux bandes ne
suffisent pas — n'a jamais été mesuré, puisque le chemin ne tournait pas.
Remonter à quatre est une ligne, le jour où une pièce réelle le demande.

**Arbitrage commercial non tranché** : trois appels de relevé par page est un
plafond, pas un choix de produit. Personne n'a dit ce qu'une pièce a le droit
de coûter.

---

## La fabrique de lecteurs — socle de données (18 octobre)

### F-1 · Les trois seuils de promotion sont des opinions livrées, pas un relevé

`ref.socle_params` porte depuis le 18 octobre
`fabrique.seuil.promotion.min.exactitude_champs_critiques` = 0,98,
`…max.montants_faux_acceptes` = 0 et `…max.taux_abstention` = 0,25. Une recette
ne devient `active` qu'en les franchissant, et le déclencheur le refuse sinon.

**Aucune des trois valeurs ne vient d'une mesure.** Zéro montant faux accepté
est une position défendable (un montant faux accepté est précisément ce que la
fabrique existe pour éviter) ; 0,98 et 0,25 sont des points de départ. Ils se
changent sans déploiement, par organisation, dans
`parametrage.fabrique_seuils` — c'est R10, et c'est pour cela qu'on a pu les
livrer sans attendre.

**Arbitrage non tranché** : à partir de quel taux d'abstention une recette
coûte plus cher qu'elle ne rapporte ? La réponse dépend du prix d'un appel de
désignation (3 s, une fraction des 0,0035 $ mesurés) et de ce qu'une relecture
humaine coûte au cabinet. Personne ne l'a chiffré.

### F-2 · `ancre_texte_min` = 3 n'a pas été mesuré sur un corpus arabe

La borne vient du spécialiste du langage de recettes, qui la donne comme valeur
d'épreuve et non comme recommandation. Sur une facture arabe, une mention de
deux ou trois caractères peut porter le sens là où trois caractères latins sont
souvent du bruit. Tant qu'on n'aura pas compté les ancres réellement retenues
sur un corpus arabe, cette borne est une opinion.

Livrée à 3, visible dans `ref.socle_params`
(`fabrique.seuil.recette.ancre_texte_min`), surchargeable par cabinet sans
migration. Les quatre autres bornes — `selecteurs_max` 200, `champs_max` 50,
`jetons_max` 12, `rang_max` 50 — sont des garde-fous de volume, et leur valeur
exacte importe moins.

### F-3 · Qui a le droit de promouvoir une recette

La politique d'écriture de `fabrique.promotions` réserve la décision au
`dirigeant` et à l'`expert` ; un `collaborateur` et un `assistant` ne
promeuvent pas. Tranché par défaut pour ne pas s'arrêter : une promotion change
la façon dont les pièces du cabinet seront lues, et c'est une responsabilité
d'expert. Si le dirigeant veut ouvrir cela au collaborateur, c'est une ligne de
migration.

### F-4 · La mutualisation des structures entre cabinets

`fabrique.recettes.portee` nomme déjà le périmètre (`organisation` ou
`mutualisee`) et la colonne n'a **aucun défaut** : un partage ne peut pas
naître d'une insertion distraite. Mais **aucune politique ne lit cette
colonne** : marquer une recette `mutualisee` aujourd'hui ne la montre à
personne, et l'épreuve le vérifie.

Ce qui reste à décider n'est pas technique : qui possède une structure de
lecture apprise sur les factures d'un client, ce qu'un cabinet accepte de
donner à voir de ses fournisseurs, et ce que Malica a le droit de reverser au
pot commun. Tant que cela n'est pas tranché, le partage reste éteint.

### F-5 · Le corpus réel manque pour répondre à la question qui compte

« Une recette générée puis évaluée lit-elle une vraie facture aussi bien que
le modèle ? » reste **sans réponse**, et le blocage n'est pas le coût d'un
appel : c'est le **corpus**.

`src/malica/lecture/jeu-d-or.ts` porte **une seule** facture réelle avec sa
vérité terrain. Or le générateur refuse — et doit refuser — de travailler sur
un exemple unique : à un, l'ossature porte le nom du client. Il faut donc
**deux pièces réelles du même format**, avec leur plan de jetons et leur
désignation attendue, pour que la question soit seulement posable.

Une fois le deuxième cas réel inscrit au jeu d'or, la mesure est gratuite du
côté lecture — le plan de jetons et la désignation attendue sont déjà là, et
l'interprétation n'appelle personne. Seule la génération coûte, et elle se
joue par `tests/real/fabriquer-une-recette.ts`.

Ce qui reste à trancher est d'exploitation, pas de code : qui fournit ces
pièces, et lesquelles.

### F-6 · Qui déclenche une génération, en production

Le parcours existe de bout en bout et s'éprouve, mais il est aujourd'hui
déclenché **à la main** (`tests/real/fabriquer-une-recette.ts`) ou par les
méthodes du dépôt, qu'aucun écran n'appelle encore.

Une génération dure des dizaines de secondes — c'est le raisonneur — et n'a
donc pas sa place dans une transaction ni dans l'attente de quelqu'un. La
forme juste est un **travail de la file durable** (`fabrique.travaux`), sur le
modèle de `lecture_piece` : une nature de travail de plus, et l'exécution qui
va avec. Ce n'est pas écrit, et c'est dit plutôt que deviné.

Reste à trancher, et ce n'est pas technique : **quand** Malica propose une
recette d'elle-même. Au bout de combien de pièces d'un même format ? Sur
décision de l'expert seulement ? Un déclenchement automatique dépense sans
qu'on le lui demande ; un déclenchement manuel suppose que l'expert sache
qu'un format revient.

#### F-6 · tranché le 19 octobre 2026 — sauf un point, plus étroit

Le déclenchement existe, et il a la forme annoncée ci-dessus : une nature de
travail de plus (`generation_recette`), une proposition en base
(`fabrique.generation_proposer`), l'exécution par le coureur. Le nombre est
tranché par R10 : **trois pièces distinctes d'un même format**, défaut livré
sous `fabrique.seuil.generation.pieces_min`, daté et surchargeable par cabinet
sans déploiement. Le raisonnement est dans l'en-tête de
`20261020180000_malica_propose_un_lecteur_au_troisieme_exemple.sql` et dans la
limite 6 de `docs/fabrique-de-lecteurs/02-ce-qui-est-livre.md`.

Ce qui reste ouvert, et qui n'est pas un arbitrage de code :

**Rien ne qualifie un exemple tout seul.** La proposition part d'un exemple
d'apprentissage inscrit, et aujourd'hui c'est un humain qui l'inscrit — par
`fabrique.qualifierUnExemple`, qu'un écran devra appeler à la validation d'une
pièce. Faire d'une désignation du modèle une vérité terrain **sans qu'un
humain l'ait validée** entraînerait le remplaçant sur la sortie de celui qu'il
remplace : c'est défendable, c'est bon marché, et c'est une décision de
qualité, pas d'orchestration. Elle n'est pas prise.

**Et un format qui a déjà un lecteur ne redemande rien.** Une recette suspendue
pour dérive ne redéclenche donc pas une génération d'elle-même : la
surveillance suspend, l'expert décide. C'est un défaut prudent — il évite de
payer en boucle sur un format qui dérive — mais il veut dire qu'une version
nouvelle reste un geste humain.
