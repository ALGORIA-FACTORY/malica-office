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

*Trouvé le 17 octobre, ronde 4 de la tâche 0.*

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

*Trouvé le 17 octobre, relecture de la ronde 5.* La porte d'accès du dépôt ne
distingue pas les rôles au sein d'un cabinet : un collaborateur du cabinet lit et
compte comme l'expert-comptable.

**Tranché :** accepté. C'est le modèle de tout le dépôt, et en faire une
exception à cet endroit serait une règle locale que personne ne retrouverait.
Si Wissem veut que seul l'expert consomme le forfait du client, c'est une
distinction à poser **partout**, pas ici.

### A-2 · Un opérateur de plateforme sous réquisition reste bloqué par le plafond du client

*Trouvé le 17 octobre, même ronde.*

**Tranché :** on n'y touche pas. C'est fermé, donc sans danger, et une
réquisition est rare. Une porte fermée qu'on ouvrira le jour où l'on connaîtra
son prix vaut mieux qu'une porte ouverte aujourd'hui.

**À rouvrir** si une réquisition doit pouvoir lire chez un client au plafond —
auquel cas il faudra dire **qui paie** cette lecture, et ce n'est pas une
question technique.

---

## Les dettes techniques datées

### D-1 · Onze tables de `capture` acceptent une imputation forgée

*Trouvé le 17 octobre, ronde 4.* Elles portent un `tenant_id` et un `piece_id`
que nulle politique ne lie entre eux. Une ligne peut donc désigner la pièce d'un
autre dossier.

**Pourquoi ce n'est pas urgent, et pourquoi ce n'est pas rien :** aucune de ces
onze n'est lue comme **preuve d'un droit**. C'est exactement ce qui distinguait
`facturation.lectures`, où le même défaut permettait de contourner le plafond et
de dépenser le quota d'un tiers. Ici, l'imputation forgée est invisible et sans
effet. À refermer avant la première facture adressée à un tiers.

### D-2 · Aucun garde ne refuse une fonction privilégiée sans porte nommée

*Trouvé le 17 octobre, relecture de la ronde 3.* Le dépôt refuse désormais
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

*Trouvé le 13 octobre.* Déposés puis envoyés à la lecture comme n'importe quelle
photo, ils en revenaient classés `facture_vente` — et un reçu compté comme une
vente **double le chiffre d'affaires**. La cause est corrigée à deux étages. Les
trois lignes déjà écrites, elles, ne se réécrivent pas (R7) : il faut une
précision, pas une correction.

### D-4 · `facturation.emettre` refuse une licence sans organisation rattachée

*Trouvé le 17 octobre, à l'entrée de la livraison.* La contrainte de la table
exige le rattachement ; l'émission ne le vérifie pas avant d'essayer. Le message
rendu n'aide pas à comprendre.

### D-5 · Une offre antérieure au 17 octobre rend « licence introuvable »

*Même jour.* Le référentiel des offres est daté du 17 octobre. Une licence dont
la date de début est antérieure ne trouve aucune offre en vigueur, et le message
parle d'une licence absente au lieu d'une offre absente. Un message faux sur la
cause est plus coûteux qu'un message absent.

---

## Les données de mise en service

### M-1 · Une ligne d'émetteur doit exister avant la première facture

*Trouvé le 17 octobre.* Sans une ligne dans `facturation.emetteurs`, aucune
facture ne peut être émise. Ce n'est pas un défaut de code : c'est une saisie à
faire le jour de la mise en service, et elle n'est écrite nulle part ailleurs.

### M-2 · La fiche de l'organisation d'essai porte un matricule invalide

*Trouvé le 5 octobre, toujours vrai.* La fiche du staging porte sept chiffres
**sans la lettre de clé** — ce n'est pas un matricule tunisien valide, et la
saisie l'a accepté. C'est ce qui a produit le rejet « matricule différent » sur
une facture pourtant bien lue : le contrôle avait raison, la fiche avait tort.

Deux choses à faire, et elles sont distinctes : corriger la fiche, et **refuser
la saisie** d'un matricule qui n'a pas la forme attendue.
