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

## Inviter dans son dossier depuis l'application Android (tranché par défaut le 22 octobre 2026)

**Défaut retenu : l'invitation (`inviterSiege`, `inviterProprietaire`) se fait
sur le web et la PWA, pas dans l'application Android.** Relevé par la revue
Codex de la PR #64 : une invitation acceptée au-delà des places incluses
ajoute une place payée (`facturation.droits_v`, `prix_siege_sup`), ce qui est
un achat au sens des règles de Google Play. Le défaut le plus sûr ferme le geste
entier dans la coque, même quand la place est incluse.

**Tranché par le dirigeant le 23 octobre 2026 : oui.** L'invitation est rouverte
dans l'application pour les places incluses ; la base refuse à une coque la
place qui serait facturée, en comptant les places occupées et les invitations
en attente (`20261023120000`).

## Les experts de lecture non-montant (tranché par défaut le 16 novembre 2026)

Les experts lisent en observation : rien ne change dans la lecture retenue, sauf
une pièce dont les lettres contredisent les chiffres, qui n'est plus « prouvée »
mais « signalée » (`docs/sudoku/contrat-du-moteur.md`, §2 et §7). Défauts retenus,
à arrêter par le dirigeant ou l'expertise :

- **La lettre de contrôle du matricule avertit, ne bloque pas** (décision du
  1er novembre). Son algorithme (somme pondérée 7..1, modulo 23) est en base,
  `defaut_a_valider`, source `incertain` : la DGI ne le publie pas.
- **Les lettres doivent égaler le total au millime.** Une facture imprimée à deux
  décimales dont les lettres disent le millime (100/D-08) est signalée. Admettre
  la précision imprimée ferait passer une contradiction d'un centime.
- **Un numéro lu seulement derrière un libellé collé** (« N°FA-… », fréquent en
  OCR) est signalé, avec sa valeur citée, jamais conforme : 104 justes et 7 faux
  sur le banc OCR. Le passer conforme demande une seconde lecture (la chaîne,
  ou la relecture de nuit).
- **Deux matricules au même format** ne s'attribuent qu'à l'anneau 2 (E01) : hors
  E01, ils sont signalés. Avant, 21 matricules faux sortaient « conformes ».
- **« Réf. » n'est plus un repère du numéro de facture** : il nommait aussi la
  référence TTN et l'en-tête de la colonne des articles (3 numéros faux). Une
  facture réelle qui n'imprime que « Réf. » devant son numéro le verra absent.
- **Les présences (cachet, signature) ne se constatent pas dans un texte** : leur
  repère imprimé les signale, à vérifier sur l'image.

## Tranché par Wissem le 2 novembre 2026

- **Une montée remplacée ne se paie plus** (choix « 1 ») : un acompte de montée non payé dont le forfait n'est plus le forfait en cours est « remplacé » (`20261117110000`) ; la facture du mois facture les jours réellement passés à chaque offre.
- **Une place de propriétaire coûte une place** : le rôle est donné par le propriétaire principal, le prix est celui d'une place (`ref.offres.prix_siege_sup`).
- **Une société au-delà de l'offre : 29 DT HT par mois** (`ref.offres.prix_organisation_sup`, déjà à 29,000 dans la grille du 19 octobre).
- **Payer à l'année : 2 mois offerts**, pour l'offre en cours (`mon_annuel`).

## La passe de nuit (livrée coupée le 2 novembre 2026)

Conception validée par le dirigeant le 2 novembre ; ce qui reste à trancher ou à
mesurer, sans bloquer la livraison :

- **Les plafonds sont INCERTAINS** (1 USD et 200 relectures par dossier, 20 USD
  pour la plateforme, par 24 h glissantes ; arrêt à 50 % du plafond IA mensuel) :
  le coût réel d'une relecture n'a pas été mesuré. À revoir dans la tour après la
  première nuit observée sur le staging.
- **Écart à la conception, éprouvé.** La conception bornait la LECTURE du
  relecteur à la pièce relue. Exécuté, l'analyse d'une relecture retenue ne
  voyait plus les autres pièces du dossier : le doublon probable disparaissait
  (`la-passe-de-nuit.test.ts`, « retenue » : rejugée par le dirigeant, la pièce
  changeait). La lecture s'étend donc au dossier tant qu'une relecture y est due,
  sans jamais dépasser ce que l'auteur de la pièce relue verrait : ni pièce
  archivée, ni pièce d'un autre que l'auteur ne voit pas — la personnelle, ni celle de la
  société sans `societe.tout_voir` (`app.piece_lisible_au_relecteur`,
  revue indépendante) ; l'écriture reste bornée à la pièce relue, et les octets
  (`contenu`) aussi. À confirmer par le dirigeant.
- **ALGORIA paie, jusque dans le budget du client.** La dépense du relecteur ne
  compte plus au budget IA mensuel du client (`app.depense_ia_du_mois` exclut les
  comptes de service). Choix retenu, à confirmer : la « part du plafond mensuel »
  borne ce qu'ALGORIA dépense la nuit pour un dossier (sa dépense du mois contre
  la part réglée du plafond du client), sans rien prendre au client ; la
  dépense de journée du client ne compte à aucun plafond de nuit.
- **Le mois du plafond mensuel est le mois UTC** (`date_trunc('month', now())`,
  depuis 20261022590000) : une dépense du 1er à 00:30 heure de Tunis compte au
  mois précédent. Défaut préexistant, non corrigé ici.
- **Révoquer le relecteur PENDANT une relecture** (raisonné sur le code, non
  éprouvé) : ses appels suivants ne voient plus rien, la relecture échoue et son
  issue ne peut plus s'inscrire sous lui ; le passage reste « interrompu » et le
  travail, pris, redevient prenable à son âge d'abandon — une tentative est
  consommée. Couper la passe par l'interrupteur, lui, s'arrête AVANT la
  relecture suivante, sans tentative consommée : c'est le geste à préférer.
- **Un modèle sans tarif** ne laisse aucune ligne de coût : la tour le signale
  (« sans coût »), le plafond en dollars ne le borne pas — seul le nombre de
  relectures le borne.

## La rétention du journal d'observabilité (tranchée par défaut le 3 novembre 2026)

- **90 jours**, valeur de départ INCERTAINE (`observabilite.reglages`, migration 20261118130000) : un trimestre de recette et de support. Les traces nomment un
  acteur (son identifiant) et une pièce, jamais leur contenu. Le dirigeant
  arrête la durée ; la changer est une ligne en base, sans déploiement
  (`docs/journalisation.md`).

## L'émission automatique des factures (livrée coupée le 4 novembre 2026)

Décision du dirigeant : « option 1 », le robot passe chaque jour, d'abord sur le
staging (migration 20261127090000, carte « Facturation automatique » de la tour).
La facture reste mensuelle, par payeur, au prorata des jours. Tranché par défaut,
à confirmer :

- **Le rattrapage vaut 1 mois** : chaque passage n'examine que le mois qui vient
  de se clore. Facturer d'office des mois plus anciens jamais facturés (une
  licence née en septembre, ouverte en novembre) est un arbitrage commercial ; la
  tour élargit la fenêtre, motif à l'appui, quand le dirigeant le décide.
- **Le titulaire est facturé à terme échu** : le mois de novembre part le
  1er décembre. Facturer à l'avance (dès le premier jour) changerait le modèle de
  `facturation.emettre`, pas le robot. INCERTAIN au regard de la règle fiscale du
  moment de la facturation (CTVA tunisien) : à confirmer par le fiscaliste.
- **L'échéance reste 15 jours**, défaut SQL préexistant de `emettre` et
  `emettre_cabinet`, pas un paramètre daté en base (R4/R10 au sens strict) : à
  déplacer dans `ref.socle_params` si le dirigeant veut la régler.
- **Un numéro peut encore se perdre** : un mois déjà facturé est sauté avant tout
  numéro, mais une émission qui échoue APRÈS avoir tiré son numéro (une licence
  sans organisation, par exemple) en perd un à chaque passage, une fois par jour
  — `nextval` ne se rend pas au rollback. La continuité de la numérotation des
  factures est INCERTAINE au regard du texte tunisien ; défaut préexistant de
  `facturation.numero_facture_seq`, non corrigé ici.
- **L'acteur au journal** des factures émises est l'opérateur dont la décision
  d'ouvrir est en vigueur, pas un compte de service : c'est lui qui a autorisé
  l'émission, nommément.

## La PME paie d'avance, à sa date anniversaire (livrée coupée le 4 novembre 2026)

Décisions du dirigeant (A à I), migration 20261128090000 : le cabinet reste au
mois, à terme échu ; ce que la PME paie se facture d'avance, à la date
anniversaire, sans prorata ; une montée, une place ou une société en plus partent
le jour même sur une facture complémentaire. Deux périmètres à la tour, coupés.
Ce qui remplace la ligne « le titulaire est facturé à terme échu » ci-dessus.

**INCERTAIN — juridique et fiscal, à valider par le fiscaliste avant d'ouvrir le
périmètre PME :**

- **Facturer d'avance** un service à venir (période anniversaire entière, dès son
  premier jour) : fait générateur et exigibilité de la TVA au regard du CTVA
  tunisien ; la facture est datée du jour d'émission, la période couverte est
  écrite sur la ligne. À vérifier : texte (CTVA, articles sur le fait générateur
  des prestations de services), pratique (abonnements logiciels facturés
  d'avance), risque en contrôle (TVA exigible à l'encaissement de l'avance).
- **Un droit de timbre sur chaque facture complémentaire** : chaque complément
  est une facture à part entière et porte le timbre du pack
  (`facture.droit_de_timbre`), comme la décision C le demande. Le coût pour le
  client et la conformité (un timbre par facture) sont à confirmer.
- **Aucun avoir à la descente** : la période déjà facturée reste due, la baisse
  vaut à l'échéance suivante (E). Conforme si les conditions générales le disent ;
  à écrire dans les CGV avant ouverture.
- **Une période payée d'avance reste due à la fin de l'abonnement** : rien n'est
  facturé après la fin, rien n'est rendu. Politique à écrire dans les CGV.

**Tranché par défaut, à confirmer :**

- **Les droits d'une descente sont immédiats** (comme avant) : seule la
  facturation attend l'échéance suivante. Différer l'offre elle-même jusqu'à
  l'échéance demanderait que `forfait_courant_v` lise l'offre en vigueur à la
  date du jour, et non la dernière ouverte — un changement de toutes les lectures
  de droits, hors de ce lot. Une remontée dans la même période ne refacture
  rien : le tarif couvert est déjà payé.
- **Un complément par jour** : un second changement le même jour, après un
  complément déjà émis, part au passage du lendemain, à partir du lendemain (un
  jour d'écart offert). La clé d'unicité est « payeur, licence, nature, premier
  jour couvert », comme demandé.
- **Ce que le robot attrape le lendemain** : la fin de l'accès d'un cabinet un
  jour passé, ou un geste daté de la veille, se facture à partir du jour du
  passage, pas du jour du geste (quelques jours d'écart offerts au client). Les
  gestes du jour (montée, place, société, fin d'accès) passent sur le champ, à la
  validation de la transaction (déclencheurs différés).
- **Le saut d'ancien à nouveau** : une PME déjà facturée au mois reprend où sa
  dernière facture s'arrête, jusqu'à son anniversaire, au prorata de la période
  anniversaire. Avec le rattrapage livré (1 : la période en cours), des jours
  plus anciens jamais facturés le restent. Avant d'ouvrir le périmètre PME,
  facturer au mois ce qui doit l'être, ou régler le rattrapage.
- **Acomptes de montée en attente** : un acompte préparé périmètre coupé reste
  payable ; payé, il s'impute sur la prochaine échéance de la PME. Si sa montée
  tombe dans une période facturée après l'ouverture, l'écart des jours entre la
  montée et l'ouverture n'est pas facturé, mais l'acompte s'impute quand même
  (paiement sans ligne correspondante, en faveur du client). À solder à la main
  s'il en reste à l'ouverture.
- **Recharges de lectures** : inchangé — la recharge se paie aussitôt en ligne
  (acompte TTC, sans timbre) et se facture sur la facture suivante du titulaire :
  désormais son échéance anniversaire (recharges achetées jusqu'au jour
  d'émission), avec l'imputation du paiement. Une licence entièrement payée par
  un cabinet n'a pas de facture de titulaire : ses recharges ne se facturent pas
  (défaut préexistant).
- **Licence suspendue** : la facturation continue (comme avant). Une licence
  résiliée n'est plus facturée.
- **L'annuel** commence à l'échéance suivante de la PME et se facture ce jour-là
  (une ligne de douze mois) ; ensuite chaque anniversaire ne facture que les
  places et sociétés en plus. L'émission manuelle de la plateforme
  (`facturation.emettre`, au mois) ne reconnaît une année que si elle commence
  le premier d'un mois : à n'utiliser que pour une PME encore facturée au mois.
- **La page de paiement** (`mes_factures`) montre le mois de la facture
  (`periode`), pas la période couverte : la ligne de la facture porte les dates
  exactes. Montrer `couvre_du`/`couvre_au` à l'écran est un lot d'interface.
- **Un numéro peut encore se perdre** (ligne ci-dessus) : l'émission de la PME
  vérifie tout ce qu'elle peut AVANT de tirer son numéro (déjà émise, jours de
  base déjà facturés, licence sans société, destinataire sans nom, timbre).

## L'accès total (décidé par Wissem le 5 novembre 2026, livré sans aucun accord)

Un opérateur qui a l'accès total agit dans toute organisation comme son rôle le
plus haut (`ref.types_d_organisation.role_d_acces_total` : dirigeant, expert),
sans place ni siège (`20261129090000_l_acces_total_se_donne_par_la_tour.sql`).
La migration n'accorde rien : la Tour accorde et retire, motif à l'appui.
Tranché par défaut, à confirmer :

- **« Mon espace privé » des autres reste fermé** : données personnelles de
  tiers (INPDP, loi 2004-63). La réquisition reste la seule exception.
- **S'accorder à soi-même** (tranché par Wissem le 5 novembre 2026) : un
  opérateur peut s'accorder l'accès total à lui-même. L'accord reste motivé,
  daté, en ajout seul, et journalisé sous son auteur (`acces_total.accorde`,
  acteur = bénéficiaire) ; il ne se donne toujours qu'à un opérateur.
- **Les gestes du titulaire de la licence** (payer, changer d'offre, souscrire
  l'année, transmettre la licence, offrir une place) restent au titulaire :
  l'accès total ne fait pas payer un client.
- **Ouvrir sans « voir »** : une pièce ouverte sous l'accès total n'écrit pas de
  « Vue » ; la relecture de nuit, les notifications, les destinataires du
  circuit et la « prise en charge » suivent les adhésions réelles.
- **Le journal** : la décision se journalise sous l'émetteur des factures en
  vigueur (l'organisation d'ALGORIA) ; sans émetteur, elle est refusée. Les
  gestes faits sous l'accès total portent l'acteur réel, sans marque propre :
  on les distingue en croisant l'acteur avec `plateforme.acces_total`.

## La chaîne de désignation (décidée par Wissem le 8 novembre 2026)

Claude désigne, DeepSeek prend la main en cas de panne ou de budget épuisé, et
les deux budgets épuisés la pièce est lue par le moteur Sudoku seul
(`20261202090000_la_designation_a_un_principal_et_un_repli.sql`,
`apps/api/src/malica/lecture/designation.ts`). Tranché par défaut, à confirmer :

- **Les plafonds de départ** : 500 $ par mois civil pour Claude (les crédits
  mensuels de l'offre startup, dit par le dirigeant le 8 novembre 2026 : le
  compteur repart de zéro le 1er du mois), 20 $ par mois pour DeepSeek. La tour
  les règle (section « Modèles »), datés et motivés.
- **Le cache du prompt système de Claude** est posé : sa lecture et son écriture
  se journalisent sous leurs rôles tarifés (`cache`, `cache_ecriture`). Les
  crédits startup sont supposés couvrir ces mêmes prix ; si l'offre les compte
  autrement, seul le plafond est à régler.
- **Le modèle Claude de départ** : `claude-haiku-5-5` (0,10 $ / 0,50 $ par
  million de jetons), sur l'essai de l'expert plateforme du 8 novembre 2026
  (une facture fictive). `claude-sonnet-5-5` (2 $ / 10 $) est tarifé et se
  choisit dans la tour. À mesurer sur nos vraies pièces avec la clé (banc
  `tests/real/designation-cout.ts`). Un « second avis » Sonnet sur les pièces
  non prouvées n'est PAS câblé : c'est un troisième appel, à décider.
  Mesuré le 8 novembre 2026 en mode « Sudoku d'abord » sur 411 pièces
  (`docs/mesure-claude-2026-11-08.md`) : ni Haiku, ni Sonnet, ni DeepSeek ne
  font prouver une pièce de plus que le moteur seul (283), et aucun faux n'est
  affirmé ; les valeurs non prouvées du modèle seraient fausses 7 à 15 fois sur 100. Le second avis Sonnet n'apporte rien au taux de pièces prouvées.
- **Les sorties structurées (`output_config.format`) ne sont PAS activées.** Leur
  limite (24 paramètres facultatifs et 16 unions par requête) ne tient pas le
  contrat de désignation R2 tel qu'il est : une trentaine de pointeurs
  `page/ordinal` facultatifs et des références à clés libres. Les activer
  demande de remodeler ce contrat (champs requis avec « non désigné » explicite,
  références en liste), puis un appel réel pour valider le schéma — rien de cela
  ne se fait sans clé ni à l'aveugle. D'ici là : réessai sur JSON illisible, puis
  repli DeepSeek, journalisé.
- **Ce que compte le budget** : la facture du FOURNISSEUR, tous organes
  confondus. Le conseil, les procès-verbaux et le générateur de recettes
  appellent aussi DeepSeek : leur dépense entame le budget du repli.
- **Deux pannes de suite ne sont pas un arrêt** : Claude en panne puis DeepSeek
  en panne, la lecture échoue comme avant et la file la rejoue. Seuls deux
  budgets épuisés arrêtent la désignation par modèle.
- **Hors de la chaîne, pour l'instant** : la carte d'identification fiscale
  (`lire-carte.ts`), le conseil, les procès-verbaux et le générateur de
  recettes restent sur DeepSeek seul.

## La PME ne voit jamais les écritures — et le dossier autonome ? (lot S2, 6 novembre 2026, INCERTAIN)

`20261202100000_la_pme_ne_voit_jamais_les_ecritures.sql` ferme les écritures
et leurs lignes à toute personne de la PME dès qu'un cabinet est engagé sur le
dossier (engagement actif à la date du jour) : seuls le cabinet engagé et la
plateforme réquisitionnée les lisent. L'accueil de la PME lit des totaux par
mois et par classe (`office.totauxParClasse`), jamais une ligne.

**Ouvert** : un dossier SANS cabinet (autonome) tient lui-même ses livres et
inscrit ses écritures. La règle dit « jamais », mais appliquée à la lettre,
ses écritures ne seraient lisibles de personne. Ce lot n'y change rien : le
dirigeant (`societe.tout_voir`) et l'auteur d'une pièce les lisent comme hier.
Conséquence à connaître : quand un engagement prend fin, le dossier redevient
« sans cabinet » et la PME relit toutes les écritures qu'y a inscrites le
cabinet. Le dirigeant tranche.

**Ouvert aussi** : les écritures de RÈGLEMENT (`nature = 'reglement'`) restent
lisibles de la PME en mandat. Le règlement est son geste (`pme.regler`,
`office.inscrireLeReglement`) : elle en voit déjà la proposition ligne à ligne
(`office.propositionDeReglement`), et l'API relit sous son identité ce qu'elle
vient d'inscrire. Les fermer exigerait de déplacer ce geste en base.

**Ce que la PME lit encore d'une écriture du cabinet** : sa DATE (le mois de
TVA d'une pièce prise en charge, `app.jours_des_ecritures_du_dossier`) et son
COURS de change (`app.cours_de_l_ecriture_de_la_piece`), comme elle en lisait
déjà les MONTANTS (`app.montants_pris_en_charge`). Sa TVA du mois et « Vos
charges » en dépendent.

**Conséquence à confirmer** (`20261202100100`, `20261202100200`) : une porte
de la PME ne lit, au-delà de la PME, que sa propre proposition encore
ouverte. Une PME peut toujours remplacer une proposition ouverte du cabinet
sur sa pièce (comportement d'avant le lot, par
`app.piece_oublie_ses_propositions`), mais plus proposer sur une pièce déjà
inscrite (`refus.ecriture.reimputer`). Un dossier en
`validation_mode = 'autonome'` AVEC un cabinet engagé ne contre-passe donc plus
l'écriture que le cabinet a prise en charge (`refus.introuvable.ecriture`) :
le cabinet la défait. Si le dirigeant veut rendre ce geste à la PME, il faudra
une porte dédiée qui ne lit que ce dont elle a besoin. Reste aussi ouvert :
après la révocation du mandat, la PME relit tout ce que le cabinet a inscrit.
